'use client'

import Sidebar from '@/components/sidebar/Sidebar'
import LangTabsBar from '@/components/editor/LangTabsBar'
import EditorArea from '@/components/editor/EditorArea'
import Timeline from '@/components/timeline/Timeline'
import { signOut as endSession } from '@/lib/auth/client'
import type { Entitlement } from '@/lib/entitlement'
import { useRouter } from 'next/navigation'

interface Props {
  user: { email: string }
  entitlement: Entitlement
}

export default function TranslateClient({ user, entitlement }: Props) {
  const router = useRouter()

  async function signOut() {
    await endSession()
    router.push('/login')
    // Server components cache the session; without this the next render could
    // still be the signed-in one.
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Topbar */}
      <div style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em' }}>
          Captio
        </div>
        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontFamily: 'var(--mono)', background: 'var(--accent-dim)', color: '#8ba8ff', marginLeft: 4 }}>
          {entitlement.plan}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{user.email}</span>
          <button onClick={signOut} style={{ fontSize: 12, color: 'var(--text3)', cursor: 'pointer', background: 'none', border: 'none', padding: '4px 8px', borderRadius: 4, transition: 'color .15s' }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar entitlement={entitlement} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <LangTabsBar />
          <EditorArea />
          <Timeline />
        </div>
      </div>
    </div>
  )
}
