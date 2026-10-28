import { qcForMode, type OutputMode } from './layout.ts'
import type { QcConfig } from './types.ts'

/**
 * What a sequence is made to, fixed when it is created and changeable later:
 * the shape of the screen it is read on, how many lines a subtitle may take
 * and how long each may be, and whether it is for viewers who cannot hear.
 *
 * Stored in `sequences.data.settings`, beside the cues, so a version and a
 * duplicate carry the settings their cues were cut to. The original's
 * language is the one property with a column of its own (`source_lang`),
 * because it was there first.
 */
export interface SequenceSettings {
  outputMode: OutputMode
  maxLines: 1 | 2
  /** Characters per line; null takes the orientation's own (42 or 32). */
  maxChars: number | null
  /** For the deaf and hard of hearing: sounds in the transcription, and who speaks. */
  sdh: boolean
}

export const DEFAULT_SETTINGS: SequenceSettings = { outputMode: 'horizontal', maxLines: 2, maxChars: null, sdh: false }

/** What a line length may be set to. Shorter is not a subtitle; longer is not read. */
export const LINE_CHARS = { min: 20, max: 60 }

/** From stored jsonb or a request body: checked, never trusted, anything odd back to its default. */
export function readSettings(raw: unknown): SequenceSettings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const chars = Number(v.maxChars)
  return {
    outputMode: v.outputMode === 'vertical' ? 'vertical' : 'horizontal',
    maxLines: v.maxLines === 1 ? 1 : 2,
    maxChars: v.maxChars != null && Number.isInteger(chars) && chars >= LINE_CHARS.min && chars <= LINE_CHARS.max ? chars : null,
    sdh: v.sdh === true,
  }
}

/** The checks a sequence's own settings call for; every limit downstream reads this. */
export function qcFor(s: Pick<SequenceSettings, 'outputMode' | 'maxLines' | 'maxChars'>): QcConfig {
  const qc = qcForMode(s.outputMode)
  return { ...qc, maxChars: s.maxChars ?? qc.maxChars, maxLines: s.maxLines }
}
