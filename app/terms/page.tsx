import LegalPage from '@/components/legal/LegalPage'
import { BRAND } from '@/lib/brand'
import { LEGAL_DOCS } from '@/lib/legal'

export const metadata = { title: `${LEGAL_DOCS.terms} — ${BRAND.name}` }

export default function Page() {
  return <LegalPage slug="terms" />
}
