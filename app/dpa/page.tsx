import LegalPage from '@/components/legal/LegalPage'
import { LEGAL_DOCS } from '@/lib/legal'

export const metadata = { title: `${LEGAL_DOCS.dpa} — Captio` }

export default function Page() {
  return <LegalPage slug="dpa" />
}
