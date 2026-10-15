'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'

import { useAssistant, type Assistant, type Entry } from '@/components/assistant/useAssistant'
import { formatSize } from '@/lib/assistant/prompt'
import { describeSequence, shortLang } from '@/lib/lang'
import { formatDuration } from '@/lib/usage'

import s from './assistant.module.css'

interface Props {
  /** Whether the server holds a key for the model. Without one the page says so and offers the plain way. */
  configured: boolean
}

const WHO: Record<Entry['role'], string> = {
  user: 'Tú',
  assistant: 'Asistente',
  event: 'Captio',
  error: 'Captio',
}

/** What the attached file turned out to be, in one line. */
function fileLine(a: Assistant): string {
  if (a.probing) return 'leyendo…'
  const f = a.probe?.facts
  if (!f) return ''
  const size = formatSize(f.bytes)
  if (f.kind === 'video' || f.kind === 'audio') {
    const length = f.durationSeconds ? ` · ${formatDuration(f.durationSeconds)}` : ''
    const picture = f.width && f.height ? ` · ${f.width}×${f.height}` : ''
    return `${f.kind === 'video' ? 'Vídeo' : 'Audio'}${length}${picture} · ${size}`
  }
  if (f.kind === 'subtitles') return `${f.cueCount} subtítulos${f.timed ? '' : ' sin tiempos'} · ${size}`
  if (f.kind === 'text') return `Texto · ${size}`
  return `No se puede usar como material · ${size}`
}

/** What the plan will spend: the material once, however many languages and formats come out of it. */
function cost(a: Assistant): string {
  const f = a.probe?.facts
  const seconds = f?.durationSeconds ?? f?.spanSeconds ?? null
  return seconds ? `${formatDuration(seconds)} de tu plan, una sola vez` : ''
}

export default function AssistantClient({ configured }: Props) {
  const a = useAssistant()
  const [draft, setDraft] = useState('')
  const [dropping, setDropping] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const end = useRef<HTMLDivElement>(null)

  // The newest thing — an answer, a plan, the work — is always at the bottom,
  // next to where the reply is typed.
  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    end.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'end' })
  }, [a.entries.length, a.thinking, a.plan, a.brief, a.stage])

  async function submit() {
    const text = draft
    if (!text.trim()) return
    setDraft('')
    await a.say(text)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDropping(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped && a.stage === 'scope' && !a.busy) void a.attach(dropped)
  }

  const header = (
    <header className={`topbar ${s.head}`}>
      <Link href="/dashboard" className="brand">captio</Link>
      <span className="topbar-sep" />
      <nav className="crumbs" aria-label="Dónde estás">
        <Link href="/dashboard">Proyectos</Link>
        <span>/</span>
        <span>Proyecto nuevo</span>
      </nav>
    </header>
  )

  if (!configured) {
    return (
      <div className={s.page}>
        {header}
        <main className={s.main}>
          <div className="empty" data-kind="error">
            <span className="empty-title">El asistente no está disponible</span>
            <p>Este servidor no tiene clave para el modelo. Crea el proyecto desde el panel y trabaja en el editor como siempre.</p>
            <Link href="/dashboard" className="btn">Volver a proyectos</Link>
          </div>
        </main>
      </div>
    )
  }

  const canTalk = !a.busy && a.stage !== 'done'
  const targets = a.made.reduce((n, m) => n + m.targets.length, 0)

  return (
    <div className={s.page} onDragOver={e => { e.preventDefault(); setDropping(true) }} onDragLeave={() => setDropping(false)} onDrop={onDrop}>
      {header}

      <main className={s.main}>
        <h1 className={s.title}>Proyecto nuevo</h1>
        <p className={s.lede}>
          Adjunta el vídeo, el audio o los subtítulos y cuenta qué necesitas: idiomas, formatos, para quién
          es. El asistente pregunta lo que haga falta, te enseña el plan y no crea nada hasta que lo
          confirmas. Antes de traducir lee el texto y prepara instrucciones para que la traducción sea fiel.
        </p>

        <ol className={s.thread} aria-live="polite">
          {a.entries.map(e => (
            <li key={e.id} className={s.entry} data-role={e.role}>
              <span className="caps">{WHO[e.role]}</span>
              {e.text && <p>{e.text}</p>}
              {e.questions && e.questions.length > 0 && (
                <ul className={s.questions}>
                  {e.questions.map(q => <li key={q}>{q}</li>)}
                </ul>
              )}
            </li>
          ))}
          {a.thinking && (
            <li className={s.entry} data-role="assistant">
              <span className="caps">Asistente</span>
              <span className={s.thinking}><span className="spinner" /> Pensando…</span>
            </li>
          )}
        </ol>

        {a.plan && a.stage === 'scope' && (
          <section className={`card ${s.card}`} aria-label="Plan">
            <div className="card-head">
              <h2>El plan</h2>
              <span className="muted">{cost(a)}</span>
            </div>
            <div className={s.cardName}>{a.plan.projectName}</div>
            <div className="muted">
              Idioma de origen: {a.plan.sourceLanguage === 'Auto-detect' ? 'se detecta al transcribir' : a.plan.sourceLanguage}
            </div>
            <ul className={s.list}>
              {a.plan.sequences.map(q => (
                <li key={`${q.name}-${q.format}`} className="row">
                  <span>{q.name}</span>
                  <span className={s.tag}>{q.format}</span>
                  <span className={s.langs}>
                    {q.targetLanguages.length ? q.targetLanguages.map(shortLang).join(' · ') : 'solo el original'}
                  </span>
                </li>
              ))}
            </ul>
            <div className={s.actions}>
              <button className="btn btn-primary btn-lg" disabled={!a.file || !a.probe || a.probing || a.thinking}
                onClick={() => void a.create()}>
                {a.stalled ? 'Reintentar' : 'Crear el proyecto'}
              </button>
              <span className="muted">o escribe abajo qué cambiar</span>
            </div>
          </section>
        )}

        {a.jobs.length > 0 && (
          <section className={`card ${s.card}`} aria-label="Trabajo">
            <div className="card-head">
              <h2>{a.stage === 'translating' ? 'Traduciendo' : 'El trabajo'}</h2>
              {a.busy && <span className="muted">No cierres esta pestaña hasta que termine.</span>}
            </div>
            {a.jobs.map(j => (
              <div key={j.key} className={s.job} data-state={j.state}>
                <span>{j.label}</span>
                <span className={s.jobDetail}>{j.state === 'waiting' ? 'en cola' : j.detail}</span>
                <div className="meter" aria-busy={j.state === 'running' || undefined}>
                  <div className={`meter-fill ${j.state === 'failed' ? 'none' : ''}`} style={{ width: `${j.progress}%` }} />
                </div>
              </div>
            ))}
          </section>
        )}

        {a.brief && a.stage === 'review' && (
          <section className={`card ${s.card}`} aria-label="Instrucciones de traducción">
            <div className="card-head">
              <h2>Instrucciones para traducir</h2>
              <span className="muted">Idioma de origen: {a.brief.sourceLanguage}</span>
            </div>
            {a.brief.instructions && <p className={s.prose}>{a.brief.instructions}</p>}
            {a.brief.perLanguage.length > 0 && (
              <ul className={s.list}>
                {a.brief.perLanguage.map(l => (
                  <li key={l.language} className="row">
                    <span className={s.tag}>{shortLang(l.language)}</span>
                    <span>{l.instructions}</span>
                  </li>
                ))}
              </ul>
            )}
            {a.brief.glossary.length > 0 && (
              <ul className={s.list} aria-label="Glosario">
                {a.brief.glossary.map(g => (
                  <li key={`${g.term}-${g.language}`} className="row">
                    <span>{g.term}</span>
                    <span className={s.langs}>
                      {g.translation ? `→ ${g.translation}` : 'se queda igual'}
                      {g.language !== 'all' && ` · ${shortLang(g.language)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className={s.actions}>
              <button className="btn btn-primary btn-lg" disabled={a.thinking} onClick={() => void a.translate()}>
                {a.stalled ? 'Reintentar lo que falló' : `Traducir ${targets} ${targets === 1 ? 'pista' : 'pistas'}`}
              </button>
              <span className="muted">o responde abajo para cambiar algo</span>
            </div>
          </section>
        )}

        {a.stage === 'done' && a.projectId && (
          <section className={`card ${s.card}`} aria-label="Listo">
            <div className="card-head"><h2>Listo</h2></div>
            <ul className={s.list}>
              {a.made.map(m => (
                <li key={m.id} className="row">
                  <span>{m.name}</span>
                  <span className={s.langs}>
                    {describeSequence({
                      cue_count: m.cues.length,
                      source_lang: a.brief?.sourceLanguage ?? a.plan?.sourceLanguage ?? null,
                      target_langs: Object.keys(m.translations),
                      output_mode: m.format,
                    })}
                  </span>
                  <Link href={`/translate?sequence=${m.id}`} className="btn btn-quiet">Abrir</Link>
                </li>
              ))}
            </ul>
            <div className={s.actions}>
              <Link href={`/projects/${a.projectId}`} className="btn btn-primary btn-lg">Ir al proyecto</Link>
            </div>
          </section>
        )}

        {canTalk && (
          <div className={s.composer} data-drop={dropping || undefined}>
            {(a.file || a.probing) && (
              <div className={s.file}>
                <span className="caps">Archivo</span>
                <span className={s.fileName} title={a.file?.name}>{a.file?.name}</span>
                <span>{fileLine(a)}</span>
                {a.stage === 'scope' && (
                  <button className="btn btn-quiet" onClick={a.detach}>Quitar</button>
                )}
              </div>
            )}
            <textarea
              className={`field ${s.input}`}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={onKey}
              placeholder={
                a.stage === 'review'
                  ? 'Responde a las preguntas, o di qué cambiar.'
                  : 'Por ejemplo: cuatro traducciones —inglés, francés, alemán e italiano—, en horizontal y en vertical. Es para redes, público de España.'
              }
              aria-label="Mensaje para el asistente"
            />
            <div className={s.composerRow}>
              {a.stage === 'scope' && (
                <>
                  <input
                    ref={picker}
                    className={s.picker}
                    type="file"
                    accept="audio/*,video/*,.srt,.vtt,.csv,.txt"
                    onChange={e => { const f = e.target.files?.[0]; if (f) void a.attach(f); e.target.value = '' }}
                  />
                  <button className="btn" onClick={() => picker.current?.click()}>
                    {a.file ? 'Cambiar archivo' : 'Adjuntar archivo'}
                  </button>
                  <span className="muted">o arrástralo aquí</span>
                </>
              )}
              <button className={`btn btn-primary ${s.send}`} disabled={!draft.trim() || a.thinking}
                aria-busy={a.thinking || undefined} onClick={() => void submit()}>
                Enviar
              </button>
            </div>
          </div>
        )}
        <div ref={end} />
      </main>
    </div>
  )
}
