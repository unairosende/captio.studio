'use client'

import type { ReviewNote } from '@/lib/ai/prompt'
import { charStatus, qcFor, reflowText } from '@/lib/subtitles'
import { termsInForce, useSubtitleStore } from '@/store/useSubtitleStore'

import { must } from '@/lib/api'

import { useSpent } from './useJobs'

type Store = ReturnType<typeof useSubtitleStore.getState>

/**
 * The track on screen, which a pass reads and writes: a translation, or the
 * original — a transcription has misheard words and over-long lines too.
 * `lang` is what the model is told the text is written in.
 */
function onScreen(s: Store) {
  const original = s.activeTab === 'source'
  const lang = s.activeTab
  return {
    original,
    subs: original ? s.subtitles : s.translations[lang],
    lang: original ? (s.srcLang === 'Auto-detect' ? 'their original language' : s.srcLang) : lang,
    /** Where a cue's original is, for meaning; nothing when the track is the original. */
    sourceOf: (index: number) => (original ? undefined : s.subtitles.find(o => o.index === index)?.text ?? ''),
    write: (index: number, text: string) => (original ? s.updateSource(index, text) : s.updateSubtitle(lang, index, text)),
  }
}

/**
 * The passes over a track that already exists.
 *
 * Fix rewrites what is too long; Revise applies a reviewer's note; Review
 * reads the track back and says what is wrong; Back-translate turns a
 * translation back into the source language to be compared. All but the last
 * work on the original too. The batching, the undo steps and the refusal to
 * fall back to the source text are the ones that were argued for one at a time.
 */
export function usePasses() {
  const spent = useSpent()

  /** Shorten every cue over the limit, by reflow or, if allowed, by the model. */
  async function fixOverlength() {
    const s = useSubtitleStore.getState()
    const { settings, allowRephrase } = s
    const { original, subs, lang, sourceOf, write } = onScreen(s)
    if (!subs) return
    const qc    = qcFor(settings)
    const toFix = subs.filter(c => charStatus(c.text, qc) === 'error')
    if (!toFix.length) return

    if (!allowRephrase) {
      // One step for the whole sweep. Fix rewrites every overlong cue at once,
      // and taking that back one cue at a time would be its own punishment.
      s.pushUndo()
      toFix.forEach(c => {
        const reflowed = reflowText(c.text, qc.maxChars, qc.maxLines)
        if (reflowed !== c.text) write(c.index, reflowed)
      })
      return
    }
    s.pushUndo()

    s.setTranslateJob({ running: true, message: `Acortando ${toFix.length} cues…`, progress: 0, error: null })
    const BATCH = 15
    for (let i = 0; i < toFix.length; i += BATCH) {
      const batch = toFix.slice(i, i + BATCH)
      try {
        const data = await must('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'shorten',
            cues: batch.map(c => c.text),
            sourceTexts: original ? undefined : batch.map(c => sourceOf(c.index)),
            original,
            cueNumbers: batch.map(c => c.index),
            targetLang: lang,
            ...settings,
          }),
        })
        if (data.error) throw new Error(data.error)
        const parsed = data.translations as string[]
        batch.forEach((c, j) => { if (parsed[j]) write(c.index, parsed[j]) })
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
    const { settings, translateJob } = s
    const glossary = termsInForce(s)
    const { original, subs, lang, sourceOf, write } = onScreen(s)
    if (!subs?.length || !instructions.trim() || translateJob.running) return

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
            sourceTexts: original ? undefined : batch.map(c => sourceOf(c.index)),
            original,
            // The numbers the reviewer is writing about. Each request is its
            // own conversation, so a correction naming cue 84 reaches the model
            // with every batch and only the batch holding 84 can act on it.
            cueNumbers: batch.map(c => c.index),
            instructions,
            targetLang: lang,
            ...settings,
            glossary,
          }),
        })
        if (data.error) throw new Error(data.error)
        const parsed = data.translations as string[]
        batch.forEach((c, j) => { if (parsed[j] && parsed[j] !== c.text) write(c.index, parsed[j]) })
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
   * Read the track back and report what is wrong with it — a translation
   * against its original, the original against itself.
   *
   * Its own pass, never folded into the translation reply. Reads rather than
   * writes, so no undo step: nothing on screen changes.
   */
  async function review() {
    const s = useSubtitleStore.getState()
    const { activeTab, srcLang, reviewJob } = s
    const glossary = termsInForce(s)
    const { original, subs, lang, sourceOf } = onScreen(s)
    if (!subs?.length || reviewJob.running) return

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
            task: original ? 'proofread' : 'review',
            cues: batch.map(c => c.text),
            sourceTexts: original ? undefined : batch.map(c => sourceOf(c.index)),
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
    s.setReviewNotes(activeTab, found)
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

  /**
   * Fit every track — the original and each translation — to the settings in
   * force, without a model: each cue broken again into the lines and the
   * length now allowed. Nothing is rewritten, so nothing is spent. One undo
   * step. Returns how many cues still do not fit, which need shortening or
   * cutting again from the audio.
   */
  function relayout(): number {
    const s = useSubtitleStore.getState()
    const qc = qcFor(s.settings)
    s.pushUndo()
    let left = 0
    const fit = (subs: typeof s.subtitles, write: (index: number, text: string) => void) => {
      for (const c of subs) {
        const text = reflowText(c.text, qc.maxChars, qc.maxLines)
        if (text !== c.text) write(c.index, text)
        if (charStatus(text, qc) === 'error') left++
      }
    }
    fit(s.subtitles, s.updateSource)
    for (const [lang, subs] of Object.entries(s.translations)) fit(subs, (index, text) => s.updateSubtitle(lang, index, text))
    return left
  }

  return { fixOverlength, revise, review, backTranslate, relayout }
}
