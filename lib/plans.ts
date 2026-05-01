import type { Plan } from '@/types/subtitle'

export const PLANS: Plan[] = [
  {
    id: 'individual',
    name: 'Individual',
    price: 19,
    monthlySubtitles: 50000,
    seats: 1,
    stripePriceId: process.env.STRIPE_PRICE_INDIVIDUAL ?? '',
  },
  {
    id: 'team',
    name: 'Team',
    price: 49,
    monthlySubtitles: 200000,
    seats: 5,
    stripePriceId: process.env.STRIPE_PRICE_TEAM ?? '',
  },
]
