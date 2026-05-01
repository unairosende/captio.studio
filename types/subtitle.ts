export interface Subtitle {
  index: number
  start: string // HH:MM:SS,mmm
  end: string
  text: string
}

export type TranslationStore = Record<string, Subtitle[]>
export type BackTranslationStore = Record<string, Subtitle[]>

export type OutputMode = 'horizontal' | 'vertical'
export type ViewMode = 'list' | 'compare'
export type ProviderId = 'gemini' | 'groq' | 'openrouter' | 'mistral'
export type XcProviderId = 'groq' | 'openai'

export type CharStatus = 'ok' | 'warn' | 'error'

export interface ProviderConfig {
  label: string
  placeholder: string
  hint: string
  models: { id: string; name: string }[]
  batchSize: number
  pauseMs: number
}

export interface Plan {
  id: 'individual' | 'team'
  name: string
  price: number
  monthlySubtitles: number
  seats: number
  stripePriceId: string
}
