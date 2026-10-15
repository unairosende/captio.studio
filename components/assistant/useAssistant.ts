'use client'

import { useEffect, useRef, useState } from 'react'

import { send } from '@/lib/api'
import { excerpt, type HistoryEntry } from '@/lib/assistant/prompt'
import { glossaryFor, instructionsFor, projectTerms, type Brief, type Plan, type Reply } from '@/lib/assistant/reply'
import { probeFile, type Probe } from '@/lib/jobs/probe'
import { translateCues } from '@/lib/jobs/translate'
import { uploadMedia } from '@/lib/jobs/upload'
import { LANG_CODES } from '@/lib/providers'
import { fitToFormat, type OutputMode } from '@/lib/subtitles/layout'
import type { Subtitle } from '@/lib/subtitles/types'

/**
 * The project assistant: a conversation, then the work it agreed to.
 *
 * Four stretches, in order. While scoping, the person and the model talk until
 * there is a plan; nothing exists yet and nothing is spent. Creating does what
 * the plan says through the routes the editor already uses — project, upload,
 * transcription, sequences — so the allowance, the tenancy checks and the
 * billing are the ones that were already there. Reviewing puts the source in
 * front of the model, which asks what it needs and writes the brief.
 * Translating runs every language of every sequence with that brief.
 *
 * It all runs in this tab. Closing it stops the work wherever it is, and what
 * was saved stays saved — each language is written to its sequence as soon as
 * it is done. A run that fails picks up where it stopped: every step remembers
 * what it finished, so trying again does not create a second project or pay
 * for a second transcription.
 */

export type Stage = 'scope' | 'creating' | 'review' | 'translating' | 'done'

export interface Entry {
  id: number
  role: 'user' | 'assistant' | 'event' | 'error'
  text: string
  questions?: string[]
}

export interface Job {
  key: string
  label: string
  /** 0..100. */
  progress: number
  state: 'waiting' | 'running' | 'done' | 'failed'
  detail: string
}

export interface Made {
  id: string
  name: string
  format: OutputMode
  targets: string[]
  cues: Subtitle[]
  version: number
  translations: Record<string, Subtitle[]>
}

/** What a run has finished, so trying again resumes rather than repeats. */
interface Progress {
  projectId: string | null
  mediaId: string | null
  cuesByFormat: Partial<Record<OutputMode, Subtitle[]>> | null
  made: Made[]
}

/** How many languages translate at once. The provider queues rather than refuses, so more buys nothing. */
const PARALLEL = 4

/** The language as the recogniser takes it: `Spanish` → `es`. Unknown means let it detect. */
const recogniserCode = (lang: string): string | undefined =>
  lang !== 'Auto-detect' && LANG_CODES[lang] ? LANG_CODES[lang].toLowerCase() : undefined

/** Run tasks with at most `limit` in flight, every one to the end even when one fails. */
async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await run(items[next++])
  })
  await Promise.all(lanes)
}

const formatName = (f: OutputMode) => (f === 'vertical' ? 'vertical' : 'horizontal')

export function useAssistant() {
  const [stage, setStage] = useState<Stage>('scope')
  const [entries, setEntries] = useState<Entry[]>([])
  const [thinking, setThinking] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [probe, setProbe] = useState<Probe | null>(null)
  const [probing, setProbing] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [brief, setBrief] = useState<Brief | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [made, setMade] = useState<Made[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  /** Whether the last run stopped on an error, so the page can offer to carry on. */
  const [stalled, setStalled] = useState(false)

  const done = useRef<Progress>({ projectId: null, mediaId: null, cuesByFormat: null, made: [] })
  const seq = useRef(0)
  const log = useRef<Entry[]>([])

  const busy = stage === 'creating' || stage === 'translating'

  // Work in flight lives in this tab: leaving it stops the work.
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  /** Append to the conversation. Kept in a ref as well, so a request built right after sees it. */
  function push(entry: Omit<Entry, 'id'>): void {
    const next = [...log.current, { ...entry, id: ++seq.current }]
    log.current = next
    setEntries(next)
  }

  function job(key: string, patch: Partial<Job> & { label?: string }): void {
    setJobs(all => {
      const at = all.findIndex(j => j.key === key)
      if (at === -1) {
        return [...all, { key, label: patch.label ?? key, progress: 0, state: 'waiting', detail: '', ...patch }]
      }
      const copy = all.slice()
      copy[at] = { ...copy[at], ...patch }
      return copy
    })
  }

  /** The conversation as the model reads it: who said what, and what Captio did in between. */
  function history(): HistoryEntry[] {
    return log.current
      .filter(e => e.role !== 'error')
      .map(e => ({
        role: e.role as HistoryEntry['role'],
        text: e.questions?.length ? `${e.text}\n${e.questions.map(q => `- ${q}`).join('\n')}` : e.text,
      }))
      .filter(e => e.text.trim())
  }

  async function ask(phase: 'scope' | 'review'): Promise<Reply | null> {
    setThinking(true)
    const r = await send<{ reply: Reply }>('/api/assistant', {
      phase,
      file: probe?.facts ?? null,
      history: history(),
      plan: phase === 'review' ? plan : undefined,
      source: phase === 'review' && done.current.made[0] ? excerpt(done.current.made[0].cues) : undefined,
    })
    setThinking(false)

    if (!r.ok) {
      push({ role: 'error', text: r.error })
      return null
    }
    const reply = r.json.reply
    push({ role: 'assistant', text: reply.message, questions: reply.questions })
    if (reply.plan) setPlan(reply.plan)
    if (reply.brief) setBrief(reply.brief)
    return reply
  }

  async function attach(next: File): Promise<void> {
    setProbing(true)
    setFile(next)
    setProbe(null)
    const found = await probeFile(next)
    setProbe(found)
    setProbing(false)
  }

  function detach(): void {
    setFile(null)
    setProbe(null)
  }

  /** A message from the person, answered by whichever phase the work is in. */
  async function say(text: string): Promise<void> {
    const words = text.trim()
    if (!words || thinking || busy) return
    push({ role: 'user', text: words })
    await ask(stage === 'review' || stage === 'done' ? 'review' : 'scope')
  }

  /** The plan, carried out: project, material, sequences. Then the review starts by itself. */
  async function create(): Promise<void> {
    if (!plan || !file || !probe || busy) return
    setStage('creating')
    setStalled(false)
    const d = done.current

    try {
      if (!d.projectId) {
        job('project', { label: 'Crear el proyecto', state: 'running', progress: 50, detail: '' })
        const r = await send<{ project: { id: string } }>('/api/projects', { name: plan.projectName })
        if (!r.ok) throw new Error(r.error)
        d.projectId = r.json.project.id
        setProjectId(d.projectId)
        job('project', { state: 'done', progress: 100 })
      }

      const formats = [...new Set(plan.sequences.map(q => q.format))]

      if (!d.cuesByFormat) {
        if (probe.media) {
          const media = probe.media
          if (!d.mediaId) {
            job('upload', { label: 'Subir el archivo', state: 'running', progress: 10, detail: '' })
            d.mediaId = await uploadMedia(file, media, {
              onStage: s => job('upload', { detail: s.message, progress: s.progress }),
            })
            job('upload', { state: 'done', progress: 100, detail: '' })
          }

          job('transcribe', { label: 'Transcribir', state: 'running', progress: 30, detail: 'Puede tardar unos minutos' })
          const r = await send<{ segments?: Subtitle[]; byMode?: Partial<Record<OutputMode, Subtitle[]>> }>(
            '/api/transcribe',
            { mediaId: d.mediaId, language: recogniserCode(plan.sourceLanguage), outputMode: formats[0], outputModes: formats },
          )
          if (!r.ok) throw new Error(r.error)
          const byMode = r.json.byMode ?? { [formats[0]]: r.json.segments ?? [] }
          if (!byMode[formats[0]]?.length) throw new Error('No se encontró voz — puede que el archivo esté en silencio')
          d.cuesByFormat = byMode
          job('transcribe', { state: 'done', progress: 100, detail: `${byMode[formats[0]]!.length} subtítulos` })
        } else if (probe.cues?.length) {
          // Subtitles arrive cut already: every format starts from the same
          // cues, with only the lines that run past its length re-broken.
          // Splitting a cue that is too long for two lines is left to export
          // and to the person, as it is for any file imported in the editor.
          const cues = probe.cues
          d.cuesByFormat = Object.fromEntries(formats.map(f => [f, fitToFormat(cues, f)]))
        } else {
          throw new Error('Este archivo no tiene nada que convertir en subtítulos.')
        }
      }

      // The first sequence owns the upload; the others are cuts of it, so they
      // play its picture and are paid for with it (migration 0014).
      for (const [i, q] of plan.sequences.entries()) {
        if (d.made[i]) continue
        const key = `sequence-${i}`
        job(key, { label: `Crear «${q.name}»`, state: 'running', progress: 50, detail: '' })
        const cues = d.cuesByFormat[q.format] ?? d.cuesByFormat[formats[0]] ?? []
        const r = await send<{ sequence: { id: string; version: number } }>('/api/sequences', {
          projectId: d.projectId,
          name: q.name,
          sourceLang: plan.sourceLanguage,
          targetLangs: [],
          outputMode: q.format,
          data: { subtitles: cues, translations: {} },
          ...(i === 0 && d.mediaId ? { mediaId: d.mediaId } : {}),
          ...(i > 0 ? { derivedFrom: d.made[0].id } : {}),
        })
        if (!r.ok) throw new Error(r.error)
        d.made[i] = {
          id: r.json.sequence.id,
          name: q.name,
          format: q.format,
          targets: q.targetLanguages,
          cues,
          version: r.json.sequence.version,
          translations: {},
        }
        setMade([...d.made])
        job(key, { state: 'done', progress: 100, detail: `${cues.length} subtítulos · ${formatName(q.format)}` })
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Algo falló al crear el proyecto.'
      push({ role: 'error', text: message })
      // The step that stopped says why, rather than what it was doing when it
      // stopped: a red bar reading "Subiendo el audio…" looks like it still is.
      setJobs(all => all.map(j => (j.state === 'running' ? { ...j, state: 'failed', progress: 100, detail: message } : j)))
      // Back to where the plan can be carried out again; what was finished
      // stays finished (see Progress), so trying again resumes.
      setStage('scope')
      setStalled(true)
      return
    }

    const counts = d.made.map(m => `${m.cues.length} en «${m.name}»`).join(' y ')
    push({ role: 'event', text: `Proyecto creado. Subtítulos de origen: ${counts}.` })

    if (!d.made.some(m => m.targets.length)) {
      setStage('done')
      return
    }

    setStage('review')
    push({ role: 'event', text: 'Revisa el texto de origen antes de traducir.' })
    await ask('review')
  }

  /** Every language of every sequence, with the brief; each saved to its sequence as soon as it is done. */
  async function translate(): Promise<void> {
    if (!brief || busy) return
    setStage('translating')
    setStalled(false)
    const d = done.current
    const sourceLang = brief.sourceLanguage !== 'Auto-detect' ? brief.sourceLanguage : (plan?.sourceLanguage ?? 'Auto-detect')

    // Terms that hold in every language stay on the project, for whatever is
    // translated in it later from the editor.
    const terms = projectTerms(brief)
    if (terms.length && d.projectId) {
      const r = await send(`/api/projects/${d.projectId}`, { glossary: terms }, 'PATCH')
      if (!r.ok) push({ role: 'error', text: `El glosario no se guardó en el proyecto: ${r.error}` })
    }

    const tasks = d.made.flatMap(m => m.targets.filter(lang => !m.translations[lang]).map(lang => ({ m, lang })))
    for (const { m, lang } of tasks) job(`${m.id}:${lang}`, { label: `${m.name} · ${lang}`, state: 'waiting' })

    // One save at a time per sequence: each carries every language finished so
    // far and the version the previous one returned, so they never collide.
    const saves = new Map<string, Promise<void>>()
    const save = (m: Made) => {
      const run = (saves.get(m.id) ?? Promise.resolve()).then(async () => {
        const r = await send<{ sequence: { version: number } }>(
          `/api/sequences/${m.id}`,
          {
            data: { subtitles: m.cues, translations: m.translations },
            targetLangs: Object.keys(m.translations),
            sourceLang,
            version: m.version,
            note: 'Traducido con el asistente',
          },
          'PATCH',
        )
        if (r.status === 409) throw new Error(`«${m.name}» cambió mientras se traducía. Ábrela y revisa antes de seguir.`)
        if (!r.ok) throw new Error(r.error)
        m.version = r.json.sequence.version
      })
      saves.set(m.id, run.catch(() => {}))
      return run
    }

    let failed = false
    await pool(tasks, PARALLEL, async ({ m, lang }) => {
      const key = `${m.id}:${lang}`
      job(key, { state: 'running', progress: 0, detail: '' })
      try {
        const out = await translateCues(
          {
            cues: m.cues,
            lang,
            sourceLang,
            outputMode: m.format,
            sequenceId: m.id,
            mediaId: d.mediaId,
            glossary: glossaryFor(brief, lang),
            extraInstructions: instructionsFor(brief, lang),
          },
          p => job(key, { progress: Math.round((p.done / p.total) * 100), detail: `${p.done}/${p.total}` }),
        )
        m.translations[lang] = out
        await save(m)
        job(key, { state: 'done', progress: 100, detail: `${out.length} subtítulos` })
      } catch (e: unknown) {
        failed = true
        delete m.translations[lang]
        // A full red bar, as the style guide draws a failed meter: how far it
        // got is not the news.
        job(key, { state: 'failed', progress: 100, detail: e instanceof Error ? e.message : 'Error' })
      }
    })
    setMade([...d.made])

    if (failed) {
      push({ role: 'error', text: 'Algunos idiomas no se pudieron traducir. Los demás ya están guardados.' })
      setStage('review')
      setStalled(true)
      return
    }
    push({ role: 'event', text: 'Todo traducido y guardado.' })
    setStage('done')
  }

  /** Whatever stopped, from where it stopped. */
  function resume(): Promise<void> {
    return done.current.made.length === (plan?.sequences.length ?? 0) && brief ? translate() : create()
  }

  return {
    stage, entries, thinking, busy, file, probe, probing, plan, brief, jobs, made, projectId, stalled,
    attach, detach, say, create, translate, resume,
  }
}

export type Assistant = ReturnType<typeof useAssistant>
