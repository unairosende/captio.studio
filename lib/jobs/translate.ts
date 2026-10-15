import type { GlossaryEntry } from '../ai/prompt.ts'
import { must } from '../api.ts'
import { TRANSLATION_BATCH, TRANSLATION_PAUSE_MS } from '../providers.ts'
import type { OutputMode } from '../subtitles/layout.ts'
import type { Subtitle } from '../subtitles/types.ts'

/**
 * One language, batch by batch, from the browser.
 *
 * Moved out of the editor's Traducir step unchanged so the project assistant
 * sends exactly the requests the editor does — cues, not prose, with the
 * material named so the plan's minutes are measured — and adds only the one
 * thing it has that the editor does not: the brief, as extra instructions.
 */

export interface TranslateRequest {
  cues: Subtitle[]
  lang: string
  sourceLang: string
  outputMode: OutputMode
  /** Which material this belongs to. A translation that names neither is refused. */
  sequenceId: string | null
  mediaId: string | null
  glossary: GlossaryEntry[]
  /** What is particular to this material, beyond the rules the server always applies. */
  extraInstructions?: string
}

export interface TranslateProgress {
  done: number
  total: number
  /** Seconds before the next batch, while pausing between them. */
  waiting?: number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** The translated cues, in order. Throws with the sentence to print, after the batches before it were paid for. */
export async function translateCues(
  req: TranslateRequest,
  onProgress: (p: TranslateProgress) => void,
): Promise<Subtitle[]> {
  const { cues } = req
  const total = cues.length
  const result: Subtitle[] = []

  for (let i = 0; i < total; i += TRANSLATION_BATCH) {
    if (i > 0) {
      for (let c = Math.round(TRANSLATION_PAUSE_MS / 1000); c > 0; c--) {
        onProgress({ done: i, total, waiting: c })
        await sleep(1000)
      }
    }
    const batch = cues.slice(i, i + TRANSLATION_BATCH)

    // Cues, not prose. The server composes the prompt, so a subscription
    // cannot be turned into a general-purpose model.
    const data = await must('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'translate',
        cues: batch.map(s => s.text),
        // The anchor each cue travels under, so a reply short by one can
        // say which one is missing.
        cueNumbers: batch.map(s => s.index),
        targetLang: req.lang,
        sourceLang: req.sourceLang,
        outputMode: req.outputMode,
        // Which material this belongs to. Plans are sold in minutes, so a
        // translation that names neither an upload nor a saved sequence
        // has nothing the server can charge — and is refused.
        sequenceId: req.sequenceId,
        mediaId: req.mediaId,
        // Sent with every batch: each request is its own conversation.
        glossary: req.glossary,
        extraInstructions: req.extraInstructions || undefined,
      }),
    })
    if (data.error) throw new Error(data.error)
    // No falling back to the source text. A cue left in the original
    // language but presented as translated ships as finished work.
    const parsed = data.translations as string[]
    batch.forEach((s, j) => result.push({ ...s, text: parsed[j] ?? s.text }))
    onProgress({ done: Math.min(i + TRANSLATION_BATCH, total), total })
  }

  return result
}
