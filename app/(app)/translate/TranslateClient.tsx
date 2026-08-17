'use client'

import Sidebar from '@/components/sidebar/Sidebar'
import LangTabsBar from '@/components/editor/LangTabsBar'
import EditorArea from '@/components/editor/EditorArea'
import SequenceBar from '@/components/sequences/SequenceBar'
import Timeline from '@/components/timeline/Timeline'
import TeamPanel from '@/components/team/TeamPanel'
import CommandPalette from '@/components/palette/CommandPalette'
import { useEffect, useState } from 'react'

import { signOut as endSession } from '@/lib/auth/client'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import type { GlossaryEntry } from '@/lib/ai/prompt'
import type { Entitlement } from '@/lib/entitlement'
import type { ProjectComment } from '@/types/comment'
import type { Subtitle, TranslationStore } from '@/types/subtitle'
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
  /** The project being worked inside. Always present: the page refuses without one. */
  project: { id: string; name: string; glossary: GlossaryEntry[] }
  /**
   * The sequence to open, when the URL named one.
   *
   * Resolved on the server rather than fetched here on mount. The page is
   * already a round trip that knows who is asking; doing it again from the
   * browser would draw an empty editor first and fill it a moment later.
   */
  sequence: {
    id: string
    name: string
    version: number
    subtitles: Subtitle[]
    translations: TranslationStore
    comments: ProjectComment[]
  } | null
}

export default function TranslateClient({ user, entitlement, project, sequence }: Props) {
  const router = useRouter()
  const { undo, redo, openSequence, newSequence, setComments } = useSubtitleStore()
  const [team, setTeam] = useState(false)
  const [palette, setPalette] = useState(false)

  /**
   * Seed the store from what the server already resolved.
   *
   * Keyed on the sequence id so that arriving at a different sequence replaces
   * the editor's contents, and re-rendering for any other reason does not — the
   * store is where the unsaved work lives, and re-seeding it would throw away
   * whatever is being typed.
   */
  useEffect(() => {
    if (sequence) {
      openSequence({
        id: sequence.id,
        name: sequence.name,
        version: sequence.version,
        subtitles: sequence.subtitles,
        translations: sequence.translations,
        projectId: project.id,
        projectName: project.name,
        glossary: project.glossary,
      })
      setComments(sequence.comments)
    } else {
      newSequence({ id: project.id, name: project.name, glossary: project.glossary })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequence?.id, project.id])

  /**
   * Two shortcuts, one listener.
   *
   * ⌘K opens the palette from anywhere, including out of a half-typed subtitle:
   * it is how you leave where you are, so refusing it while a field has focus
   * would defeat it.
   *
   * ⌘Z is the opposite. While a textarea has focus the browser's own undo is
   * the right one — it works per character and knows where the caret is.
   * Hijacking it there would throw away a half-written line in order to take
   * back an unrelated drag.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()

      if (key === 'k') {
        e.preventDefault()
        setPalette(p => !p)
        return
      }
      if (key !== 'z') return

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

      {palette && <CommandPalette onClose={() => setPalette(false)} />}

      {/* Topbar */}
      <div style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em' }}>
          Captio
        </div>
        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontFamily: 'var(--mono)', background: 'var(--accent-dim)', color: '#8ba8ff', marginLeft: 4 }}>
          {entitlement.plan}
        </span>

        {/* The way out, and where you are. An editor with no route back to the
            work it belongs to is a room with the door painted over: until now
            the only exits were the back button and re-typing the URL. */}
        <button
          data-cmd="Go back to the project"
          onClick={() => router.push(`/projects/${project.id}`)}
          title="Back to the project"
          style={{ marginLeft: 6, fontSize: 12, color: 'var(--text3)', cursor: 'pointer', background: 'none', border: 'none', padding: '4px 8px', borderRadius: 4, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          ← {project.name}
        </button>

        <div style={{ marginLeft: 4 }}>
          <SequenceBar />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* inline-flex and nowrap: as two inline children in a bar that
              shrinks, this wrapped — the magnifier on one line, ⌘K on the next. */}
          <button onClick={() => setPalette(true)} title="Search and commands ⌘K" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', flexShrink: 0, fontSize: 12, color: 'var(--text3)', cursor: 'pointer', background: 'none', border: 'none', padding: '4px 8px', borderRadius: 4 }}>
            ⌕ <span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>⌘K</span>
          </button>
          <button data-cmd="Manage the team" onClick={() => setTeam(true)} style={{ fontSize: 12, color: 'var(--text3)', cursor: 'pointer', background: 'none', border: 'none', padding: '4px 8px', borderRadius: 4 }}>
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
