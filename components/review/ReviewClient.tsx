'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import CommentsPanel from '@/components/comments/CommentsPanel'
import Player from '@/components/video/Player'
import { api, send } from '@/lib/api'
import type { VersionSummary } from '@/lib/db/sequences'
import { knownSource, shortLang } from '@/lib/lang'
import { REVIEW_TOKEN_HEADER } from '@/lib/review/protocol'
import { readCues, srtToSec, wordDiff } from '@/lib/subtitles'
import type { TextEdit } from '@/lib/subtitles/data'
import type { ProjectComment } from '@/types/comment'
import type { Playback } from '@/types/media'
import type { Subtitle, TranslationStore } from '@/types/subtitle'

import s from './review.module.css'

/**
 * The review view: every language of a sequence side by side, cue by cue.
 *
 * This is how a client reads subtitles — not one SRT at a time, but cue 412 in
 * English beside cue 412 in Spanish, with the timecode next to both. It is the
 * same sheet `lib/subtitles/sheet.ts` exports, made live: a cell can be
 * commented on, and (when the link allows it) rewritten in place.
 *
 * Deliberately not the editor. No store, no undo, no timeline: what the client
 * changes is the words, one line at a time, and every change lands on the
 * server on its own within a couple of seconds. The same component serves the
 * team, who arrive with a session, and the client, who arrives with a token —
 * the token travels in a header on every request when it is there.
 *
 * With the picture beside the sheet when the sequence has one: the line under
 * the footage is the first translation on show, which is what is being
 * reviewed, and a click on a row's timecode takes the footage there.
 */

export interface ReviewProps {
  /** Present when this view was opened through a review link. */
  token?: string
  /** Whose notes carry a delete button, and how to greet them. */
  self: { userId?: string; guestId?: string; name: string }
  canEdit: boolean
  /** Restoring a version rewrites the whole track — the team's call, never a client's. */
  canRestore: boolean
  /** Where the project is: the crumb before the sequence's name. */
  back: string
  project: { name: string }
  sequence: {
    id: string
    name: string
    version: number
    sourceLang: string | null
    /** The order the productora works in; jsonb keeps keys in its own. */
    targetLangs: string[]
    subtitles: Subtitle[]
    translations: TranslationStore
  }
  comments: ProjectComment[]
  versions: VersionSummary[]
  /** The sequence's upload, signed on the server; null when it has none. */
  playback: Playback | null
  /** A cue to scroll to on arrival — the one an email was about. */
  focusCue?: number
}

/** Saves wait this long after the last change, so a sentence typed across two cells is one request. */
const FLUSH_MS = 1500
const SOURCE = 'source'

type Cues = { subtitles: Subtitle[]; translations: TranslationStore }

const applyLocally = (cues: Cues, edit: TextEdit): Cues => {
  const rewrite = (subs: Subtitle[]) => subs.map(c => (c.index === edit.index ? { ...c, text: edit.text } : c))
  return edit.lang === SOURCE
    ? { ...cues, subtitles: rewrite(cues.subtitles) }
    : { ...cues, translations: { ...cues.translations, [edit.lang]: rewrite(cues.translations[edit.lang] ?? []) } }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export default function ReviewClient(props: ReviewProps) {
  const { token, self, canEdit, canRestore, back, project, sequence, playback, focusCue } = props
  const router = useRouter()

  const [cues, setCues] = useState<Cues>({ subtitles: sequence.subtitles, translations: sequence.translations })
  const [version, setVersion] = useState(sequence.version)
  const [comments, setComments] = useState(props.comments)
  const [versions, setVersions] = useState(props.versions)

  const langs = useMemo(() => {
    const present = Object.keys(cues.translations)
    const ordered = sequence.targetLangs.filter(l => present.includes(l))
    return [SOURCE, ...ordered, ...present.filter(l => !ordered.includes(l))]
  }, [cues.translations, sequence.targetLangs])
  // The columns are named as the editor's tabs are: the code, and «original»
  // on the source while its language is known.
  const label = (lang: string) => {
    if (lang !== SOURCE) return shortLang(lang)
    const src = knownSource(sequence.sourceLang)
    return src ? `${shortLang(src)} · original` : 'Original'
  }

  // Two columns to start with: the original and the first translation. That is
  // the comparison a review is, and the chips add the rest.
  const [selected, setSelected] = useState<string[]>(() => langs.slice(0, 2))
  const shownLangs = langs.filter(l => selected.includes(l))

  const [filter, setFilter] = useState<'all' | 'open' | 'edited'>('all')
  const [openCue, setOpenCue] = useState<{ index: number; lang: string | null } | null>(null)
  const [editing, setEditing] = useState<{ index: number; lang: string } | null>(null)
  const [draft, setDraft] = useState('')

  // What has not reached the server yet, keyed by cell so a cell edited twice
  // sends once.
  const pending = useRef(new Map<string, TextEdit>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saving, setSaving] = useState(false)
  const [unsaved, setUnsaved] = useState(0)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [edited, setEdited] = useState(() => new Set<string>())

  const authHeaders = useMemo(() => { const h: Record<string, string> = {}; if (token) h[REVIEW_TOKEN_HEADER] = token; return h }, [token])

  // ── Text by cue, per language ──────────────────────────────────────────────
  const byLang = useMemo(() => {
    const out: Record<string, Map<number, string>> = {}
    for (const lang of langs) {
      const track = lang === SOURCE ? cues.subtitles : cues.translations[lang] ?? []
      out[lang] = new Map(track.map(c => [c.index, c.text]))
    }
    return out
  }, [cues, langs])

  // Open notes per cell, and per cue for the ones written on no language.
  const openOn = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of comments) {
      if (c.resolved) continue
      const key = `${c.cue_index}|${c.lang ?? ''}`
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }, [comments])
  const totalOn = useMemo(() => {
    const m = new Map<number, number>()
    for (const c of comments) m.set(c.cue_index, (m.get(c.cue_index) ?? 0) + 1)
    return m
  }, [comments])

  const cuesWithOpen = useMemo(() => {
    const set = new Set<number>()
    for (const c of comments) if (!c.resolved) set.add(c.cue_index)
    return set
  }, [comments])
  const cuesEdited = useMemo(() => {
    const set = new Set<number>()
    for (const key of edited) set.add(Number(key.split('|')[0]))
    return set
  }, [edited])

  const rows = cues.subtitles.filter(c =>
    filter === 'open' ? cuesWithOpen.has(c.index) : filter === 'edited' ? cuesEdited.has(c.index) : true,
  )

  // ── Saving ─────────────────────────────────────────────────────────────────
  // The timer calls whatever `flush` is by the time it fires, not the one that
  // was current when it was set — otherwise a save scheduled before the version
  // changed would send the old version and be refused.
  const flushRef = useRef<() => void>(() => {})
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current(), FLUSH_MS)
  }, [])

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const edits = [...pending.current.values()]
    if (!edits.length || saving) return
    setSaving(true)
    setError(null)

    const r = await send<{ sequence: { version: number } }>(`/api/sequences/${sequence.id}/edits`, { version, edits }, 'POST', authHeaders)
    setSaving(false)

    if (r.status === 409) {
      // Somebody saved a different shape underneath us. Nothing sent is lost
      // from the screen, but nothing more should be tried against this version.
      setConflict(true)
      return
    }
    if (!r.ok) {
      setError(r.error)
      return
    }
    // Only what went out is cleared: a cell edited while the request was in
    // flight stays pending for the next one.
    for (const e of edits) {
      const key = `${e.index}|${e.lang}`
      if (pending.current.get(key) === e) pending.current.delete(key)
    }
    setUnsaved(pending.current.size)
    setVersion(r.json.sequence.version)
    if (pending.current.size) schedule()
  }, [authHeaders, saving, schedule, sequence.id, version])

  useEffect(() => {
    flushRef.current = () => void flush()
  }, [flush])

  function commit(lang: string, index: number, text: string) {
    setEditing(null)
    const before = byLang[lang]?.get(index)
    if (before === undefined || before === text) return

    const edit: TextEdit = { lang, index, text }
    setCues(c => applyLocally(c, edit))
    pending.current.set(`${index}|${lang}`, edit)
    setUnsaved(pending.current.size)
    setEdited(set => new Set(set).add(`${index}|${lang}`))
    schedule()
  }

  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  // ── The picture ────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playingCue, setPlayingCue] = useState<number | null>(null)
  // What goes under the footage: the translation being reviewed, or the
  // original when nothing else is on show.
  const overlayLang = shownLangs.find(l => l !== SOURCE) ?? SOURCE
  const overlayCues = overlayLang === SOURCE ? cues.subtitles : (cues.translations[overlayLang] ?? [])
  const seekTo = (cue: Subtitle) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = srtToSec(cue.start)
  }

  // ── Arriving from an email ─────────────────────────────────────────────────
  const [highlight, setHighlight] = useState<number | null>(focusCue ?? null)
  useEffect(() => {
    if (focusCue === undefined) return
    document.getElementById(`cue-${focusCue}`)?.scrollIntoView({ block: 'center' })
    const t = setTimeout(() => setHighlight(null), 4000)
    return () => clearTimeout(t)
  }, [focusCue])

  // ── History ────────────────────────────────────────────────────────────────
  const [historyOpen, setHistoryOpen] = useState(false)
  const [picked, setPicked] = useState<{ summary: VersionSummary; cues: Cues } | null>(null)
  const [loadingVersion, setLoadingVersion] = useState<string | null>(null)

  async function pick(v: VersionSummary) {
    setLoadingVersion(v.id)
    const r = await api<{ version: { data: unknown } }>(`/api/sequences/${sequence.id}/versions/${v.id}`, { headers: authHeaders })
    setLoadingVersion(null)
    if (!r.ok) { setError(r.error); return }
    setPicked({ summary: v, cues: readCues(r.json.version.data) })
  }

  async function refreshVersions() {
    const r = await api<{ versions?: VersionSummary[] }>(`/api/sequences/${sequence.id}/versions`, { headers: authHeaders })
    if (r.ok) setVersions(r.json.versions ?? [])
  }

  /** Every cue whose words differ between the picked version and what is on screen now. */
  const changes = useMemo(() => {
    if (!picked) return []
    const out: { lang: string; index: number; before: string; after: string }[] = []
    const allLangs = new Set([...langs, ...Object.keys(picked.cues.translations)])
    for (const lang of [SOURCE, ...[...allLangs].filter(l => l !== SOURCE)]) {
      const then = new Map(
        (lang === SOURCE ? picked.cues.subtitles : picked.cues.translations[lang] ?? []).map(c => [c.index, c.text]),
      )
      const now = byLang[lang] ?? new Map<number, string>()
      for (const index of new Set([...then.keys(), ...now.keys()])) {
        const before = then.get(index) ?? ''
        const after = now.get(index) ?? ''
        if (before !== after) out.push({ lang, index, before, after })
      }
    }
    return out.sort((a, b) => a.index - b.index)
  }, [picked, byLang, langs])

  async function restore() {
    if (!picked || !canRestore) return
    const v = picked.summary.version ?? '?'
    if (!confirm(`¿Dejar toda la secuencia como en la v${v}? Se guarda como una versión nueva.`)) return
    const r = await send(`/api/sequences/${sequence.id}`, {
      data: picked.cues,
      version,
      note: `Restaurada la v${picked.summary.version ?? ''}`.trim(),
    }, 'PATCH', authHeaders)
    if (r.status === 409) { setConflict(true); return }
    if (!r.ok) { setError(r.error); return }

    router.refresh()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const cols = `56px 132px repeat(${shownLangs.length}, minmax(220px, 1fr))`
  const status = saving ? 'Guardando…' : unsaved ? `${unsaved} sin guardar` : canEdit ? 'Guardado' : 'Solo lectura'

  return (
    <div className={`${s.page} ${s.app}`}>
      {openCue && (
        <CommentsPanel
          sequenceId={sequence.id}
          cueIndex={openCue.index}
          lang={openCue.lang}
          comments={comments}
          onChange={setComments}
          isMine={c => (self.userId ? c.author_id === self.userId : c.guest_id === self.guestId)}
          authHeaders={authHeaders}
          onClose={() => setOpenCue(null)}
        />
      )}

      <header className="topbar">
        {/* A client has nowhere else to go; the team's brand leads home. */}
        {token ? <span className="brand">captio</span> : <Link href="/dashboard" className="brand">captio</Link>}
        <span className="topbar-sep" />
        <nav className="crumbs" aria-label="Dónde estás">
          <Link href={back}>{project.name}</Link>
          <span>/</span>
          <span>{sequence.name}</span>
        </nav>
        <span className="kbd">v{version}</span>
        <span className={s.state} data-dirty={unsaved > 0 || undefined}>{status}</span>
        <div className={s.headEnd}>
          <button
            className="btn"
            aria-pressed={historyOpen}
            onClick={() => { setHistoryOpen(o => !o); if (!historyOpen) void refreshVersions() }}
          >
            Versiones{versions.length ? ` · ${versions.length}` : ''}
          </button>
          <span className={s.who}>{self.name}</span>
        </div>
      </header>

      {/* Which languages are on the sheet, and which rows. */}
      <div className={s.bar}>
        <span className="caps">Comparar</span>
        {langs.map(lang => {
          const on = selected.includes(lang)
          return (
            <button
              key={lang}
              className="chip"
              aria-pressed={on}
              onClick={() => setSelected(sel => (on ? sel.filter(l => l !== lang) : [...sel, lang]))}
            >
              {label(lang)}
            </button>
          )
        })}
        <span className={s.spacer} />
        <div className="seg" role="group" aria-label="Qué filas enseñar">
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todas · {cues.subtitles.length}</button>
          <button aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>Con notas abiertas · {cuesWithOpen.size}</button>
          <button aria-pressed={filter === 'edited'} onClick={() => setFilter('edited')}>Corregidas · {cuesEdited.size}</button>
        </div>
      </div>

      {conflict && (
        <div className={s.notice} role="alert">
          Alguien guardó esta secuencia después de que la abrieras. Recarga para ver su versión: lo que no
          hayas guardado aquí se pierde.
          <button className="btn" onClick={() => router.refresh()}>Recargar</button>
        </div>
      )}
      {error && !conflict && (
        <div className={s.notice} role="alert">
          {error}
          {unsaved > 0 && <button className="btn" onClick={() => void flush()}>Reintentar</button>}
        </div>
      )}

      <div className={s.body}>
        {playback && (
          <aside className={s.picture}>
            <Player playback={playback} cues={overlayCues} videoRef={videoRef} onActive={setPlayingCue} />
            <p className={s.pictureNote}>
              {playback.filename} · debajo, {label(overlayLang)} · pulsa un tiempo para ir allí
            </p>
          </aside>
        )}

        {/* The sheet */}
        <div className={s.sheet} style={{ '--cols': cols } as CSSProperties}>
          <div className={s.sheetHead}>
            <span>#</span>
            <span>in · out</span>
            {shownLangs.map(lang => <span key={lang} className={s.colHead}>{label(lang)}</span>)}
          </div>

          {rows.length === 0 && (
            <div className={`empty ${s.emptySheet}`}>
              <span className="empty-title">
                {filter === 'all' ? 'Esta secuencia no tiene subtítulos todavía' : 'Ninguna fila coincide con este filtro'}
              </span>
            </div>
          )}

          {rows.map(cue => {
            const cueOpen = openOn.get(`${cue.index}|`) ?? 0
            const total = totalOn.get(cue.index) ?? 0
            return (
              <div
                key={cue.index}
                id={`cue-${cue.index}`}
                className={s.row}
                data-highlight={highlight === cue.index || undefined}
                data-playing={playingCue === cue.index || undefined}
              >
                <div className={s.n}>
                  {cue.index}
                  <button
                    className={`badge${total ? '' : ` ${s.quiet}`}`}
                    data-unread={cueOpen > 0 || undefined}
                    title={total ? `${plural(total, 'comentario', 'comentarios')} en este cue` : 'Comentar este cue'}
                    aria-label={total ? `${plural(total, 'comentario', 'comentarios')} en el cue ${cue.index}` : `Comentar el cue ${cue.index}`}
                    onClick={() => setOpenCue({ index: cue.index, lang: null })}
                  >
                    {total || '+'}
                  </button>
                </div>
                <button
                  className={s.tc}
                  disabled={!playback}
                  title={playback ? 'Ir a este punto del vídeo' : undefined}
                  onClick={() => seekTo(cue)}
                >
                  {cue.start}<br />{cue.end}
                </button>
                {shownLangs.map(lang => {
                  const text = byLang[lang]?.get(cue.index)
                  const isEditing = editing?.index === cue.index && editing.lang === lang
                  const open = openOn.get(`${cue.index}|${lang === SOURCE ? '' : lang}`) ?? 0
                  const editable = canEdit && text !== undefined && !isEditing
                  return (
                    <div
                      key={lang}
                      className={s.cell}
                      data-empty={text === undefined || undefined}
                      data-editable={editable || undefined}
                      data-edited={edited.has(`${cue.index}|${lang}`) || undefined}
                      onClick={() => {
                        if (!editable) return
                        setDraft(text)
                        setEditing({ index: cue.index, lang })
                      }}
                    >
                      {isEditing ? (
                        <textarea
                          className={`field ${s.edit}`}
                          autoFocus
                          value={draft}
                          rows={Math.max(2, draft.split('\n').length + 1)}
                          aria-label={`${label(lang)}, cue ${cue.index}`}
                          onChange={e => setDraft(e.target.value)}
                          onBlur={() => commit(lang, cue.index, draft)}
                          onKeyDown={e => {
                            if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(lang, cue.index, draft) }
                          }}
                        />
                      ) : (
                        <div className={s.text}>{text === undefined ? '—' : text}</div>
                      )}
                      {!isEditing && lang !== SOURCE && (
                        <button
                          className={`badge ${s.cellBadge}${open ? '' : ` ${s.quiet}`}`}
                          data-unread={open > 0 || undefined}
                          title={open ? `${plural(open, 'nota abierta', 'notas abiertas')} sobre el ${label(lang)}` : `Comentar el ${label(lang)}`}
                          aria-label={open ? `${plural(open, 'nota abierta', 'notas abiertas')} sobre el ${label(lang)} del cue ${cue.index}` : `Comentar el ${label(lang)} del cue ${cue.index}`}
                          onClick={e => { e.stopPropagation(); setOpenCue({ index: cue.index, lang }) }}
                        >
                          {open || '+'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* History */}
        {historyOpen && (
          <aside className={s.history} aria-label="Versiones">
            <div className={s.historyHead}>
              <span className="caps">Versiones</span>
              <button className="btn btn-quiet btn-icon" onClick={() => setHistoryOpen(false)} aria-label="Cerrar las versiones">×</button>
            </div>
            <div className={s.versions} data-split={picked ? '' : undefined}>
              {versions.length === 0 && (
                <p className={`muted ${s.historyNote}`}>Todavía no hay versiones: el primer guardado crea una.</p>
              )}
              {versions.map(v => (
                <button
                  key={v.id}
                  className={`row ${s.version}`}
                  aria-pressed={picked?.summary.id === v.id}
                  onClick={() => void pick(v)}
                >
                  <span className={s.vn}>v{v.version ?? '?'}</span>
                  <span className={s.vAuthor}>
                    {v.author_name ?? 'Alguien'}
                    {v.guest_id && <span className="muted"> · cliente</span>}
                  </span>
                  {loadingVersion === v.id && <span className="spinner" />}
                  <span className={`muted ${s.vWhen}`} suppressHydrationWarning>{when(v.created_at)}</span>
                  {v.note && <span className={`muted ${s.vNote}`}>{v.note}</span>}
                </button>
              ))}
            </div>
            {picked && (
              <div className={s.diff}>
                <div className={s.diffHead}>
                  <span>
                    v{picked.summary.version ?? '?'} → ahora: {plural(changes.length, 'línea distinta', 'líneas distintas')}
                  </span>
                  {canRestore && (
                    <button className="btn" onClick={() => void restore()}>
                      Restaurar la v{picked.summary.version ?? '?'}
                    </button>
                  )}
                </div>
                <div className={s.changes}>
                  {changes.length === 0 && <p className="muted">Las palabras son las mismas que hay ahora en pantalla.</p>}
                  {changes.map(ch => (
                    <div key={`${ch.lang}|${ch.index}`} className={s.change}>
                      <div className={s.changeWhere}>
                        <a href={`#cue-${ch.index}`}>#{ch.index}</a> · {label(ch.lang)}
                      </div>
                      <div className={s.changeText}>
                        {wordDiff(ch.before, ch.after).map((op, i) =>
                          op.type === 'eq' ? <span key={i}>{op.val} </span> :
                          op.type === 'ins' ? <ins key={i} className={s.ins}>{op.val} </ins> :
                                              <del key={i} className={s.del}>{op.val} </del>,
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
