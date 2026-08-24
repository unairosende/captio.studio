/**
 * How the editor paces a translation.
 *
 * There is no provider list any more. The server picks the model, so a
 * production company is never asked to choose between `qwen-qwq-32b` and
 * `llama-3.3-70b-versatile` in order to subtitle an episode.
 */
export const TRANSLATION_BATCH = 30

/**
 * A breath between batches, not a rate limit.
 *
 * Ten seconds sat here on the belief that sending sooner earned a 429. Six
 * batches fired at once — no pause at all — came back 200, every one of them,
 * so there was no limit being avoided: the wait was the whole cost. On a
 * feature that is sixty batches, and ten minutes of nothing happening on top of
 * the translating.
 *
 * A second is kept rather than none. What the same test did show is that the
 * provider answers concurrency by queueing rather than refusing — the same
 * prompt measured 1.7s and 44s in one round — so hammering it buys nothing and
 * pacing costs almost nothing.
 */
export const TRANSLATION_PAUSE_MS = 1_000


export const LANG_CODES: Record<string, string> = {
  English: 'EN', Spanish: 'ES', French: 'FR', German: 'DE', Italian: 'IT',
  Portuguese: 'PT', Dutch: 'NL', Polish: 'PL', Russian: 'RU', Turkish: 'TR',
  Arabic: 'AR', Japanese: 'JA', Korean: 'KO', 'Chinese (Simplified)': 'ZH', Catalan: 'CA',
}

export const SOURCE_LANGUAGES = [
  'Auto-detect', 'English', 'Spanish', 'French', 'German', 'Italian',
  'Portuguese', 'Dutch', 'Polish', 'Russian', 'Turkish', 'Arabic',
  'Japanese', 'Korean', 'Chinese (Simplified)', 'Catalan',
]

export const TARGET_LANGUAGES = SOURCE_LANGUAGES.filter(l => l !== 'Auto-detect')

export const QUICK_LANGS = ['English', 'Spanish', 'French', 'German', 'Italian', 'Catalan', 'Japanese', 'Korean']
