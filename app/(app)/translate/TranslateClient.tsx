'use client'

import { useEffect, useState } from 'react'

import CueTable, { type Filter } from '@/components/editor/CueTable'
import Header from '@/components/editor/Header'
import Panel, { type Section } from '@/components/editor/Panel'
import Steps, { type Step } from '@/components/editor/Steps'
import s from '@/components/editor/editor.module.css'
import CommandPalette from '@/components/palette/CommandPalette'
import TeamPanel from '@/components/team/TeamPanel'
import Timeline from '@/components/timeline/Timeline'
import type { GlossaryEntry } from '@/lib/ai/prompt'
import type { Entitlement } from '@/lib/entitlement'
import { useSubtitleStore } from '@/store/useSubtitleStore'
import type { ProjectComment } from '@/types/comment'
import type { Subtitle, TranslationStore } from '@/types/subtitle'

interface Props {
  /**
   * The id decides one thing only: whose comments carry a delete button. The
   * role decides who may invite and remove — read from the session on the
   * server, so the panel cannot be talked into offering buttons that would be
   * refused anyway.
   */
  user: { id: string; email: string; name: string; role: string }
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
    /** The upload attached to this sequence, if any — what the waveform auto-loads. */
    mediaId: string | null
  } | null
}

/**
 * The editor: the steps in a line across the top, the cues underneath with a
 * tab per language and the text corrected in place, a panel on the right
 * that opens when asked, and the waveform along the bottom — the instrument
 * timing depends on.
 *
 * Structure B from the redesign with C's top bar, after the first review.
 * The logic underneath is the one that was already here; what changed is
 * where each control appears, which is only where it applies.
 */
export default function TranslateClient({ user, entitlement, project, sequence }: Props) {
  const { undo, redo, openSequence, newSequence, setComments } = useSubtitleStore()
  const [team, setTeam] = useState(false)
  const [palette, setPalette] = useState(false)
  const [filter, setFilter] = useState<Filter>(null)
  // The step whose drawer is open. None to begin with: the drawers float
  // over the table, and the empty table has its own button to the first one.
  const [step, setStep] = useState<Step | null>(null)
  const [panel, setPanel] = useState(false)
  const [section, setSection] = useState<Section>('review')
  const openPanel = (sec: Section) => { setSection(sec); setPanel(true) }

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
        mediaId: sequence.mediaId,
      })
      setComments(sequence.comments)
    } else {
      newSequence({ id: project.id, name: project.name, glossary: project.glossary })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequence?.id, project.id])

  /**
   * The shortcuts, one listener.
   *
   * ⌘K opens the palette from anywhere, including out of a half-typed
   * subtitle: it is how you leave where you are. ⌘S saves and ⌘E exports by
   * pressing the button that would — so a shortcut can never do something the
   * page does not offer. ⌘Z is the opposite: while a field has focus the
   * browser's own undo is the right one, per character and caret-aware, and
   * hijacking it would throw away a half-written line to take back a drag.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      const press = (cmd: string) => {
        const el = document.querySelector<HTMLButtonElement>(`[data-cmd="${cmd}"]`)
        if (el && !el.disabled) { e.preventDefault(); el.click() }
      }

      if (key === 'k') { e.preventDefault(); setPalette(p => !p); return }
      if (key === 's') { press('Guardar la secuencia'); return }
      if (key === 'e') { press('Exportar la pestaña en pantalla'); return }
      if (key !== 'z') return

      const el = e.target as HTMLElement | null
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable
      if (typing) return

      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [redo, undo])

  return (
    <div className={`v2 ${s.editor}`}>
      {team && <TeamPanel currentUserId={user.id} role={user.role} onClose={() => setTeam(false)} />}
      {palette && <CommandPalette onClose={() => setPalette(false)} />}

      <Header user={user} project={project} onPalette={() => setPalette(true)} onTeam={() => setTeam(true)} />
      <Steps entitlement={entitlement} step={step} onStep={setStep} panel={panel} onPanel={() => setPanel(p => !p)} />
      <CueTable userId={user.id} filter={filter} onFilter={setFilter} onImport={() => setStep('import')} />
      <Panel userId={user.id} open={panel} section={section} onOpen={openPanel} onClose={() => setPanel(false)} filter={filter} onFilter={setFilter} />
      <div className={s.wave}><Timeline /></div>
    </div>
  )
}
