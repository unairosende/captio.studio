'use client'

import { useMemo, useState } from 'react'

import CommentsPanel from '@/components/comments/CommentsPanel'
import { qcFor, qcTrack, wordDiff } from '@/lib/subtitles'
import { termsInForce, useSubtitleStore } from '@/store/useSubtitleStore'

import s from './editor.module.css'
import type { Filter } from './CueTable'
import SequenceFields, { GlossaryFields, type Changed } from './SequenceFields'
import { SECTIONS, Sidebar, type Pane } from './Steps'
import { langCode, useTranscribe, useTranslate } from './useJobs'
import { usePasses } from './usePasses'

interface Props {
  userId: string
  /** What fills the sidebar; this draws it only when that is one of its sections. The commands exist either way. */
  open: Pane | null
  onOpen: (pane: Pane | null) => void
  filter: Filter
  onFilter: (f: Filter) => void
}

/**
 * What the table is not, in the sidebar the steps use.
 *
 * Reviewing — the model's notes, the corrections that touch every cue at
 * once, what the checks say of the cue in hand, for a translation or for
 * the original — then the properties of the sequence and the project's
 * glossary, and the comments: three icons on the rail, under the steps and
 * a rule. A review asked for from the palette opens its section.
 *
 * Every action here is also a ⌘K command whether its section shows or not:
 * the palette reads the hidden buttons at the bottom when the visible ones
 * are not on screen.
 */
export default function Panel({ userId, open, onOpen, filter, onFilter }: Props) {
  const {
    subtitles, translations, backTranslations, reviewNotes, activeTab, settings, allowRephrase, glossary, client, comments, sequenceId,
    selected, select, playback, translateJob, reviewJob, backTranslateJob, transcribeJob,
    setAllowRephrase, setGlossary, setComments, clearReviewNotes,
  } = useSubtitleStore()
  const passes = usePasses()
  const translate = useTranslate()
  const transcribe = useTranscribe()
  const langs = Object.keys(translations)

  const isSource = activeTab === 'source'
  const qc = useMemo(() => qcFor(settings), [settings])
  const track = useMemo(() => (isSource ? subtitles : translations[activeTab] ?? []), [isSource, subtitles, translations, activeTab])
  const quality = useMemo(
    () => qcTrack(track, qc, isSource ? [] : termsInForce({ glossary, client })),
    [track, qc, isSource, glossary, client],
  )
  const errs = [...quality.values()].filter(q => q.status === 'error').length

  const cue = selected === null ? undefined : track.find(c => c.index === selected)
  const source = selected === null ? undefined : subtitles.find(c => c.index === selected)
  const cueQc = cue ? quality.get(cue.index) : undefined
  const notes = reviewNotes[activeTab]
  const note = cue ? notes?.find(n => n.cue === cue.index) : undefined
  const label = isSource ? 'el original' : langCode(activeTab)
  const reviewCmd = isSource ? 'Revisar el original y señalar lo que está mal' : 'Revisar la traducción y señalar lo que está mal'
  const reviseCmd = isSource ? 'Corregir el original con una nota' : 'Corregir la traducción con una nota'
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

  /*
   * What moved in Propiedades since the cues were made, so the panel can offer
   * the way to adapt them: re-cut the lines locally, transcribe again, or
   * translate again. Nothing to adapt while there are no cues.
   */
  const [changed, setChanged] = useState<Set<Changed | 'glossary'>>(new Set())
  const [adapted, setAdapted] = useState<string | null>(null)
  const mark = (what: Changed | 'glossary') => {
    if (!subtitles.length) return
    setChanged(c => new Set(c).add(what))
    setAdapted(null)
  }
  const reanalyze = () => {
    const left = passes.relayout()
    setChanged(c => { const n = new Set(c); n.delete('layout'); return n })
    setAdapted(left ? `Líneas rehechas. ${left} cues siguen sin caber: acórtalos en Revisar o retranscribe.` : 'Líneas rehechas: todas caben en la nueva medida.')
  }
  const retranscribe = () => {
    if (!confirm('Retranscribir sustituye todos los cues y borra las traducciones, y gasta minutos. ¿Seguir?')) return
    setChanged(new Set())
    void transcribe.start()
  }
  const retranslate = async () => {
    if (!confirm(`Retraducir ${langs.map(langCode).join(', ')} pisa lo corregido a mano en esos idiomas. ¿Seguir?`)) return
    setChanged(new Set())
    for (const lang of langs) await translate.start(lang)
  }

  const section = SECTIONS.find(x => x.id === open)
  const showing = (sec: Pane) => open === sec
  const goTo = (index: number) => {
    select(index)
    document.querySelector(`[data-cue="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  const tone = (st?: string) => (st === 'error' ? 'danger' : st === 'warn' ? 'warn' : undefined)

  const review = () => { onOpen('review'); void passes.review() }
  const backTranslate = () => { onOpen('review'); void passes.backTranslate() }

  /* Unseen: the same actions as the visible ones, listed only while those
     are off screen, so ⌘K names each thing exactly once. */
  const hidden = (
    <span hidden>
      {!showing('review') && !reviewJob.running && <button data-cmd={reviewCmd} onClick={review} />}
      {!showing('review') && !isSource && <button data-cmd={hasBack ? 'Ocultar la retrotraducción' : 'Retrotraducir para comprobar el sentido'} onClick={backTranslate} />}
      {!showing('review') && errs > 0 && <button data-cmd="Acortar los cues demasiado largos" onClick={() => { onOpen('review'); void passes.fixOverlength() }} />}
      {!showing('review') && <button data-cmd={reviseCmd} onClick={() => onOpen('review')} />}
      {!showing('props') && <button data-cmd="Abrir el glosario" onClick={() => onOpen('props')} />}
      {!showing('props') && <button data-cmd="Añadir un término al glosario" onClick={() => { onOpen('props'); setGlossary([...glossary, { term: '', translation: '' }]) }} />}
      {!showing('comments') && <button data-cmd="Ver los comentarios" onClick={() => onOpen('comments')} />}
    </span>
  )

  if (!section) return hidden

  return (
    <Sidebar name={section.name} onFold={() => onOpen(null)}>
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

      <div className={s.sideBody}>
        {/* ── Revisar: la revisión, las notas, las correcciones en lote y el cue ── */}
        {open === 'review' && (
          <>
            <div className={s.section}>
              <div className={s.chips}>
                <button className="btn btn-primary" data-cmd={reviewCmd} disabled={reviewJob.running} aria-busy={reviewJob.running || undefined}
                  onClick={() => void passes.review()}>Revisar con IA</button>
                {!isSource && (
                  <button className="btn" data-cmd={hasBack ? 'Ocultar la retrotraducción' : 'Retrotraducir para comprobar el sentido'} aria-busy={backTranslateJob.running || undefined}
                    onClick={() => void passes.backTranslate()}>{hasBack ? 'Ocultar retrotraducción' : 'Retrotraducir'}</button>
                )}
              </div>
              <div className={s.hint}>
                {isSource
                  ? 'La revisión lee el original y señala lo que la transcripción oyó mal, las faltas y los términos escritos de dos maneras.'
                  : `La revisión lee ${label} contra el original y señala lo que lo contradice. La retrotraducción lo vuelve a traducir al original para comparar el sentido.`}
              </div>
              {reviewJob.running && <div className={s.jobMsg}>{reviewJob.message}</div>}
              {(reviewJob.error || backTranslateJob.error) && <div className={s.jobMsg} data-tone="danger">{reviewJob.error ?? backTranslateJob.error}</div>}
            </div>

            {notes && (
              <div className={s.section}>
                <span className="caps"><span>Notas · {label}</span><span>{notes.length}</span></span>
                {notes.length === 0
                  ? <div className={s.hint}>{isSource ? 'Nada que señalar en el original.' : 'Nada que señalar: nada contradice el original.'}</div>
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

            <div className={s.section}>
              <span className="caps">Acortar los largos</span>
              <div className={s.hint}>{errs ? `${errs} cues pasan el límite de ${qc.maxChars} caracteres por línea.` : `Ningún cue pasa el límite de ${qc.maxChars} caracteres por línea.`} {allowRephrase ? 'El modelo reescribe solo esos, más cortos; el resto vuelve intacto.' : 'Se vuelven a partir en líneas, sin cambiar una palabra.'}</div>
              <div className={s.radios}>
                <label><input type="checkbox" checked={allowRephrase} onChange={e => setAllowRephrase(e.target.checked)} /> Permitir reformular para que quepa</label>
              </div>
              <div>
                <button className="btn" data-cmd="Acortar los cues demasiado largos" disabled={!errs || translateJob.running} aria-busy={translateJob.running || undefined}
                  onClick={() => void passes.fixOverlength()}>{errs ? `Acortar ${errs} cues` : 'Acortar'}</button>
              </div>
            </div>

            <div className={s.section}>
              <span className="caps">Corregir con una nota</span>
              <textarea className="field" rows={5} maxLength={2000} value={reviseText} onChange={e => setReviseText(e.target.value)}
                placeholder={'¿Qué hay que cambiar? Nombra los números de cue — el resto vuelve intacto.\n\np. ej. 18: quita el final repetido, ya está en el 19. 53: «Reserva de la Familia» con mayúsculas.'} />
              <div className={s.chips}>
                <button className="btn btn-primary" data-cmd={reviseCmd} disabled={!reviseText.trim() || translateJob.running} aria-busy={translateJob.running || undefined}
                  onClick={() => void passes.revise(reviseText)}>Aplicar {isSource ? 'al original' : `a ${label}`}</button>
                <span className={s.counter}>{reviseText.length}/2000</span>
              </div>
              {translateJob.running && <div className={s.jobMsg}>{translateJob.message}</div>}
              {translateJob.error && <div className={s.jobMsg} data-tone="danger">{translateJob.error}</div>}
            </div>

            {cue ? (
              <div className={s.section}>
                <span className="caps">
                  <span>Cue {cue.index}</span>
                  <span data-tone={tone(cueQc?.status)}>{!cueQc || cueQc.status === 'ok' ? 'limpio' : cueQc.status === 'warn' ? 'aviso' : 'error'}</span>
                </span>
                {source && !isSource && <div className={s.original}>{source.text}</div>}
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
        )}

        {/* ── Propiedades ─────────────────────────────────────────────────── */}
        {open === 'props' && (
          <>
            <div className={s.section}>
              <span className="caps">Secuencia</span>
              <SequenceFields key={sequenceId ?? 'new'} idPrefix="p" onChange={mark} />
              <div className={s.radios}>
                <label><input type="checkbox" checked={allowRephrase} onChange={e => setAllowRephrase(e.target.checked)} /> Permitir reformular para que quepa</label>
              </div>
            </div>
            {changed.size > 0 && (
              <div className={s.section}>
                <span className="caps">Adaptar el contenido</span>
                <div className={s.hint}>Los cues que hay se hicieron con la configuración anterior.</div>
                <div className={s.adapt}>
                  {changed.has('layout') && (
                    <>
                      <button className="btn" onClick={reanalyze}>Reanalizar</button>
                      <span className={s.hint}>Vuelve a partir las líneas de todos los cues a la nueva medida. Sin modelo, no gasta.</span>
                    </>
                  )}
                  {playback && (
                    <>
                      <button className="btn" disabled={!playback.file || transcribeJob.running} aria-busy={transcribeJob.running || undefined} onClick={retranscribe}>Retranscribir</button>
                      <span className={s.hint}>{playback.file
                        ? 'Vuelve a transcribir el audio con la nueva configuración. Sustituye los cues y las traducciones; gasta minutos.'
                        : 'Para retranscribir, vuelve a cargar el vídeo o el audio con Sustituir, en la barra de la onda.'}</span>
                    </>
                  )}
                  {langs.length > 0 && !(changed.size === 1 && changed.has('sdh')) && (
                    <>
                      <button className="btn" disabled={translateJob.running} aria-busy={translateJob.running || undefined} onClick={() => void retranslate()}>Retraducir</button>
                      <span className={s.hint}>Traduce de nuevo {langs.map(langCode).join(' · ')}. Pisa lo corregido a mano.</span>
                    </>
                  )}
                </div>
                <div><button className="btn btn-quiet" onClick={() => setChanged(new Set())}>Dejarlo así</button></div>
              </div>
            )}
            {adapted && <div className={s.section}><div className={s.jobMsg} data-tone="ok" role="status">{adapted}</div></div>}
            <div className={s.section}>
              <GlossaryFields commands onChange={() => mark('glossary')} />
            </div>
          </>
        )}

        {/* ── Comentarios ─────────────────────────────────────────────────── */}
        {open === 'comments' && (!sequenceId ? (
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
    </Sidebar>
  )
}
