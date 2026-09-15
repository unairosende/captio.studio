'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { Entitlement } from '@/lib/entitlement'
import { TRIAL } from '@/lib/plans'
import { QUICK_LANGS, SOURCE_LANGUAGES, TARGET_LANGUAGES } from '@/lib/providers'
import { type ParseHint, type SubtitleFormat, qcForMode } from '@/lib/subtitles'
import { formatDuration } from '@/lib/usage'
import { useSubtitleStore } from '@/store/useSubtitleStore'

import s from './editor.module.css'
import { langCode, sourceLabel, useExport, useImport, useTranscribe, useTranslate } from './useJobs'

export type Step = 'import' | 'transcribe' | 'translate' | 'deliver'

interface Props {
  entitlement: Entitlement
  /** The step whose drawer is open. Lifted: the empty table sends people to the first one. */
  step: Step | null
  onStep: (step: Step | null) => void
  /** Whether the panel on the right is showing. */
  panel: boolean
  onPanel: () => void
}

/**
 * The work, as four steps in a line above the table: import, transcribe,
 * translate, deliver. Each says how it is going in a few words; pulling one
 * hangs a drawer of its controls under it, which goes away on its own once
 * the action is launched. Reviewing is not a step — it is what the panel on
 * the right is for, because it never ends.
 *
 * Every control here is also reachable from ⌘K, whether its drawer is open
 * or not, so the bar can stay this quiet.
 */
export default function Steps({ entitlement, step: open, onStep, panel, onPanel }: Props) {
  const {
    subtitles, translations, activeTab, outputMode, srcLang, tgtLang, allowRephrase, mediaId, viewMode,
    translateJob, transcribeJob,
    setSrcLang, setTgtLang, setOutputMode, setAllowRephrase, setViewMode, clearAll,
  } = useSubtitleStore()

  const importJob = useImport()
  const translate = useTranslate()
  const transcribe = useTranscribe()
  const exporter = useExport()

  const langs = Object.keys(translations)
  const hasSubs = subtitles.length > 0
  const qc = qcForMode(outputMode)

  const [hint, setHint] = useState<ParseHint>('auto')
  const [paste, setPaste] = useState('')
  const [xcFile, setXcFile] = useState<File | null>(null)
  const [xcLang, setXcLang] = useState('auto')
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [exportFmt, setExportFmt] = useState<SubtitleFormat>('srt')
  const [allFmt, setAllFmt] = useState<'xlsx' | 'csv'>('xlsx')

  const fileRef = useRef<HTMLInputElement>(null)
  const xcRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLElement>(null)

  const close = () => onStep(null)
  const toggle = (st: Step) => onStep(open === st ? null : st)

  // A drawer closes when the pointer goes somewhere else, or on esc.
  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (!barRef.current?.contains(e.target as Node)) onStep(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onStep(null)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open, onStep])

  const targetLang = showCustom ? custom.trim() : tgtLang
  const meter = allowanceOf(entitlement)
  const onScreen = activeTab === 'source' ? sourceLabel(srcLang) : langCode(activeTab)

  return (
    <nav className={s.steps} aria-label="Pasos" ref={barRef}>
      {/* 01 · Importar */}
      <StepItem id="import" name="Importar" open={open} done={hasSubs} onToggle={toggle}
        status={hasSubs ? `${subtitles.length} cues · ${srcLang === 'Auto-detect' ? 'idioma por detectar' : langCode(srcLang)}` : 'archivo o texto'}>
        <input ref={fileRef} type="file" accept=".srt,.txt,.csv,.vtt" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) { importJob.fromFile(f, hint); close() } e.target.value = '' }} />
        <div className={s.chips}>
          <button className="btn" data-cmd="Abrir un archivo de subtítulos" data-cmd-hint="SRT · VTT · TXT · CSV" onClick={() => fileRef.current?.click()}>Abrir archivo</button>
          <button className="btn btn-quiet" data-cmd="Vaciar los cues" disabled={!hasSubs} onClick={() => { if (confirm('¿Vaciar todos los cues y sus traducciones?')) { clearAll(); close() } }}>Vaciar</button>
        </div>
        <div>
          <textarea className="field" rows={3} value={paste} onChange={e => setPaste(e.target.value)} placeholder="O pega aquí SRT, VTT, CSV o texto…" spellCheck={false} />
          <button className="btn" style={{ marginTop: 'var(--sp-2)' }} data-cmd="Leer el texto pegado" disabled={!paste.trim()}
            onClick={() => { importJob.fromText(paste, hint); setPaste(''); close() }}>Leer lo pegado</button>
        </div>
        <div>
          <label className="caps" htmlFor="hint">Formato</label>
          <div className="select-wrap">
            <select id="hint" className="field" value={hint} onChange={e => setHint(e.target.value as ParseHint)}>
              <option value="auto">Detectar</option>
              <option value="srt">SRT</option>
              <option value="txt">TXT (una línea por cue)</option>
              <option value="csv">CSV</option>
            </select>
          </div>
        </div>
      </StepItem>

      {/* 02 · Transcribir */}
      <StepItem id="transcribe" name="Transcribir" open={open} done={!!mediaId} onToggle={toggle}
        tone={transcribeJob.error ? 'danger' : undefined}
        status={transcribeJob.running ? transcribeJob.message
          : transcribeJob.error ? transcribeJob.error
          : mediaId ? 'audio subido'
          : hasSubs ? 'omitido'
          : 'audio o vídeo'}>
        <div>
          <label className="caps" htmlFor="xcLang">Idioma del audio</label>
          <div className="select-wrap">
            <select id="xcLang" className="field" value={xcLang} onChange={e => setXcLang(e.target.value)}>
              <option value="auto">Detectar</option>
              {['es','en','fr','de','it','pt','nl','pl','ru','tr','ar','ja','ko','zh','ca'].map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </div>
        </div>
        <input ref={xcRef} type="file" accept="audio/*,video/*,.mp3,.mp4,.wav,.m4a,.mov,.mkv,.aac,.ogg,.flac,.webm" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) setXcFile(f); e.target.value = '' }} />
        {xcFile ? (
          <div className={s.file}>
            <span title={xcFile.name}>{xcFile.name}</span>
            <span>{(xcFile.size / 1024 / 1024).toFixed(1)} MB</span>
            <button className="btn btn-quiet" aria-label="Quitar el archivo" onClick={() => setXcFile(null)}>×</button>
          </div>
        ) : (
          <button type="button" className={s.drop} onClick={() => xcRef.current?.click()}>
            <span>Elige un audio o un vídeo</span>
            <small>MP3 · MP4 · WAV · M4A · máx. 25 MB</small>
          </button>
        )}
        <button className="btn btn-primary" data-cmd="Transcribir el audio" disabled={!xcFile || transcribeJob.running} aria-busy={transcribeJob.running || undefined}
          onClick={() => { if (xcFile) { void transcribe.start(xcFile, xcLang); close() } }}>Transcribir</button>
        {transcribeJob.message && !transcribeJob.running && <div className={s.jobMsg} data-tone="ok">{transcribeJob.message}</div>}
        {meter && <Allowance meter={meter} />}
      </StepItem>

      {/* 03 · Traducir */}
      <StepItem id="translate" name="Traducir" open={open} done={langs.length > 0} onToggle={toggle}
        tone={translateJob.error ? 'danger' : undefined}
        status={translateJob.running ? translateJob.message
          : translateJob.error ? translateJob.error
          : langs.length ? langs.map(langCode).join(' · ')
          : hasSubs ? 'elige el idioma'
          : 'faltan cues'}>
        <div>
          <label className="caps" htmlFor="srcLang">Idioma de origen</label>
          <div className="select-wrap">
            <select id="srcLang" className="field" value={srcLang} onChange={e => setSrcLang(e.target.value)}>
              {SOURCE_LANGUAGES.map(l => <option key={l}>{l}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="caps" htmlFor="tgtLang">Idioma de destino</label>
          <div className="select-wrap">
            <select id="tgtLang" className="field" value={showCustom ? '__custom__' : tgtLang}
              onChange={e => { if (e.target.value === '__custom__') setShowCustom(true); else { setShowCustom(false); setTgtLang(e.target.value) } }}>
              {TARGET_LANGUAGES.map(l => <option key={l}>{l}</option>)}
              <option value="__custom__">Otro…</option>
            </select>
          </div>
          {showCustom && <input className="field" style={{ marginTop: 'var(--sp-1)' }} value={custom} onChange={e => setCustom(e.target.value)} placeholder="Escribe el idioma" />}
          <div className={s.chips} style={{ marginTop: 'var(--sp-2)' }}>
            {QUICK_LANGS.map(l => (
              <button key={l} className="chip" aria-pressed={!showCustom && tgtLang === l} onClick={() => { setShowCustom(false); setTgtLang(l) }}>{langCode(l)}</button>
            ))}
          </div>
        </div>
        <div>
          <span className="caps">Formato de salida</span>
          <div className={s.radios}>
            <label><input type="radio" name="outputMode" checked={outputMode === 'horizontal'} onChange={() => setOutputMode('horizontal')} /> Horizontal</label>
            <label><input type="radio" name="outputMode" checked={outputMode === 'vertical'} onChange={() => setOutputMode('vertical')} /> Vertical (parte los largos)</label>
          </div>
          <div className={s.hint}>Máximo {qc.maxChars} caracteres por línea · aviso a partir de {qc.cpsWarn} cps</div>
        </div>
        <div className={s.radios}>
          <label><input type="checkbox" checked={allowRephrase} onChange={e => setAllowRephrase(e.target.checked)} /> Permitir reformular para que quepa</label>
        </div>
        <button className="btn btn-primary" data-cmd="Traducir al idioma de destino" disabled={!hasSubs || !targetLang || translateJob.running} aria-busy={translateJob.running || undefined}
          onClick={() => { void translate.start(targetLang); close() }}>Traducir a {targetLang ? langCode(targetLang) : '…'}</button>
        {!translateJob.running && translateJob.message && <div className={s.jobMsg} data-tone="ok">{translateJob.message}</div>}
        {meter && <Allowance meter={meter} />}
      </StepItem>

      {/* 04 · Entregar */}
      <StepItem id="deliver" name="Entregar" open={open} done={false} onToggle={toggle}
        status={!hasSubs ? 'nada que exportar' : `${exportFmt.toUpperCase()} · ${onScreen}${langs.length > 1 ? ` · ${langs.length} idiomas` : ''}`}>
        <div>
          <label className="caps" htmlFor="exportFmt">La pestaña en pantalla</label>
          <div className="select-wrap">
            <select id="exportFmt" className="field" value={exportFmt} onChange={e => setExportFmt(e.target.value as SubtitleFormat)}>
              <option value="srt">SRT</option><option value="vtt">VTT</option><option value="txt">TXT</option><option value="csv">CSV</option>
            </select>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 'var(--sp-2)' }} data-cmd="Exportar la pestaña en pantalla" disabled={!hasSubs} onClick={() => { exporter.tab(exportFmt); close() }}>
            Exportar {activeTab === 'source' ? 'el original' : langCode(activeTab)} <span className="kbd">⌘E</span>
          </button>
        </div>
        <div>
          <label className="caps" htmlFor="allFmt">Todos los idiomas en una hoja</label>
          <div className="select-wrap">
            <select id="allFmt" className="field" value={allFmt} onChange={e => setAllFmt(e.target.value as 'xlsx' | 'csv')}>
              <option value="xlsx">XLSX</option><option value="csv">CSV</option>
            </select>
          </div>
          <button className="btn" style={{ marginTop: 'var(--sp-2)' }} data-cmd="Exportar todos los idiomas en una hoja" data-cmd-hint="XLSX · CSV" disabled={!langs.length} onClick={() => { exporter.all(allFmt); close() }}>
            {langs.length ? `${langs.length} ${langs.length > 1 ? 'idiomas' : 'idioma'} en una hoja` : 'Una hoja, todos los idiomas'}
          </button>
        </div>
      </StepItem>

      <div className={s.stepsEnd}>
        <div className="seg" role="group" aria-label="Vista">
          <button aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}>Única</button>
          <button aria-pressed={viewMode === 'compare'} disabled={!langs.length} onClick={() => setViewMode('compare')}>Comparar</button>
        </div>
        <button className="btn btn-quiet" aria-pressed={panel} onClick={onPanel}>Panel</button>
      </div>

      {/* The palette reads every [data-cmd] on the page, and a closed drawer
          still has things it can do. These are the same actions, unseen,
          rendered only while their drawer is shut so nothing is listed twice. */}
      <span hidden>
        {open !== 'import' && <button data-cmd="Abrir un archivo de subtítulos" data-cmd-hint="SRT · VTT · TXT · CSV" onClick={() => { onStep('import'); setTimeout(() => fileRef.current?.click(), 0) }} />}
        {open !== 'transcribe' && <button data-cmd="Transcribir el audio" onClick={() => onStep('transcribe')} />}
        {open !== 'translate' && hasSubs && !!targetLang && !translateJob.running && <button data-cmd="Traducir al idioma de destino" data-cmd-hint={langCode(targetLang)} onClick={() => void translate.start(targetLang)} />}
        {open !== 'translate' && <button data-cmd="Elegir el idioma de destino" onClick={() => onStep('translate')} />}
        {open !== 'deliver' && hasSubs && <button data-cmd="Exportar la pestaña en pantalla" data-cmd-hint={exportFmt.toUpperCase()} onClick={() => exporter.tab(exportFmt)} />}
        {open !== 'deliver' && langs.length > 0 && <button data-cmd="Exportar todos los idiomas en una hoja" data-cmd-hint={allFmt.toUpperCase()} onClick={() => exporter.all(allFmt)} />}
        {langs.length > 0 && (viewMode === 'list'
          ? <button data-cmd="Comparar todos los idiomas" onClick={() => setViewMode('compare')} />
          : <button data-cmd="Ver un solo idioma" onClick={() => setViewMode('list')} />)}
      </span>
    </nav>
  )
}

/** One step in the bar, with its drawer hanging under it while open. */
function StepItem({ id, name, status, tone, done, open, onToggle, children }: {
  id: Step
  name: string
  status: string
  tone?: 'warn' | 'danger'
  done: boolean
  open: Step | null
  onToggle: (st: Step) => void
  children: ReactNode
}) {
  return (
    <div className={s.stepWrap} data-done={done}>
      <button className={s.stepBtn} aria-expanded={open === id} onClick={() => onToggle(id)}>
        <span className={s.stepDot} />
        <span className={s.stepName}>{name}</span>
        <span className={s.stepStatus} data-tone={tone}>{status}</span>
      </button>
      {open === id && (
        <div className={s.drawer} role="dialog" aria-label={name}>
          {children}
        </div>
      )}
    </div>
  )
}

function Allowance({ meter }: { meter: NonNullable<ReturnType<typeof allowanceOf>> }) {
  return (
    <div className={s.meter}>
      <div className={s.meterRow}>
        <span className="caps">{meter.label}</span>
        <span className={s.meterVal} data-tone={meter.tone}>{meter.figures}</span>
      </div>
      <div className="meter"><div className={`meter-fill ${meter.tone === 'danger' ? 'none' : meter.tone === 'warn' ? 'low' : ''}`} style={{ width: `${Math.round(meter.fraction * 100)}%` }} /></div>
      {meter.tone && <a className={s.hint} href="/pricing">{meter.tone === 'danger' ? 'Agotado — ver planes' : 'Queda poco — ver planes'}</a>}
    </div>
  )
}

/**
 * What is left before any of it is spent — of the trial, or of the month a
 * paid plan includes. The paywall lives in the API routes; this is the
 * warning, which is what decides whether hitting the limit feels like a
 * product or an ambush. Warned at a fifth left: a warning at zero is not one.
 */
function allowanceOf(e: Entitlement): { label: string; figures: string; fraction: number; tone?: 'warn' | 'danger' } | null {
  const m = e.status === 'subscribed'
    ? e.monthly && {
        label: e.monthly.plan,
        figures: `${formatDuration(e.monthly.remaining * 60)} de ${formatDuration(e.monthly.limit * 60)}`,
        fraction: e.monthly.remaining / e.monthly.limit,
      }
    : {
        label: 'Prueba',
        figures: `${Math.floor(e.remaining.mediaSeconds / 60)} min de material`,
        fraction: e.remaining.mediaSeconds / (TRIAL.mediaMinutes * 60),
      }
  if (!m) return null
  const tone = m.fraction <= 0 ? 'danger' : m.fraction <= 0.2 ? 'warn' : undefined
  return { ...m, tone }
}
