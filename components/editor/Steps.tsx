'use client'

import { useRef, useState, type ReactNode } from 'react'

import type { Entitlement } from '@/lib/entitlement'
import { TRIAL } from '@/lib/plans'
import { QUICK_LANGS, SOURCE_LANGUAGES, TARGET_LANGUAGES } from '@/lib/providers'
import { type ParseHint, type SubtitleFormat, qcForMode } from '@/lib/subtitles'
import { formatDuration } from '@/lib/usage'
import { useSubtitleStore } from '@/store/useSubtitleStore'

import s from './editor.module.css'
import { DeliverIcon, FileIcon, MicIcon, PanelLeftIcon, TranslateIcon } from './icons'
import { langCode, useExport, useImport, useTranscribe, useTranslate } from './useJobs'

export type Step = 'import' | 'transcribe' | 'translate' | 'deliver'

const STEPS: { id: Step; name: string; icon: ReactNode }[] = [
  { id: 'import', name: 'Importar', icon: <FileIcon /> },
  { id: 'transcribe', name: 'Transcribir', icon: <MicIcon /> },
  { id: 'translate', name: 'Traducir', icon: <TranslateIcon /> },
  { id: 'deliver', name: 'Entregar', icon: <DeliverIcon /> },
]

interface Props {
  entitlement: Entitlement
  /** The step whose controls fill the sidebar, or null while it is folded. */
  step: Step | null
  onStep: (step: Step | null) => void
}

/**
 * The work, as four icons down a rail: import, transcribe, translate,
 * deliver. The name shows on hover; pressing one fills the sidebar next to
 * it with that step's controls, and the sidebar stays until it is folded,
 * so a job launched from it can be watched from it. Reviewing is not a
 * step — it is what the panel on the right is for, because it never ends.
 *
 * Every control here is also reachable from ⌘K whether the sidebar shows
 * it or not, so the rail can stay this quiet.
 */
export default function Steps({ entitlement, step: open, onStep }: Props) {
  const {
    subtitles, translations, activeTab, outputMode, srcLang, tgtLang, allowRephrase,
    translateJob, transcribeJob,
    setSrcLang, setTgtLang, setOutputMode, setAllowRephrase, clearAll,
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

  const targetLang = showCustom ? custom.trim() : tgtLang
  const meter = allowanceOf(entitlement)
  const jobOf = (st: Step) => (st === 'transcribe' ? transcribeJob : st === 'translate' ? translateJob : null)

  return (
    <>
      <nav className={s.rail} aria-label="Pasos">
        {STEPS.map(({ id, name, icon }) => {
          const job = jobOf(id)
          return (
            <button key={id} className={s.railBtn} data-tip={name} aria-label={name} aria-pressed={open === id}
              aria-busy={job?.running || undefined} data-tone={job?.error ? 'danger' : undefined}
              onClick={() => onStep(open === id ? null : id)}>
              {icon}
            </button>
          )
        })}
      </nav>

      {open && (
        <aside className={s.left} aria-label={STEPS.find(st => st.id === open)!.name}>
          <div className={s.leftHead}>
            <h2>{STEPS.find(st => st.id === open)!.name}</h2>
            <button className="btn btn-quiet btn-icon" aria-label="Plegar la barra lateral" onClick={() => onStep(null)}><PanelLeftIcon /></button>
          </div>

          <div className={s.leftBody}>
            {/* 01 · Importar */}
            {open === 'import' && (
              <>
                <input ref={fileRef} type="file" accept=".srt,.txt,.csv,.vtt" hidden
                  onChange={e => { const f = e.target.files?.[0]; if (f) importJob.fromFile(f, hint); e.target.value = '' }} />
                <div className={s.chips}>
                  <button className="btn" data-cmd="Abrir un archivo de subtítulos" data-cmd-hint="SRT · VTT · TXT · CSV" onClick={() => fileRef.current?.click()}>Abrir archivo</button>
                  <button className="btn btn-quiet" data-cmd="Vaciar los cues" disabled={!hasSubs} onClick={() => { if (confirm('¿Vaciar todos los cues y sus traducciones?')) clearAll() }}>Vaciar</button>
                </div>
                <div>
                  <textarea className="field" rows={4} value={paste} onChange={e => setPaste(e.target.value)} placeholder="O pega aquí SRT, VTT, CSV o texto…" spellCheck={false} />
                  <button className="btn" style={{ marginTop: 'var(--sp-2)' }} data-cmd="Leer el texto pegado" disabled={!paste.trim()}
                    onClick={() => { importJob.fromText(paste, hint); setPaste('') }}>Leer lo pegado</button>
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
                <div className={s.hint}>{hasSubs ? `${subtitles.length} cues en la secuencia.` : 'Nada importado todavía.'}</div>
              </>
            )}

            {/* 02 · Transcribir */}
            {open === 'transcribe' && (
              <>
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
                <div>
                  <button className="btn btn-primary" data-cmd="Transcribir el audio" disabled={!xcFile || transcribeJob.running} aria-busy={transcribeJob.running || undefined}
                    onClick={() => { if (xcFile) void transcribe.start(xcFile, xcLang) }}>Transcribir</button>
                </div>
                {transcribeJob.running && <div className={s.jobMsg}>{transcribeJob.message}</div>}
                {!transcribeJob.running && transcribeJob.message && <div className={s.jobMsg} data-tone="ok">{transcribeJob.message}</div>}
                {transcribeJob.error && <div className={s.jobMsg} data-tone="danger">{transcribeJob.error}</div>}
                {meter && <Allowance meter={meter} />}
              </>
            )}

            {/* 03 · Traducir */}
            {open === 'translate' && (
              <>
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
                <div>
                  <button className="btn btn-primary" data-cmd="Traducir al idioma de destino" disabled={!hasSubs || !targetLang || translateJob.running} aria-busy={translateJob.running || undefined}
                    onClick={() => void translate.start(targetLang)}>Traducir a {targetLang ? langCode(targetLang) : '…'}</button>
                </div>
                {translateJob.running && (
                  <div>
                    <div className={s.jobMsg}>{translateJob.message}</div>
                    <div className="meter" style={{ marginTop: 'var(--sp-1)' }}><div className="meter-fill" style={{ width: `${translateJob.progress}%` }} /></div>
                  </div>
                )}
                {!translateJob.running && translateJob.message && <div className={s.jobMsg} data-tone="ok">{translateJob.message}</div>}
                {translateJob.error && <div className={s.jobMsg} data-tone="danger">{translateJob.error}</div>}
                {langs.length > 0 && <div className={s.hint}>Ya traducido a {langs.map(langCode).join(' · ')}.</div>}
                {meter && <Allowance meter={meter} />}
              </>
            )}

            {/* 04 · Entregar */}
            {open === 'deliver' && (
              <>
                <div>
                  <label className="caps" htmlFor="exportFmt">La pestaña en pantalla</label>
                  <div className="select-wrap">
                    <select id="exportFmt" className="field" value={exportFmt} onChange={e => setExportFmt(e.target.value as SubtitleFormat)}>
                      <option value="srt">SRT</option><option value="vtt">VTT</option><option value="txt">TXT</option><option value="csv">CSV</option>
                    </select>
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: 'var(--sp-2)' }} data-cmd="Exportar la pestaña en pantalla" disabled={!hasSubs} onClick={() => exporter.tab(exportFmt)}>
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
                  <button className="btn" style={{ marginTop: 'var(--sp-2)' }} data-cmd="Exportar todos los idiomas en una hoja" data-cmd-hint="XLSX · CSV" disabled={!langs.length} onClick={() => exporter.all(allFmt)}>
                    {langs.length ? `${langs.length} ${langs.length > 1 ? 'idiomas' : 'idioma'} en una hoja` : 'Una hoja, todos los idiomas'}
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      )}

      {/* The palette reads every [data-cmd] on the page, and a folded step
          still has things it can do. These are the same actions, unseen,
          rendered only while their step is not showing so nothing is listed twice. */}
      <span hidden>
        {open !== 'import' && <button data-cmd="Abrir un archivo de subtítulos" data-cmd-hint="SRT · VTT · TXT · CSV" onClick={() => { onStep('import'); setTimeout(() => fileRef.current?.click(), 0) }} />}
        {open !== 'transcribe' && <button data-cmd="Transcribir el audio" onClick={() => onStep('transcribe')} />}
        {open !== 'translate' && hasSubs && !!targetLang && !translateJob.running && <button data-cmd="Traducir al idioma de destino" data-cmd-hint={langCode(targetLang)} onClick={() => void translate.start(targetLang)} />}
        {open !== 'translate' && <button data-cmd="Elegir el idioma de destino" onClick={() => onStep('translate')} />}
        {open !== 'deliver' && hasSubs && <button data-cmd="Exportar la pestaña en pantalla" data-cmd-hint={exportFmt.toUpperCase()} onClick={() => exporter.tab(exportFmt)} />}
        {open !== 'deliver' && langs.length > 0 && <button data-cmd="Exportar todos los idiomas en una hoja" data-cmd-hint={allFmt.toUpperCase()} onClick={() => exporter.all(allFmt)} />}
        {open ? <button data-cmd="Plegar la barra lateral" onClick={() => onStep(null)} /> : <button data-cmd="Abrir la barra lateral" onClick={() => onStep(hasSubs ? 'translate' : 'import')} />}
      </span>
    </>
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
