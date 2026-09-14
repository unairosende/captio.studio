'use client'

import { useEffect, useMemo, useState, type KeyboardEvent, type RefObject } from 'react'

import CommentsPanel from '@/components/comments/CommentsPanel'
import type { GlossaryEntry } from '@/lib/ai/prompt'
import { charStatus, cueCps, qcForMode, qcTrack, wordDiff } from '@/lib/subtitles'
import { playheadSeconds } from '@/lib/timeline/playhead'
import { useSubtitleStore } from '@/store/useSubtitleStore'

import s from './editor.module.css'
import { langCode } from './useJobs'

interface Props {
  userId: string
  /** The textarea, so the table can hand it the focus on Enter. */
  editRef: RefObject<HTMLTextAreaElement | null>
  /** Whether the inspector is where the typing is happening. */
  onFocus: (focused: boolean) => void
}

/**
 * The inspector: what is selected, in full.
 *
 * A cue when one is selected — its times, the original, the translation to
 * edit, what the quality check says, the back-translation, the reviewer's
 * note and the comments. The project otherwise: the glossary. Everything the
 * old card stacked under the text lives here instead, so a row in the table
 * never has to grow to say it.
 */
export default function Inspector({ userId, editRef, onFocus }: Props) {
  const {
    subtitles, translations, backTranslations, reviewNotes, activeTab, outputMode, glossary, comments, sequenceId,
    selected, select, updateSubtitle, pushUndo, splitSubtitle, deleteSubtitle, setGlossary, setComments, getFinalSubs,
  } = useSubtitleStore()

  const isSource = activeTab === 'source'
  const qc = useMemo(() => qcForMode(outputMode), [outputMode])
  const activeTrack = isSource ? undefined : translations[activeTab]
  const track = useMemo(
    () => (isSource ? subtitles : activeTrack ? getFinalSubs(activeTab) : []),
    [isSource, subtitles, activeTrack, getFinalSubs, activeTab],
  )
  const cue = selected === null ? undefined : track.find(c => c.index === selected)
  const source = selected === null ? undefined : subtitles.find(c => c.index === selected)

  const quality = useMemo(
    () => (cue ? qcTrack(track, qc, isSource ? [] : glossary).get(cue.index) : undefined),
    [cue, track, qc, isSource, glossary],
  )
  const back = !isSource && cue ? backTranslations[activeTab]?.find(b => b.index === cue.index) : undefined
  const diff = back && source ? wordDiff(source.text, back.text) : null
  const note = !isSource && cue ? reviewNotes[activeTab]?.find(n => n.cue === cue.index) : undefined
  const onCue = cue ? comments.filter(c => c.cue_index === cue.index) : []
  const openComments = onCue.filter(c => !c.resolved).length

  /* The draft: what is being typed, committed once on leaving, not per key.
     Keyed on the cue and the language so arriving at another cue replaces
     it, and an edit committed elsewhere (a pass, an undo) shows up. */
  const [draft, setDraft] = useState({ key: '', text: '' })
  const draftKey = `${activeTab}:${cue?.index ?? ''}:${cue?.text ?? ''}`
  const text = draft.key === draftKey ? draft.text : (cue?.text ?? '')
  const setText = (t: string) => setDraft({ key: draftKey, text: t })

  const [thread, setThread] = useState(false)
  const editable = !isSource && !!cue

  // A cue that stops existing — deleted, or the language closed — leaves
  // nothing to point at.
  useEffect(() => {
    if (selected !== null && !cue) select(null)
  }, [selected, cue, select])

  function commit() {
    if (!editable || !cue || text === cue.text) return
    // Committed once per edit, not per keystroke, so this is one step.
    pushUndo()
    updateSubtitle(activeTab, cue.index, text)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') { e.preventDefault(); setText(cue?.text ?? ''); e.currentTarget.blur() }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); e.currentTarget.blur() }
  }

  const longest = Math.max(...text.split('\n').map(l => l.length))
  const status = charStatus(text, qc)
  const cps = cue ? cueCps({ ...cue, text }) : null
  const tone = (st: string) => (st === 'error' ? 'danger' : st === 'warn' ? 'warn' : undefined)

  /* ── The project, when nothing is selected ─────────────────────────────── */

  if (!cue) {
    const update = (i: number, patch: Partial<GlossaryEntry>) =>
      setGlossary(glossary.map((g, j) => (j === i ? { ...g, ...patch } : g)))
    return (
      <aside className={s.side} aria-label="Inspector">
        <div className={s.sideHead}>
          <h2>Proyecto</h2>
          <span className="muted">{subtitles.length} cues</span>
        </div>
        <div className={s.section}>
          <span className="caps"><span>Glosario</span><span>{glossary.length}</span></span>
          <div className={s.hint}>Cada secuencia de este proyecto traduce estos términos igual. Deja la traducción vacía para conservar el término tal cual.</div>
          <div className={s.glossary}>
            {glossary.map((entry, i) => (
              <div key={i} className={s.term}>
                <input className="field" value={entry.term} onChange={e => update(i, { term: e.target.value })} placeholder="Término" spellCheck={false} aria-label="Término" />
                <input className="field" value={entry.translation ?? ''} onChange={e => update(i, { translation: e.target.value })} placeholder="Tal cual" spellCheck={false} aria-label="Traducción" />
                <button className="btn btn-quiet" aria-label="Quitar el término" onClick={() => setGlossary(glossary.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
          <button className="btn" data-cmd="Añadir un término al glosario" onClick={() => setGlossary([...glossary, { term: '', translation: '' }])}>Añadir término</button>
        </div>
        <div className={s.section}>
          <span className="caps">Cómo se edita</span>
          <div className={s.hint}>
            Elige un cue en la tabla — o muévete con <span className="kbd">↑↓</span> — y aquí aparece entero. <span className="kbd">⏎</span> para
            corregir la traducción, <span className="kbd">⌘⏎</span> para darla por buena, <span className="kbd">esc</span> para dejarla como estaba.
          </div>
        </div>
      </aside>
    )
  }

  /* ── The cue ──────────────────────────────────────────────────────────── */

  return (
    <aside className={s.side} aria-label="Inspector">
      {thread && sequenceId && (
        <CommentsPanel
          sequenceId={sequenceId}
          cueIndex={cue.index}
          lang={isSource ? null : activeTab}
          comments={comments}
          onChange={setComments}
          isMine={c => c.author_id === userId}
          onClose={() => setThread(false)}
        />
      )}

      <div className={s.sideHead}>
        <h2>Cue {cue.index}</h2>
        <span className="muted" data-tone={!quality || quality.status === 'ok' ? undefined : quality.status === 'warn' ? 'warn' : 'danger'}>
          {!quality || quality.status === 'ok' ? 'limpio' : quality.status === 'warn' ? 'aviso' : 'error'}
        </span>
      </div>
      <div className={s.sideTools}>
        <div className={s.chips}>
          <button className="btn btn-quiet" data-cmd="Comentar este cue" disabled={!sequenceId} title={sequenceId ? undefined : 'Guarda la secuencia para poder comentar'} onClick={() => setThread(true)}>
            {openComments ? `${openComments} ●` : 'Comentar'}
          </button>
          {/* Cut where the listening stopped. With no audio there is no playhead and the split falls to the middle. */}
          <button className="btn btn-quiet" data-cmd="Partir el cue por el cabezal" onClick={() => splitSubtitle(cue.index, playheadSeconds() ?? undefined)}>Partir</button>
          <button className="btn btn-quiet" data-cmd="Borrar el cue" onClick={() => { if (confirm(`¿Borrar el cue ${cue.index} en todos los idiomas?`)) { deleteSubtitle(cue.index); select(null) } }}>Borrar</button>
        </div>
      </div>

      <div className={s.section}>
        <span className="caps">Tiempos</span>
        <div className={s.times}>
          <div><small>in</small>{cue.start}</div>
          <div><small>out</small>{cue.end}</div>
        </div>
        <div className={s.hint}>Arrastra el bloque o sus bordes en la onda para ajustarlos.</div>
      </div>

      {!isSource && source && (
        <div className={s.section}>
          <span className="caps">Original</span>
          <div className={s.original}>{source.text}</div>
        </div>
      )}

      <div className={s.section}>
        <span className="caps"><span>{isSource ? 'Original' : langCode(activeTab)}</span>{editable && <span>⌘⏎ da por buena</span>}</span>
        {editable ? (
          <textarea
            ref={editRef}
            className="field"
            rows={Math.max(2, text.split('\n').length + 1)}
            value={text}
            onChange={e => setText(e.target.value)}
            onFocus={() => onFocus(true)}
            onBlur={() => { commit(); onFocus(false) }}
            onKeyDown={onKey}
            spellCheck
            aria-label={`Texto en ${activeTab}`}
          />
        ) : (
          <div className={s.original} data-ink>{cue.text}</div>
        )}
        <div className={s.counter}>
          <b data-tone={tone(status)}>{longest}/{qc.maxChars}</b> caracteres por línea
          <span>·</span>
          <b data-tone={cps !== null && cps > qc.cpsError ? 'danger' : cps !== null && cps > qc.cpsWarn ? 'warn' : undefined}>{cps === null ? '—' : cps.toFixed(1).replace('.', ',')}</b> cps
        </div>
      </div>

      {quality && quality.issues.length > 0 && (
        <div className={s.section}>
          <span className="caps">Control de calidad</span>
          <div className={s.issues}>
            {quality.issues.map((issue, i) => <div key={i} className={s.issue} data-level={issue.level}>{issue.msg}</div>)}
          </div>
        </div>
      )}

      {note && (
        <div className={s.section}>
          <span className="caps">Nota de la revisión</span>
          <div className={s.issue} data-level={note.level}>{note.note}</div>
        </div>
      )}

      {diff && (
        <div className={s.section}>
          <span className="caps">Retrotraducción</span>
          <div className={s.diff}>
            {diff.map((op, i) =>
              op.type === 'eq' ? <span key={i}>{op.val} </span>
              : op.type === 'ins' ? <span key={i} className={s.ins}>{op.val} </span>
              : <span key={i} className={s.del}>{op.val} </span>,
            )}
          </div>
          <div className={s.hint}>Lo tachado está en el original y no vuelve; lo verde vuelve sin estar. Es una pista, no un veredicto.</div>
        </div>
      )}

      {onCue.length > 0 && (
        <div className={s.section}>
          <span className="caps"><span>Comentarios</span><span>{openComments ? `${openComments} abiertos` : 'todos resueltos'}</span></span>
          <div className={s.hint}>{onCue[onCue.length - 1].body}</div>
          <button className="btn btn-quiet" onClick={() => setThread(true)}>Abrir el hilo</button>
        </div>
      )}
    </aside>
  )
}
