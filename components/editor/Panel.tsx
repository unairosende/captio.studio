'use client'

import { useMemo, useState } from 'react'

import CommentsPanel from '@/components/comments/CommentsPanel'
import type { GlossaryEntry } from '@/lib/ai/prompt'
import { SOURCE_LANGUAGES } from '@/lib/providers'
import { qcForMode, qcTrack, wordDiff } from '@/lib/subtitles'
import { useSubtitleStore } from '@/store/useSubtitleStore'

import s from './editor.module.css'
import type { Filter } from './CueTable'
import { langCode } from './useJobs'
import { usePasses } from './usePasses'

export type Section = 'review' | 'batch' | 'props' | 'comments'

interface Props {
  userId: string
  /** Whether the panel is showing. The commands inside it exist either way. */
  open: boolean
  section: Section
  onOpen: (sec: Section) => void
  onClose: () => void
  filter: Filter
  onFilter: (f: Filter) => void
}

const SECTIONS: [Section, string][] = [['review', 'Revisar'], ['batch', 'Lotes'], ['props', 'Propiedades'], ['comments', 'Comentarios']]

/**
 * The panel on the right: what the table is not.
 *
 * Reviewing with the model and its notes, the corrections that touch every
 * cue at once, the properties of the sequence and the project's glossary,
 * and the comments. Closed by default, because the table is the editor;
 * it opens on its own when a review is asked for from the palette.
 *
 * Every action here is also a ⌘K command whether the panel is open or not:
 * the palette reads the hidden buttons at the bottom when the visible ones
 * are not on screen.
 */
export default function Panel({ userId, open, section, onOpen, onClose, filter, onFilter }: Props) {
  const {
    subtitles, translations, backTranslations, reviewNotes, activeTab, outputMode, srcLang, allowRephrase, glossary, comments, sequenceId,
    selected, select, translateJob, reviewJob, backTranslateJob,
    setSrcLang, setOutputMode, setAllowRephrase, setGlossary, setComments, clearReviewNotes,
  } = useSubtitleStore()
  const passes = usePasses()

  const isSource = activeTab === 'source'
  const qc = useMemo(() => qcForMode(outputMode), [outputMode])
  const track = useMemo(() => (isSource ? subtitles : translations[activeTab] ?? []), [isSource, subtitles, translations, activeTab])
  const quality = useMemo(() => qcTrack(track, qc, isSource ? [] : glossary), [track, qc, isSource, glossary])
  const errs = [...quality.values()].filter(q => q.status === 'error').length

  const cue = selected === null ? undefined : track.find(c => c.index === selected)
  const source = selected === null ? undefined : subtitles.find(c => c.index === selected)
  const cueQc = cue ? quality.get(cue.index) : undefined
  const notes = isSource ? undefined : reviewNotes[activeTab]
  const note = !isSource && cue ? notes?.find(n => n.cue === cue.index) : undefined
  const back = !isSource && cue ? backTranslations[activeTab]?.find(b => b.index === cue.index) : undefined
  const diff = back && source ? wordDiff(source.text, back.text) : null
  const hasBack = !isSource && !!backTranslations[activeTab]

  const onCue = cue ? comments.filter(c => c.cue_index === cue.index) : []
  const openOnCue = onCue.filter(c => !c.resolved).length
  const openAll = useMemo(() => {
    const m = new Map<number, number>()
    comments.forEach(c => { if (!c.resolved) m.set(c.cue_index, (m.get(c.cue_index) ?? 0) + 1) })
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [comments])

  const [reviseText, setReviseText] = useState('')
  const [thread, setThread] = useState(false)

  const showing = (sec: Section) => open && section === sec
  const goTo = (index: number) => {
    select(index)
    document.querySelector(`[data-cue="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  const tone = (st?: string) => (st === 'error' ? 'danger' : st === 'warn' ? 'warn' : undefined)

  const review = () => { onOpen('review'); void passes.review() }
  const backTranslate = () => { onOpen('review'); void passes.backTranslate() }

  const updateTerm = (i: number, patch: Partial<GlossaryEntry>) =>
    setGlossary(glossary.map((g, j) => (j === i ? { ...g, ...patch } : g)))

  /* Unseen: the same actions as the visible ones, listed only while those
     are off screen, so ⌘K names each thing exactly once. */
  const hidden = (
    <span hidden>
      {!showing('review') && !isSource && !reviewJob.running && <button data-cmd="Revisar la traducción y señalar lo que está mal" onClick={review} />}
      {!showing('review') && !isSource && <button data-cmd={hasBack ? 'Ocultar la retrotraducción' : 'Retrotraducir para comprobar el sentido'} onClick={backTranslate} />}
      {!showing('batch') && !isSource && errs > 0 && <button data-cmd="Acortar los cues demasiado largos" onClick={() => { onOpen('batch'); void passes.fixOverlength() }} />}
      {!showing('batch') && !isSource && <button data-cmd="Corregir la traducción con una nota" onClick={() => onOpen('batch')} />}
      {!showing('props') && <button data-cmd="Abrir el glosario" onClick={() => onOpen('props')} />}
      {!showing('props') && <button data-cmd="Añadir un término al glosario" onClick={() => { onOpen('props'); setGlossary([...glossary, { term: '', translation: '' }]) }} />}
      {!showing('comments') && <button data-cmd="Ver los comentarios" onClick={() => onOpen('comments')} />}
      {open ? <button data-cmd="Cerrar el panel" onClick={onClose} /> : <button data-cmd="Abrir el panel" onClick={() => onOpen(section)} />}
    </span>
  )

  if (!open) return hidden

  return (
    <aside className={s.side} aria-label="Panel">
      {thread && sequenceId && cue && (
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
        <div className="seg" role="tablist" aria-label="Sección">
          {SECTIONS.map(([id, name]) => (
            <button key={id} role="tab" aria-selected={section === id} onClick={() => onOpen(id)}>{name}</button>
          ))}
        </div>
        <button className="btn btn-quiet" aria-label="Cerrar el panel" onClick={onClose}>×</button>
      </div>

      <div className={s.sideBody}>
        {/* ── Revisar ─────────────────────────────────────────────────────── */}
        {section === 'review' && (isSource ? (
          <div className={s.section}>
            <div className={s.hint}>Elige una pestaña de idioma para revisarla contra el original.</div>
          </div>
        ) : (
          <>
            <div className={s.section}>
              <div className={s.chips}>
                <button className="btn btn-primary" data-cmd="Revisar la traducción y señalar lo que está mal" disabled={reviewJob.running} aria-busy={reviewJob.running || undefined}
                  onClick={() => void passes.review()}>Revisar con IA</button>
                <button className="btn" data-cmd={hasBack ? 'Ocultar la retrotraducción' : 'Retrotraducir para comprobar el sentido'} aria-busy={backTranslateJob.running || undefined}
                  onClick={() => void passes.backTranslate()}>{hasBack ? 'Ocultar retrotraducción' : 'Retrotraducir'}</button>
              </div>
              <div className={s.hint}>La revisión lee {langCode(activeTab)} contra el original y señala lo que lo contradice. La retrotraducción lo vuelve a traducir al original para comparar el sentido.</div>
              {reviewJob.running && <div className={s.jobMsg}>{reviewJob.message}</div>}
              {(reviewJob.error || backTranslateJob.error) && <div className={s.jobMsg} data-tone="danger">{reviewJob.error ?? backTranslateJob.error}</div>}
            </div>

            {notes && (
              <div className={s.section}>
                <span className="caps"><span>Notas · {langCode(activeTab)}</span><span>{notes.length}</span></span>
                {notes.length === 0
                  ? <div className={s.hint}>Nada que señalar: nada contradice el original.</div>
                  : <div className={s.notes}>
                      {notes.map(n => (
                        <button key={n.cue} className={s.note} aria-current={selected === n.cue} onClick={() => goTo(n.cue)}>
                          <b data-level={n.level}>#{n.cue}</b><span>{n.note}</span>
                        </button>
                      ))}
                    </div>}
                <div className={s.chips}>
                  {notes.length > 0 && <button className="btn btn-quiet" aria-pressed={filter === 'noted'} onClick={() => onFilter(filter === 'noted' ? null : 'noted')}>{filter === 'noted' ? 'Ver todos' : 'Solo estos'}</button>}
                  <button className="btn btn-quiet" onClick={() => { clearReviewNotes(activeTab); if (filter === 'noted') onFilter(null) }}>Descartar</button>
                </div>
              </div>
            )}

            {cue ? (
              <div className={s.section}>
                <span className="caps">
                  <span>Cue {cue.index}</span>
                  <span data-tone={tone(cueQc?.status)}>{!cueQc || cueQc.status === 'ok' ? 'limpio' : cueQc.status === 'warn' ? 'aviso' : 'error'}</span>
                </span>
                {source && <div className={s.original}>{source.text}</div>}
                {cueQc && cueQc.issues.length > 0 && (
                  <div className={s.issues}>
                    {cueQc.issues.map((issue, i) => <div key={i} className={s.issue} data-level={issue.level}>{issue.msg}</div>)}
                  </div>
                )}
                {note && <div className={s.issue} data-level={note.level}>{note.note}</div>}
                {diff && (
                  <>
                    <div className={s.diff}>
                      {diff.map((op, i) =>
                        op.type === 'eq' ? <span key={i}>{op.val} </span>
                        : op.type === 'ins' ? <span key={i} className={s.ins}>{op.val} </span>
                        : <span key={i} className={s.del}>{op.val} </span>,
                      )}
                    </div>
                    <div className={s.hint}>Lo tachado está en el original y no vuelve; lo verde vuelve sin estar. Es una pista, no un veredicto.</div>
                  </>
                )}
              </div>
            ) : (
              <div className={s.section}><div className={s.hint}>Elige un cue en la tabla y aquí sale lo que el control de calidad y la revisión dicen de él.</div></div>
            )}
          </>
        ))}

        {/* ── Lotes ───────────────────────────────────────────────────────── */}
        {section === 'batch' && (isSource ? (
          <div className={s.section}>
            <div className={s.hint}>Las correcciones en lote se aplican a una traducción. Elige una pestaña de idioma.</div>
          </div>
        ) : (
          <>
            <div className={s.section}>
              <span className="caps">Acortar los largos</span>
              <div className={s.hint}>{errs ? `${errs} cues pasan el límite de ${qc.maxChars} caracteres por línea.` : `Ningún cue pasa el límite de ${qc.maxChars} caracteres por línea.`} El modelo reescribe solo esos, más cortos; el resto vuelve intacto.</div>
              <div>
                <button className="btn" data-cmd="Acortar los cues demasiado largos" disabled={!errs || translateJob.running} aria-busy={translateJob.running || undefined}
                  onClick={() => void passes.fixOverlength()}>{errs ? `Acortar ${errs} cues` : 'Acortar'}</button>
              </div>
            </div>
            <div className={s.section}>
              <span className="caps">Corregir con una nota</span>
              <textarea className="field" rows={5} maxLength={2000} value={reviseText} onChange={e => setReviseText(e.target.value)}
                placeholder={'¿Qué hay que cambiar? Nombra los números de cue — el resto vuelve intacto.\n\np. ej. 18: quita el final repetido, ya está en el 19. 53: «Reserva de la Familia» con mayúsculas.'} />
              <div className={s.chips} style={{ alignItems: 'center' }}>
                <button className="btn btn-primary" data-cmd="Corregir la traducción con una nota" disabled={!reviseText.trim() || translateJob.running} aria-busy={translateJob.running || undefined}
                  onClick={() => void passes.revise(reviseText)}>Aplicar a {langCode(activeTab)}</button>
                <span className={s.counter}>{reviseText.length}/2000</span>
              </div>
              {translateJob.running && <div className={s.jobMsg}>{translateJob.message}</div>}
              {translateJob.error && <div className={s.jobMsg} data-tone="danger">{translateJob.error}</div>}
            </div>
          </>
        ))}

        {/* ── Propiedades ─────────────────────────────────────────────────── */}
        {section === 'props' && (
          <>
            <div className={s.section}>
              <span className="caps">Secuencia</span>
              <div>
                <label className="caps" htmlFor="pSrcLang">Idioma de origen</label>
                <div className="select-wrap">
                  <select id="pSrcLang" className="field" value={srcLang} onChange={e => setSrcLang(e.target.value)}>
                    {SOURCE_LANGUAGES.map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <span className="caps">Formato de salida</span>
                <div className={s.radios}>
                  <label><input type="radio" name="pMode" checked={outputMode === 'horizontal'} onChange={() => setOutputMode('horizontal')} /> Horizontal</label>
                  <label><input type="radio" name="pMode" checked={outputMode === 'vertical'} onChange={() => setOutputMode('vertical')} /> Vertical (parte los largos al exportar)</label>
                </div>
              </div>
              <div className={s.hint}>Máximo {qc.maxChars} caracteres por línea · aviso a partir de {qc.cpsWarn} cps · error a partir de {qc.cpsError} cps.</div>
              <div className={s.radios}>
                <label><input type="checkbox" checked={allowRephrase} onChange={e => setAllowRephrase(e.target.checked)} /> Permitir reformular para que quepa</label>
              </div>
            </div>
            <div className={s.section}>
              <span className="caps"><span>Glosario del proyecto</span><span>{glossary.length}</span></span>
              <div className={s.hint}>Cada secuencia de este proyecto traduce estos términos igual. Deja la traducción vacía para conservar el término tal cual.</div>
              <div className={s.glossary}>
                {glossary.map((entry, i) => (
                  <div key={i} className={s.term}>
                    <input className="field" value={entry.term} onChange={e => updateTerm(i, { term: e.target.value })} placeholder="Término" spellCheck={false} aria-label="Término" />
                    <input className="field" value={entry.translation ?? ''} onChange={e => updateTerm(i, { translation: e.target.value })} placeholder="Tal cual" spellCheck={false} aria-label="Traducción" />
                    <button className="btn btn-quiet" aria-label="Quitar el término" onClick={() => setGlossary(glossary.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
              </div>
              <div><button className="btn" data-cmd="Añadir un término al glosario" onClick={() => setGlossary([...glossary, { term: '', translation: '' }])}>Añadir término</button></div>
            </div>
          </>
        )}

        {/* ── Comentarios ─────────────────────────────────────────────────── */}
        {section === 'comments' && (!sequenceId ? (
          <div className={s.section}>
            <div className={s.hint}>Guarda la secuencia para poder comentar: una nota necesita una secuencia de la que colgar.</div>
          </div>
        ) : (
          <>
            {cue ? (
              <div className={s.section}>
                <span className="caps"><span>Cue {cue.index}</span><span>{openOnCue ? `${openOnCue} abiertos` : onCue.length ? 'todos resueltos' : 'sin comentarios'}</span></span>
                {onCue.slice(-3).map(c => (
                  <div key={c.id} className={s.hint}><b>{c.author_name ?? 'Cliente'}</b> · {c.body}</div>
                ))}
                <div><button className="btn" onClick={() => setThread(true)}>{onCue.length ? 'Abrir el hilo' : 'Comentar'}</button></div>
              </div>
            ) : (
              <div className={s.section}><div className={s.hint}>Elige un cue para ver su hilo o comentarlo.</div></div>
            )}
            <div className={s.section}>
              <span className="caps"><span>Abiertos</span><span>{openAll.reduce((n, [, k]) => n + k, 0)}</span></span>
              {openAll.length === 0
                ? <div className={s.hint}>Ningún comentario abierto.</div>
                : <div className={s.notes}>
                    {openAll.map(([index, n]) => (
                      <button key={index} className={s.note} aria-current={selected === index} onClick={() => goTo(index)}>
                        <b>#{index}</b><span>{n} {n === 1 ? 'abierto' : 'abiertos'}</span>
                      </button>
                    ))}
                  </div>}
            </div>
          </>
        ))}
      </div>

      {hidden}
    </aside>
  )
}
