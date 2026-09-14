'use client'

import { useMemo, useRef, useState } from 'react'

import type { Entitlement } from '@/lib/entitlement'
import { TRIAL } from '@/lib/plans'
import { QUICK_LANGS, SOURCE_LANGUAGES, TARGET_LANGUAGES } from '@/lib/providers'
import { type ParseHint, type SubtitleFormat, qcForMode, qcTrack } from '@/lib/subtitles'
import { formatDuration } from '@/lib/usage'
import { useSubtitleStore } from '@/store/useSubtitleStore'

import s from './editor.module.css'
import type { Filter } from './CueTable'
import { langCode, useExport, useImport, useTranscribe, useTranslate } from './useJobs'
import { usePasses } from './usePasses'

export type Step = 'import' | 'transcribe' | 'translate' | 'review' | 'export'

interface Props {
  entitlement: Entitlement
  /** The step that is open. Lifted: the empty table sends people to the first one. */
  step: Step | null
  onStep: (step: Step | null) => void
  filter: Filter
  onFilter: (f: Filter) => void
  /** Show the project in the inspector: the glossary lives there. */
  onProject: () => void
}

/**
 * The work, as five steps down the left: import, transcribe, translate,
 * review, export. Each says how it is going in one line, and opens to show
 * its controls only when it is the step being worked on.
 *
 * This is where the old sidebar's forty-eight buttons went. They still exist
 * — every one is reachable from ⌘K — but each appears only where it applies,
 * so the screen can be quiet without anybody doubting what is inside.
 */
export default function Pipeline({ entitlement, step: open, onStep, filter, onFilter, onProject }: Props) {
  const {
    subtitles, translations, activeTab, outputMode, srcLang, tgtLang, allowRephrase, glossary, mediaId,
    translateJob, transcribeJob, reviewJob, backTranslateJob, reviewNotes, backTranslations, comments,
    setSrcLang, setTgtLang, setOutputMode, setAllowRephrase, clearAll, clearReviewNotes, getFinalSubs,
  } = useSubtitleStore()

  const importJob = useImport()
  const translate = useTranslate()
  const transcribe = useTranscribe()
  const exporter = useExport()
  const passes = usePasses()

  const langs = Object.keys(translations)
  const hasSubs = subtitles.length > 0
  const activeTrack = activeTab === 'source' ? undefined : translations[activeTab]
  const hasTrans = !!activeTrack
  const qc = qcForMode(outputMode)

  const toggle = (st: Step) => onStep(open === st ? null : st)

  const [hint, setHint] = useState<ParseHint>('auto')
  const [paste, setPaste] = useState('')
  const [xcFile, setXcFile] = useState<File | null>(null)
  const [xcLang, setXcLang] = useState('auto')
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [exportFmt, setExportFmt] = useState<SubtitleFormat>('srt')
  const [allFmt, setAllFmt] = useState<'xlsx' | 'csv'>('xlsx')
  const [reviseOpen, setReviseOpen] = useState(false)
  const [reviseText, setReviseText] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const xcRef = useRef<HTMLInputElement>(null)

  // The verdict on the language on screen, for the review step's line. The
  // track is named as a dependency so an edit to one cue recounts.
  const quality = useMemo(
    () => (activeTrack ? qcTrack(getFinalSubs(activeTab), qc, glossary) : null),
    [activeTrack, activeTab, getFinalSubs, qc, glossary],
  )
  const warns = quality ? [...quality.values()].filter(q => q.status === 'warn').length : 0
  const errs  = quality ? [...quality.values()].filter(q => q.status === 'error').length : 0
  const notes = hasTrans ? reviewNotes[activeTab] : undefined
  const openComments = comments.filter(c => !c.resolved).length

  const targetLang = showCustom ? custom.trim() : tgtLang

  const meter = allowanceOf(entitlement)

  return (
    <aside className={s.pipe} aria-label="Pipeline">
      <span className={`caps ${s.pipeTitle}`}>Pipeline</span>

      {/* 01 · Importar */}
      <section className={s.step} data-done={hasSubs}>
        <button className={s.stepHead} aria-expanded={open === 'import'} onClick={() => toggle('import')}>
          <span className={s.stepNum}>01</span>
          <span>
            <span className={s.stepName}>Importar</span>
            <span className={s.stepStatus}>
              {hasSubs ? `${subtitles.length} cues · ${srcLang === 'Auto-detect' ? 'idioma por detectar' : langCode(srcLang)}` : 'Abre un archivo o pega el texto'}
            </span>
          </span>
        </button>
        {open === 'import' && (
          <div className={s.stepBody}>
            <input ref={fileRef} type="file" accept=".srt,.txt,.csv,.vtt" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) { importJob.fromFile(f, hint); e.target.value = '' } }} />
            <div className={s.chips}>
              <button className="btn" data-cmd="Abrir un archivo de subtítulos" data-cmd-hint="SRT · VTT · TXT · CSV" onClick={() => fileRef.current?.click()}>Abrir archivo</button>
              <button className="btn btn-quiet" data-cmd="Vaciar los cues" disabled={!hasSubs} onClick={clearAll}>Vaciar</button>
            </div>
            <div>
              <textarea className="field" rows={3} value={paste} onChange={e => setPaste(e.target.value)} placeholder="O pega aquí SRT, VTT, CSV o texto…" spellCheck={false} />
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
          </div>
        )}
      </section>

      {/* 02 · Transcribir */}
      <section className={s.step} data-done={!!mediaId}>
        <button className={s.stepHead} aria-expanded={open === 'transcribe'} onClick={() => toggle('transcribe')}>
          <span className={s.stepNum}>02</span>
          <span>
            <span className={s.stepName}>Transcribir</span>
            <span className={s.stepStatus} data-tone={transcribeJob.error ? 'danger' : undefined}>
              {transcribeJob.running ? transcribeJob.message
                : transcribeJob.error ? transcribeJob.error
                : mediaId ? 'Audio subido'
                : hasSubs ? 'Omitido — el texto ya está'
                : 'Sube audio o vídeo'}
            </span>
          </span>
        </button>
        {open === 'transcribe' && (
          <div className={s.stepBody}>
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
              onClick={() => { if (xcFile) void transcribe.start(xcFile, xcLang) }}>Transcribir</button>
            {transcribeJob.message && !transcribeJob.running && <div className={s.jobMsg} data-tone="ok">{transcribeJob.message}</div>}
          </div>
        )}
      </section>

      {/* 03 · Traducir */}
      <section className={s.step} data-done={langs.length > 0}>
        <button className={s.stepHead} aria-expanded={open === 'translate'} onClick={() => toggle('translate')}>
          <span className={s.stepNum}>03</span>
          <span>
            <span className={s.stepName}>Traducir</span>
            <span className={s.stepStatus} data-tone={translateJob.error ? 'danger' : undefined}>
              {translateJob.running ? translateJob.message
                : translateJob.error ? translateJob.error
                : langs.length ? `${langs.map(langCode).join(' · ')} listo`
                : hasSubs ? 'Elige el idioma de destino'
                : 'Primero hacen falta cues'}
            </span>
          </span>
        </button>
        {open === 'translate' && (
          <div className={s.stepBody}>
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
              onClick={() => void translate.start(targetLang)}>Traducir a {targetLang ? langCode(targetLang) : '…'}</button>
            {translateJob.running && <div className="meter"><div className="meter-fill" style={{ width: `${translateJob.progress}%` }} /></div>}
            {!translateJob.running && translateJob.message && <div className={s.jobMsg} data-tone="ok">{translateJob.message}</div>}
          </div>
        )}
      </section>

      {/* 04 · Revisar */}
      <section className={s.step} data-done={hasTrans && errs === 0 && warns === 0}>
        <button className={s.stepHead} aria-expanded={open === 'review'} onClick={() => toggle('review')}>
          <span className={s.stepNum}>04</span>
          <span>
            <span className={s.stepName}>Revisar</span>
            <span className={s.stepStatus} data-tone={errs ? 'danger' : warns ? 'warn' : undefined}>
              {!hasTrans ? (langs.length ? 'Elige un idioma en la tabla' : 'Primero hace falta una traducción')
                : reviewJob.running ? reviewJob.message
                : `${warns} avisos · ${errs} errores${notes ? ` · ${notes.length} notas` : ''}`}
            </span>
          </span>
        </button>
        {open === 'review' && hasTrans && (
          <div className={s.stepBody}>
            <div className={s.chips}>
              {errs > 0 && <button className="btn" data-cmd="Acortar los cues demasiado largos" onClick={() => void passes.fixOverlength()}>Acortar los largos</button>}
              <button className="btn" data-cmd={backTranslations[activeTab] ? 'Ocultar la retrotraducción' : 'Retrotraducir para comprobar el sentido'} aria-busy={backTranslateJob.running || undefined}
                onClick={() => void passes.backTranslate()}>{backTranslations[activeTab] ? 'Ocultar retrotraducción' : 'Retrotraducir'}</button>
              <button className="btn" data-cmd="Revisar la traducción y señalar lo que está mal" disabled={reviewJob.running} aria-busy={reviewJob.running || undefined}
                onClick={() => void passes.review()}>Revisar con IA</button>
              <button className="btn" data-cmd="Corregir la traducción con una nota" aria-pressed={reviseOpen} onClick={() => setReviseOpen(v => !v)}>Corregir con una nota</button>
            </div>
            {reviseOpen && (
              <div>
                <textarea className="field" rows={4} maxLength={2000} value={reviseText} onChange={e => setReviseText(e.target.value)}
                  placeholder={'¿Qué hay que cambiar? Nombra los números de cue — el resto vuelve intacto.\n\np. ej. 18: quita el final repetido, ya está en el 19. 53: «Reserva de la Familia» con mayúsculas.'} />
                <div className={s.chips} style={{ marginTop: 'var(--sp-2)', alignItems: 'center' }}>
                  <button className="btn btn-primary" disabled={!reviseText.trim() || translateJob.running} aria-busy={translateJob.running || undefined}
                    onClick={() => void passes.revise(reviseText)}>Aplicar a {langCode(activeTab)}</button>
                  <span className={s.counter}>{reviseText.length}/2000</span>
                </div>
              </div>
            )}
            {(translateJob.error || reviewJob.error || backTranslateJob.error) && (
              <div className={s.jobMsg} data-tone="danger">{translateJob.error ?? reviewJob.error ?? backTranslateJob.error}</div>
            )}
            {notes && (
              <div>
                <span className="caps">Revisión · {notes.length} {notes.length === 1 ? 'nota' : 'notas'}</span>
                {notes.length === 0
                  ? <div className={s.hint}>Nada que señalar: nada contradice el original.</div>
                  : <div className={s.notes}>
                      {notes.map(n => <div key={n.cue} className={s.note}><b data-level={n.level}>#{n.cue}</b><span>{n.note}</span></div>)}
                    </div>}
                <div className={s.chips} style={{ marginTop: 'var(--sp-2)' }}>
                  {notes.length > 0 && <button className="btn btn-quiet" aria-pressed={filter === 'noted'} onClick={() => onFilter(filter === 'noted' ? null : 'noted')}>{filter === 'noted' ? 'Ver todos' : 'Solo estos'}</button>}
                  <button className="btn btn-quiet" onClick={() => { clearReviewNotes(activeTab); if (filter === 'noted') onFilter(null) }}>Descartar</button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 05 · Exportar */}
      <section className={s.step}>
        <button className={s.stepHead} aria-expanded={open === 'export'} onClick={() => toggle('export')}>
          <span className={s.stepNum}>05</span>
          <span>
            <span className={s.stepName}>Exportar</span>
            <span className={s.stepStatus}>
              {!hasSubs ? 'Nada que exportar' : `${exportFmt.toUpperCase()} ${outputMode} · ${activeTab === 'source' ? (srcLang === 'Auto-detect' ? 'original' : langCode(srcLang)) : langCode(activeTab)}${langs.length > 1 ? ` · ${langs.length} idiomas` : ''}`}
            </span>
          </span>
        </button>
        {open === 'export' && (
          <div className={s.stepBody}>
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
          </div>
        )}
      </section>

      {/* The palette reads every [data-cmd] on the page, and a closed step
          still has things it can do. These are the same actions, unseen,
          rendered only while their step is shut so nothing is listed twice. */}
      <span hidden>
        {open !== 'import' && <button data-cmd="Abrir un archivo de subtítulos" data-cmd-hint="SRT · VTT · TXT · CSV" onClick={() => { onStep('import'); setTimeout(() => fileRef.current?.click(), 0) }} />}
        {open !== 'transcribe' && <button data-cmd="Transcribir el audio" onClick={() => onStep('transcribe')} />}
        {open !== 'translate' && hasSubs && !!targetLang && !translateJob.running && <button data-cmd="Traducir al idioma de destino" data-cmd-hint={langCode(targetLang)} onClick={() => void translate.start(targetLang)} />}
        {open !== 'review' && hasTrans && errs > 0 && <button data-cmd="Acortar los cues demasiado largos" onClick={() => void passes.fixOverlength()} />}
        {open !== 'review' && hasTrans && <button data-cmd={backTranslations[activeTab] ? 'Ocultar la retrotraducción' : 'Retrotraducir para comprobar el sentido'} onClick={() => void passes.backTranslate()} />}
        {open !== 'review' && hasTrans && !reviewJob.running && <button data-cmd="Revisar la traducción y señalar lo que está mal" onClick={() => void passes.review()} />}
        {open !== 'review' && hasTrans && <button data-cmd="Corregir la traducción con una nota" onClick={() => { onStep('review'); setReviseOpen(true) }} />}
        {open !== 'export' && hasSubs && <button data-cmd="Exportar la pestaña en pantalla" data-cmd-hint={exportFmt.toUpperCase()} onClick={() => exporter.tab(exportFmt)} />}
        {open !== 'export' && langs.length > 0 && <button data-cmd="Exportar todos los idiomas en una hoja" data-cmd-hint={allFmt.toUpperCase()} onClick={() => exporter.all(allFmt)} />}
      </span>

      <div className={s.pipeFoot}>
        <div className={s.pipeRow} style={{ cursor: 'default' }}>
          Comentarios <span className="badge" data-unread={openComments > 0 || undefined}>{openComments ? `${openComments} abiertos` : comments.length}</span>
        </div>
        <button className={s.pipeRow} data-cmd="Abrir el glosario" onClick={onProject}>
          Glosario <span className="badge">{glossary.length}</span>
        </button>
        {meter && (
          <div>
            <div className={s.meterRow}>
              <span className="caps">{meter.label}</span>
              <span className={s.meterVal} data-tone={meter.tone}>{meter.figures}</span>
            </div>
            <div className="meter"><div className={`meter-fill ${meter.tone === 'danger' ? 'none' : meter.tone === 'warn' ? 'low' : ''}`} style={{ width: `${Math.round(meter.fraction * 100)}%` }} /></div>
            {meter.tone && <a className={s.hint} href="/pricing">{meter.tone === 'danger' ? 'Agotado — ver planes' : 'Queda poco — ver planes'}</a>}
          </div>
        )}
      </div>
    </aside>
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
