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

export type CharStatus = 'ok' | 'warn' | 'error'

export interface Plan {
  id: 'individual' | 'team'
  name: string
  /** Euros a month. The plans are sold in the customer's currency, not ours. */
  price: number
  /**
   * Minutes of source material a month.
   *
   * Charged once per piece of material, however many languages it is then
   * translated into — see db/migrations/0008. That is what makes "every
   * language included" a promise the data model keeps rather than a line of
   * marketing somebody has to remember not to contradict.
   */
  monthlyMediaMinutes: number
  seats: number
  stripePriceId: string
}
