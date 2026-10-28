'use client'

import { useRef, useState, type DragEvent } from 'react'

import s from './editor.module.css'
import { ANY_FILE, useImport } from './useJobs'

/**
 * What an empty sequence shows where the cues will be: the way in.
 *
 * One place takes any of it — a video or a sound, which the viewer plays and
 * Transcribir sends; subtitles or plain text, which become the cues — chosen,
 * dropped anywhere on this side, or pasted. The viewer and the wave are not
 * drawn until there is something to show in them.
 */
export default function Intake({ onMore }: {
  /** The Importar step, with the format to read pasted text as. */
  onMore: () => void
}) {
  const importJob = useImport()
  const fileRef = useRef<HTMLInputElement>(null)
  const [paste, setPaste] = useState('')
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const take = (f: File | undefined) => {
    if (!f) return
    setError(importJob.any(f) ? null : `${f.name} no es un vídeo, un audio ni un archivo de subtítulos o texto.`)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    take(e.dataTransfer.files[0])
  }

  return (
    <div className={s.main}>
      <div
        className={s.intake}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false) }}
        onDrop={onDrop}
      >
        <div className={s.intakeBody}>
          <h2>Importa el material</h2>
          <input ref={fileRef} type="file" accept={ANY_FILE} hidden
            onChange={e => { take(e.target.files?.[0]); e.target.value = '' }} />
          <button type="button" className={`${s.drop} ${s.dropLarge}`} data-over={over || undefined} onClick={() => fileRef.current?.click()}>
            <span>Suelta aquí un archivo o elígelo</span>
            <small>Vídeo · audio · SRT · VTT · TXT · CSV</small>
          </button>
          {error && <div className={s.jobMsg} data-tone="danger" role="alert">{error}</div>}
          <div className={s.hint}>El vídeo o el audio se ve en el visor y se transcribe; los subtítulos y el texto entran como cues.</div>
          <div>
            <label className="caps" htmlFor="intakePaste">O pega el texto</label>
            <textarea id="intakePaste" className="field" rows={5} value={paste} onChange={e => setPaste(e.target.value)}
              placeholder="SRT, VTT, CSV o una línea por cue…" spellCheck={false} />
            <div className={`${s.chips} ${s.follows}`}>
              <button className="btn" disabled={!paste.trim()} onClick={() => { importJob.fromText(paste, 'auto'); setPaste('') }}>Leer lo pegado</button>
              <button className="btn btn-quiet" onClick={onMore}>Elegir el formato</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
