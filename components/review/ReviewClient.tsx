'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import CommentsPanel from '@/components/comments/CommentsPanel'
import Player from '@/components/video/Player'
import type { VersionSummary } from '@/lib/db/sequences'
import { REVIEW_TOKEN_HEADER } from '@/lib/review/protocol'
import { readCues, srtToSec, wordDiff } from '@/lib/subtitles'
import type { TextEdit } from '@/lib/subtitles/data'
import type { ProjectComment } from '@/types/comment'
import type { Playback } from '@/types/media'
import type { Subtitle, TranslationStore } from '@/types/subtitle'

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
  back: { href: string; label: string }
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
  const rewrite = (subs: Subtitle[]) => subs.map(s => (s.index === edit.index ? { ...s, text: edit.text } : s))
  return edit.lang === SOURCE
    ? { ...cues, subtitles: rewrite(cues.subtitles) }
    : { ...cues, translations: { ...cues.translations, [edit.lang]: rewrite(cues.translations[edit.lang] ?? []) } }
}

const when = (iso: string) => new Date(iso).toLocaleString()

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
  const label = (lang: string) => (lang === SOURCE ? sequence.sourceLang || 'Original' : lang)

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

  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', ...(token ? { [REVIEW_TOKEN_HEADER]: token } : {}) }),
    [token],
  )
  const authHeaders = useMemo(() => (token ? { [REVIEW_TOKEN_HEADER]: token } : undefined), [token])

  // ── Text by cue, per language ──────────────────────────────────────────────
  const byLang = useMemo(() => {
    const out: Record<string, Map<number, string>> = {}
    for (const lang of langs) {
      const track = lang === SOURCE ? cues.subtitles : cues.translations[lang] ?? []
      out[lang] = new Map(track.map(s => [s.index, s.text]))
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
    const s = new Set<number>()
    for (const c of comments) if (!c.resolved) s.add(c.cue_index)
    return s
  }, [comments])
  const cuesEdited = useMemo(() => {
    const s = new Set<number>()
    for (const key of edited) s.add(Number(key.split('|')[0]))
    return s
  }, [edited])

  const rows = cues.subtitles.filter(s =>
    filter === 'open' ? cuesWithOpen.has(s.index) : filter === 'edited' ? cuesEdited.has(s.index) : true,
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

    const res = await fetch(`/api/sequences/${sequence.id}/edits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ version, edits }),
    })
    const json = await res.json().catch(() => ({}))
    setSaving(false)

    if (res.status === 409) {
      // Somebody saved a different shape underneath us. Nothing sent is lost
      // from the screen, but nothing more should be tried against this version.
      setConflict(true)
      return
    }
    if (!res.ok) {
      setError(json.error ?? `Could not save (HTTP ${res.status})`)
      return
    }
    // Only what went out is cleared: a cell edited while the request was in
    // flight stays pending for the next one.
    for (const e of edits) {
      const key = `${e.index}|${e.lang}`
      if (pending.current.get(key) === e) pending.current.delete(key)
    }
    setUnsaved(pending.current.size)
    setVersion(json.sequence.version)
    if (pending.current.size) schedule()
  }, [headers, saving, schedule, sequence.id, version])

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
    setEdited(s => new Set(s).add(`${index}|${lang}`))
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
    const res = await fetch(`/api/sequences/${sequence.id}/versions/${v.id}`, { headers: authHeaders })
    const json = await res.json().catch(() => ({}))
    setLoadingVersion(null)
    if (!res.ok) { setError(json.error ?? 'Could not open that version'); return }
    setPicked({ summary: v, cues: readCues(json.version.data) })
  }

  async function refreshVersions() {
    const res = await fetch(`/api/sequences/${sequence.id}/versions`, { headers: authHeaders })
    if (res.ok) setVersions((await res.json()).versions ?? [])
  }

  /** Every cue whose words differ between the picked version and what is on screen now. */
  const changes = useMemo(() => {
    if (!picked) return []
    const out: { lang: string; index: number; before: string; after: string }[] = []
    const allLangs = new Set([...langs, ...Object.keys(picked.cues.translations)])
    for (const lang of [SOURCE, ...[...allLangs].filter(l => l !== SOURCE)]) {
      const then = new Map(
        (lang === SOURCE ? picked.cues.subtitles : picked.cues.translations[lang] ?? []).map(s => [s.index, s.text]),
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
    if (!confirm(`Put the whole sequence back to v${picked.summary.version ?? '?'}? This is saved as a new version.`)) return
    const res = await fetch(`/api/sequences/${sequence.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        data: picked.cues,
        version,
        note: `Restored v${picked.summary.version ?? ''}`.trim(),
      }),
    })
    if (res.status === 409) { setConflict(true); return }
    if (!res.ok) { setError('Could not restore that version'); return }
    router.refresh()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const gridCols = `54px 168px repeat(${shownLangs.length}, minmax(220px, 1fr))`

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)', display: 'flex', flexDirection: 'column' }}>
      {/* Same as the dashboard: the dialog is already on the new tokens. */}
      {openCue && (
        <div className="v2"><CommentsPanel
          sequenceId={sequence.id}
          cueIndex={openCue.index}
          lang={openCue.lang}
          comments={comments}
          onChange={setComments}
          isMine={c => (self.userId ? c.author_id === self.userId : c.guest_id === self.guestId)}
          authHeaders={authHeaders}
          onClose={() => setOpenCue(null)}
        /></div>
      )}

      {/* Top bar */}
      <div style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: 'var(--accent)', letterSpacing: '.04em' }}>
          Captio
        </div>
        <Link href={back.href} style={{ fontSize: 'var(--fs-md)', color: 'var(--text3)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          ← {back.label}
        </Link>
        <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--fs-base)', color: 'var(--text)' }}>
          <span className="muted">{project.name} · </span>{sequence.name}
        </div>
        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontFamily: 'var(--mono)', background: 'var(--accent-dim)', color: '#8ba8ff' }}>
          v{version}
        </span>
        <span className="muted" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>
          {saving ? 'Saving…' : unsaved ? `${unsaved} unsaved` : canEdit ? 'Saved' : 'Read only'}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className={`btn${historyOpen ? ' btn-primary' : ''}`} onClick={() => { setHistoryOpen(o => !o); if (!historyOpen) void refreshVersions() }}>
            History{versions.length ? ` · ${versions.length}` : ''}
          </button>
          <span className="muted" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>{self.name}</span>
        </div>
      </div>

      {/* Languages and filters */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
        <span className="caps" style={{ marginRight: 4 }}>Compare</span>
        {langs.map(lang => {
          const on = selected.includes(lang)
          return (
            <button
              key={lang}
              onClick={() => setSelected(s => (on ? s.filter(l => l !== lang) : [...s, lang]))}
              style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 11, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                background: on ? 'var(--accent-dim)' : 'transparent',
                color: on ? '#8ba8ff' : 'var(--text3)',
              }}
            >
              {label(lang)}
            </button>
          )
        })}
        <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 6px' }} />
        {(['all', 'open', 'edited'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '3px 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer', border: 'none', background: filter === f ? 'var(--bg3)' : 'transparent', color: filter === f ? 'var(--text)' : 'var(--text3)' }}>
            {f === 'all' ? `All · ${cues.subtitles.length}` : f === 'open' ? `Open notes · ${cuesWithOpen.size}` : `Edited · ${cuesEdited.size}`}
          </button>
        ))}
      </div>

      {conflict && (
        <div style={{ background: 'var(--red-dim)', borderBottom: '1px solid #5a1a1a', padding: '8px 16px', fontSize: 12, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          Somebody else saved this sequence after you opened it. Reload to see their version — your unsaved changes here will be lost.
          <button className="btn" onClick={() => router.refresh()}>Reload</button>
        </div>
      )}
      {error && !conflict && (
        <div style={{ background: 'var(--red-dim)', borderBottom: '1px solid #5a1a1a', padding: '6px 16px', fontSize: 12, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {error}
          {unsaved > 0 && <button className="btn" onClick={() => void flush()}>Retry</button>}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {playback && (
          <div style={{ flex: '0 0 clamp(300px, 36vw, 640px)', borderRight: '1px solid var(--border)', background: 'var(--bg1)', overflow: 'auto' }}>
            <Player playback={playback} cues={overlayCues} videoRef={videoRef} onActive={setPlayingCue} />
            <div className="muted" style={{ padding: '8px 12px', fontSize: 11 }}>
              {playback.filename} · showing {label(overlayLang)} · click a timecode to go there
            </div>
          </div>
        )}

        {/* The sheet */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg1)', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text2)' }}>
            <div style={{ padding: '7px 10px' }}>#</div>
            <div style={{ padding: '7px 10px' }}>Time</div>
            {shownLangs.map(lang => (
              <div key={lang} style={{ padding: '7px 12px', fontWeight: 500, borderLeft: '1px solid var(--border)' }}>{label(lang)}</div>
            ))}
          </div>

          {rows.length === 0 && (
            <div className="muted" style={{ padding: 30, textAlign: 'center' }}>
              {filter === 'all' ? 'This sequence has no subtitles yet.' : 'Nothing matches this filter.'}
            </div>
          )}

          {rows.map(s => {
            const cueOpen = openOn.get(`${s.index}|`) ?? 0
            const total = totalOn.get(s.index) ?? 0
            return (
              <div
                key={s.index}
                id={`cue-${s.index}`}
                style={{
                  display: 'grid', gridTemplateColumns: gridCols,
                  borderBottom: '1px solid var(--border)',
                  background: highlight === s.index ? 'var(--accent-dim)' : playingCue === s.index ? 'var(--bg2)' : 'transparent',
                  transition: 'background .6s',
                  // The browser skips laying out and painting rows that are off
                  // screen, which is what makes a feature-length track scroll.
                  contentVisibility: 'auto', containIntrinsicSize: 'auto 64px',
                } as React.CSSProperties}
              >
                <div style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                  {s.index}
                  <button
                    className={`cmt-badge${cueOpen ? ' open' : ''}`}
                    style={{ position: 'static', display: 'block', marginTop: 6, opacity: total || cueOpen ? 1 : .45 }}
                    title={total ? `${total} comment${total > 1 ? 's' : ''} on this cue` : 'Comment on this cue'}
                    onClick={() => setOpenCue({ index: s.index, lang: null })}
                  >
                    💬{total ? ` ${total}` : ''}
                  </button>
                </div>
                <div
                  style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', lineHeight: 1.6, cursor: playback ? 'pointer' : 'default' }}
                  title={playback ? 'Go there in the video' : undefined}
                  onClick={() => playback && seekTo(s)}
                >
                  {s.start}<br />{s.end}
                </div>
                {shownLangs.map(lang => {
                  const text = byLang[lang]?.get(s.index)
                  const isEditing = editing?.index === s.index && editing.lang === lang
                  const open = openOn.get(`${s.index}|${lang === SOURCE ? '' : lang}`) ?? 0
                  const wasEdited = edited.has(`${s.index}|${lang}`)
                  return (
                    <div
                      key={lang}
                      style={{ position: 'relative', padding: '8px 12px', borderLeft: '1px solid var(--border)', fontSize: 13, lineHeight: 1.5, color: text === undefined ? 'var(--text3)' : 'var(--text)', cursor: canEdit && text !== undefined && !isEditing ? 'text' : 'default', background: wasEdited ? 'var(--green-dim)' : 'transparent' }}
                      onClick={() => {
                        if (!canEdit || text === undefined || isEditing) return
                        setDraft(text)
                        setEditing({ index: s.index, lang })
                      }}
                    >
                      {isEditing ? (
                        <textarea
                          autoFocus
                          value={draft}
                          rows={Math.max(2, draft.split('\n').length + 1)}
                          onChange={e => setDraft(e.target.value)}
                          onBlur={() => commit(lang, s.index, draft)}
                          onKeyDown={e => {
                            if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(lang, s.index, draft) }
                          }}
                          style={{ width: '100%', background: 'var(--bg0)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text)', fontSize: 13, padding: '6px 8px', resize: 'vertical', outline: 'none', lineHeight: 1.5, fontFamily: 'inherit' }}
                        />
                      ) : (
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 34 }}>
                          {text === undefined ? <span className="muted">—</span> : text}
                        </div>
                      )}
                      {!isEditing && lang !== SOURCE && (
                        <button
                          className={`cmt-badge${open ? ' open' : ''}`}
                          style={{ opacity: open ? 1 : .45 }}
                          title={open ? `${open} open on the ${lang}` : `Comment on the ${lang}`}
                          onClick={e => { e.stopPropagation(); setOpenCue({ index: s.index, lang }) }}
                        >
                          💬{open ? ` ${open}` : ''}
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
          <div style={{ width: 380, flexShrink: 0, borderLeft: '1px solid var(--border2)', background: 'var(--bg1)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="caps">Versions</span>
              <button className="panel-close" style={{ marginLeft: 'auto' }} onClick={() => setHistoryOpen(false)} aria-label="Close history">×</button>
            </div>
            <div style={{ overflowY: 'auto', flex: picked ? '0 0 auto' : 1, maxHeight: picked ? '40%' : undefined }}>
              {versions.length === 0 && <div className="muted" style={{ padding: 14 }}>No versions yet — the first save records one.</div>}
              {versions.map(v => (
                <button
                  key={v.id}
                  onClick={() => void pick(v)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: picked?.summary.id === v.id ? 'var(--accent-dim)' : 'transparent', color: 'var(--text2)', font: 'inherit' }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12 }}>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>v{v.version ?? '?'}</span>
                    <span style={{ color: 'var(--text)' }}>{v.author_name ?? 'Someone'}</span>
                    {v.guest_id && <span className="muted" style={{ fontSize: 9 }}>client</span>}
                    <span className="muted" style={{ marginLeft: 'auto', fontSize: 10 }} suppressHydrationWarning>{when(v.created_at)}</span>
                  </div>
                  {v.note && <div className="muted" style={{ marginTop: 2, fontSize: 11 }}>{v.note}</div>}
                  {loadingVersion === v.id && <span className="spinner" />}
                </button>
              ))}
            </div>
            {picked && (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border2)' }}>
                <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)' }}>
                  <span>v{picked.summary.version ?? '?'} → now: {changes.length} line{changes.length === 1 ? '' : 's'} differ</span>
                  {canRestore && (
                    <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => void restore()}>
                      Restore v{picked.summary.version ?? '?'}
                    </button>
                  )}
                </div>
                <div style={{ overflowY: 'auto', flex: 1, padding: '0 14px 14px' }}>
                  {changes.length === 0 && <div className="muted">The words are the same as on screen now.</div>}
                  {changes.map(ch => (
                    <div key={`${ch.lang}|${ch.index}`} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12, lineHeight: 1.5 }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>
                        <a href={`#cue-${ch.index}`} style={{ color: 'inherit' }}>#{ch.index}</a> · {label(ch.lang)}
                      </div>
                      <div style={{ wordBreak: 'break-word' }}>
                        {wordDiff(ch.before, ch.after).map((op, i) =>
                          op.type === 'eq' ? <span key={i}>{op.val} </span> :
                          op.type === 'ins' ? <span key={i} className="diff-ins">{op.val} </span> :
                                              <span key={i} className="diff-del">{op.val} </span>,
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
