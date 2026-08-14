'use client'

import Sidebar from '@/components/sidebar/Sidebar'
import LangTabsBar from '@/components/editor/LangTabsBar'
import EditorArea from '@/components/editor/EditorArea'
import ProjectBar from '@/components/projects/ProjectBar'
import Timeline from '@/components/timeline/Timeline'
import TeamPanel from '@/components/team/TeamPanel'
import { useEffect, useState } from 'react'

import { signOut as endSession } from '@/lib/auth/client'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import type { Entitlement } from '@/lib/entitlement'
import { useRouter } from 'next/navigation'

interface Props {
  /**
   * The id decides one thing only: whose comments carry a delete button. The
   * role decides who may invite and remove — read from the session on the
   * server, so the panel cannot be talked into offering buttons that would be
   * refused anyway.
   */
  user: { id: string; email: string; role: string }
  entitlement: Entitlement
}

export default function TranslateClient({ user, entitlement }: Props) {
  const router = useRouter()
  const { undo, redo } = useSubtitleStore()
  const [team, setTeam] = useState(false)

  /**
   * Undo for the editor, not for the field somebody is typing in.
   *
   * While a textarea has focus the browser's own undo is the right one — it
   * works per character and knows where the caret is. Hijacking the shortcut
   * there would throw away a half-written line in order to take back an
   * unrelated drag.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return

      const el = e.target as HTMLElement | null
      const typing =
        el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable
      if (typing) return

      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [redo, undo])

  async function signOut() {
    await endSession()
    router.push('/login')
    // Server components cache the session; without this the next render could
    // still be the signed-in one.
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {team && (
        <TeamPanel currentUserId={user.id} role={user.role} onClose={() => setTeam(false)} />
      )}

      {/* Topbar */}
      <div style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em' }}>
          Captio
        </div>
        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontFamily: 'var(--mono)', background: 'var(--accent-dim)', color: '#8ba8ff', marginLeft: 4 }}>
          {entitlement.plan}
        </span>

        <div style={{ marginLeft: 10 }}>
          <ProjectBar />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setTeam(true)} style={{ fontSize: 12, color: 'var(--text3)', cursor: 'pointer', background: 'none', border: 'none', padding: '4px 8px', borderRadius: 4 }}>
            Team
          </button>
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
          <EditorArea userId={user.id} />
          <Timeline />
        </div>
      </div>
    </div>
  )
}
