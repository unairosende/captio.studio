/**
 * How the editor paces a translation.
 *
 * The pause is Gemini's free-tier rate limit rather than caution: sending the
 * next batch sooner earns a 429 and a retry, which is slower than waiting.
 *
 * There is no provider list any more. The server picks the model, so a
 * production company is never asked to choose between `qwen-qwq-32b` and
 * `llama-3.3-70b-versatile` in order to subtitle an episode.
 */
export const TRANSLATION_BATCH = 30
export const TRANSLATION_PAUSE_MS = 10_000


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
