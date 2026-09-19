'use client'

import type { ReviewNote } from '@/lib/ai/prompt'
import { charStatus, qcForMode, reflowText } from '@/lib/subtitles'
import { useSubtitleStore } from '@/store/useSubtitleStore'

import { must } from '@/lib/api'

import { useSpent } from './useJobs'

/**
 * The passes over a translation that already exists.
 *
 * Fix rewrites what is too long; Revise applies a reviewer's note; Review
 * reads the track back and says what is wrong; Back-translate turns it back
 * into the source language to be compared. Moved out of the editor area
 * unchanged — the batching, the undo steps and the refusal to fall back to
 * the source text are the ones that were argued for one at a time.
 */
export function usePasses() {
  const spent = useSpent()

  /** Shorten every cue over the limit, by reflow or, if allowed, by the model. */
  async function fixOverlength() {
    const s = useSubtitleStore.getState()
    const { activeTab, translations, subtitles, outputMode, allowRephrase } = s
    if (activeTab === 'source' || !translations[activeTab]) return
    const lang  = activeTab
    const qc    = qcForMode(outputMode)
    const subs  = translations[lang]
    const toFix = subs.filter(c => charStatus(c.text, qc) === 'error')
    if (!toFix.length) return

    if (!allowRephrase) {
      // One step for the whole sweep. Fix rewrites every overlong cue at once,
      // and taking that back one cue at a time would be its own punishment.
      s.pushUndo()
      toFix.forEach(c => {
        const reflowed = reflowText(c.text, qc.maxChars)
        if (reflowed !== c.text) s.updateSubtitle(lang, c.index, reflowed)
      })
      return
    }
    s.pushUndo()

    s.setTranslateJob({ running: true, message: `Acortando ${toFix.length} cues…`, progress: 0, error: null })
    const BATCH = 15
    for (let i = 0; i < toFix.length; i += BATCH) {
      const batch = toFix.slice(i, i + BATCH)
      const srcTexts = batch.map(c => subtitles.find(o => o.index === c.index)?.text ?? '')
      try {
        const data = await must('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'shorten',
            cues: batch.map(c => c.text),
            sourceTexts: srcTexts,
            cueNumbers: batch.map(c => c.index),
            targetLang: lang,
            outputMode,
          }),
        })
        if (data.error) throw new Error(data.error)
        const parsed = data.translations as string[]
        batch.forEach((c, j) => { if (parsed[j]) s.updateSubtitle(lang, c.index, parsed[j]) })
        s.setTranslateJob({ progress: Math.round((i + batch.length) / toFix.length * 100) })
      } catch { break }
    }
    s.setTranslateJob({ running: false, message: 'Acortados', progress: 100 })
    // Rewriting cues is a translation request like any other.
    spent()
  }

  /**
   * Apply a reviewer's corrections to the translation that is already there.
   *
   * Not a retranslation: running the whole track through the model again
   * throws away every fix made by hand since, and re-rolls the ninety-nine
   * cues nobody complained about in order to change the five that were named.
   */
  async function revise(instructions: string) {
    const s = useSubtitleStore.getState()
    const { activeTab, translations, subtitles, outputMode, glossary, translateJob } = s
    if (activeTab === 'source' || !translations[activeTab] || !instructions.trim() || translateJob.running) return
    const lang = activeTab
    const subs = translations[lang]
    if (!subs.length) return

    s.pushUndo()
    s.setTranslateJob({ running: true, message: `Corrigiendo ${subs.length} cues…`, progress: 0, error: null })

    const BATCH = 30
    for (let i = 0; i < subs.length; i += BATCH) {
      const batch = subs.slice(i, i + BATCH)
      try {
        const data = await must('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'revise',
            cues: batch.map(c => c.text),
            sourceTexts: batch.map(c => subtitles.find(o => o.index === c.index)?.text ?? ''),
            // The numbers the reviewer is writing about. Each request is its
            // own conversation, so a correction naming cue 84 reaches the model
            // with every batch and only the batch holding 84 can act on it.
            cueNumbers: batch.map(c => c.index),
            instructions,
            targetLang: lang,
            outputMode,
            glossary,
          }),
        })
        if (data.error) throw new Error(data.error)
        const parsed = data.translations as string[]
        batch.forEach((c, j) => { if (parsed[j] && parsed[j] !== c.text) s.updateSubtitle(lang, c.index, parsed[j]) })
        s.setTranslateJob({
          progress: Math.round((i + batch.length) / subs.length * 100),
          message: `Corrigiendo… ${Math.min(i + BATCH, subs.length)}/${subs.length}`,
        })
      } catch (e: unknown) {
        // Stops here rather than carrying on: the batches already applied stay
        // applied — one undo takes the whole pass back — but running the rest
        // after a failure would spend the allowance on a pass nobody can trust.
        s.setTranslateJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
        spent()
        return
      }
    }

    s.setTranslateJob({ running: false, message: `${subs.length} cues corregidos`, progress: 100, error: null })
    spent()
  }

  /**
   * Read the translation back and report what is wrong with it.
   *
   * Its own pass, never folded into the translation reply. Reads rather than
   * writes, so no undo step: nothing on screen changes.
   */
  async function review() {
    const s = useSubtitleStore.getState()
    const { activeTab, translations, subtitles, srcLang, glossary, reviewJob } = s
    if (activeTab === 'source' || !translations[activeTab] || reviewJob.running) return
    const lang = activeTab
    const subs = translations[lang]
    if (!subs.length) return

    s.setReviewJob({ running: true, message: `Revisando ${subs.length} cues…`, progress: 0, error: null })

    const BATCH = 30
    const found: ReviewNote[] = []
    for (let i = 0; i < subs.length; i += BATCH) {
      const batch = subs.slice(i, i + BATCH)
      try {
        const data = await must('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'review',
            cues: batch.map(c => c.text),
            sourceTexts: batch.map(c => subtitles.find(o => o.index === c.index)?.text ?? ''),
            cueNumbers: batch.map(c => c.index),
            targetLang: lang,
            sourceLang: srcLang,
            glossary,
          }),
        })
        if (data.error) throw new Error(data.error)
        found.push(...(data.notes as ReviewNote[]))
        s.setReviewJob({
          progress: Math.round((i + batch.length) / subs.length * 100),
          message: `Revisando… ${Math.min(i + BATCH, subs.length)}/${subs.length}`,
        })
      } catch (e: unknown) {
        s.setReviewJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
        spent()
        return
      }
    }

    // Written even when empty. "Nothing found" is a result, and a panel that
    // only ever appears when there is bad news would leave somebody who ran
    // the pass on clean work wondering whether it had run at all.
    s.setReviewNotes(lang, found)
    s.setReviewJob({
      running: false,
      progress: 100,
      message: found.length ? `${found.length} que mirar` : 'Nada que señalar',
      error: null,
    })
    spent()
  }

  /** Turn the translation back into the source language, or hide it again. */
  async function backTranslate() {
    const s = useSubtitleStore.getState()
    const { activeTab, translations, backTranslations, srcLang } = s
    if (activeTab === 'source' || !translations[activeTab]) return
    const lang = activeTab
    if (backTranslations[lang]) { s.clearBackTranslation(lang); return }

    const subs = translations[lang]
    s.setBackTranslateJob({ running: true, message: 'Retrotraduciendo…', progress: 0, error: null })

    const BATCH = 30
    const result: typeof subs = []
    for (let i = 0; i < subs.length; i += BATCH) {
      const batch = subs.slice(i, i + BATCH)
      try {
        const data = await must('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'backTranslate',
            cues: batch.map(c => c.text),
            cueNumbers: batch.map(c => c.index),
            targetLang: lang,
            sourceLang: srcLang,
          }),
        })
        if (data.error) throw new Error(data.error)
        const parsed = data.translations as string[]
        batch.forEach((c, j) => result.push({ ...c, text: parsed[j] ?? c.text }))
        s.setBackTranslateJob({ progress: Math.round((i + batch.length) / subs.length * 100) })
      } catch (e: unknown) {
        s.setBackTranslateJob({ running: false, error: e instanceof Error ? e.message : 'Error', message: '' })
        spent()
        return
      }
    }
    s.setBackTranslation(lang, result)
    s.setBackTranslateJob({ running: false, message: 'Listo', progress: 100, error: null })
    spent()
  }

  return { fixOverlength, revise, review, backTranslate }
}
