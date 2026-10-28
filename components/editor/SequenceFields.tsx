'use client'

import { useState } from 'react'

import GlossaryRows from '@/components/glossary/GlossaryRows'
import { SOURCE_LANGUAGES } from '@/lib/providers'
import { LINE_CHARS, qcFor, qcForMode } from '@/lib/subtitles'
import { useSubtitleStore } from '@/store/useSubtitleStore'

import s from './editor.module.css'

/** Which kind of property moved, so the panel can say what adapting it takes. */
export type Changed = 'layout' | 'sdh' | 'lang'

/**
 * The sequence's properties, as fields: the language spoken in it, the shape
 * of the screen, how many lines and how long each, and whether it is for the
 * deaf and hard of hearing. The dialog that creates a sequence shows them and
 * so does Propiedades; both write straight to the store.
 */
export default function SequenceFields({ idPrefix, onChange }: {
  /** Two of these can be on the page at once — the dialog over the panel. */
  idPrefix: string
  onChange?: (what: Changed) => void
}) {
  const { settings, srcLang, setSettings, setSrcLang } = useSubtitleStore()
  const qc = qcFor(settings)
  const own = qcForMode(settings.outputMode).maxChars
  // Typed into rather than bound: "3" on the way to "37" is not a line length.
  const [chars, setChars] = useState(settings.maxChars?.toString() ?? '')
  const n = Number(chars)
  const valid = chars === '' || (Number.isInteger(n) && n >= LINE_CHARS.min && n <= LINE_CHARS.max)

  const set = (patch: Parameters<typeof setSettings>[0], what: Changed) => { setSettings(patch); onChange?.(what) }
  const commitChars = () => {
    if (!valid) return
    const next = chars === '' ? null : n
    if (next !== settings.maxChars) set({ maxChars: next }, 'layout')
  }

  return (
    <div className={s.fields}>
      <div>
        <label className="caps" htmlFor={`${idPrefix}Lang`}>Idioma del original</label>
        <div className="select-wrap">
          <select id={`${idPrefix}Lang`} className="field" value={srcLang} onChange={e => { setSrcLang(e.target.value); onChange?.('lang') }}>
            {SOURCE_LANGUAGES.map(l => <option key={l}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className={s.fieldPair}>
        <div>
          <span className="caps" id={`${idPrefix}Mode`}>Salida</span>
          <div className="seg" role="group" aria-labelledby={`${idPrefix}Mode`}>
            <button aria-pressed={settings.outputMode === 'horizontal'} onClick={() => set({ outputMode: 'horizontal' }, 'layout')}>Horizontal</button>
            <button aria-pressed={settings.outputMode === 'vertical'} onClick={() => set({ outputMode: 'vertical' }, 'layout')}>Vertical</button>
          </div>
        </div>
        <div>
          <span className="caps" id={`${idPrefix}Lines`}>Líneas</span>
          <div className="seg" role="group" aria-labelledby={`${idPrefix}Lines`}>
            <button aria-pressed={settings.maxLines === 1} onClick={() => set({ maxLines: 1 }, 'layout')}>1</button>
            <button aria-pressed={settings.maxLines === 2} onClick={() => set({ maxLines: 2 }, 'layout')}>2</button>
          </div>
        </div>
        <div>
          <label className="caps" htmlFor={`${idPrefix}Chars`}>Caracteres</label>
          <input id={`${idPrefix}Chars`} className={`field ${s.chars}`} inputMode="numeric" value={chars} placeholder={String(own)}
            aria-invalid={!valid || undefined} aria-describedby={`${idPrefix}Hint`}
            onChange={e => setChars(e.target.value.replace(/\D/g, ''))} onBlur={commitChars}
            onKeyDown={e => { if (e.key === 'Enter') commitChars() }} />
        </div>
      </div>
      <div className={s.hint} id={`${idPrefix}Hint`}>
        {valid
          ? `Hasta ${qc.maxLines === 1 ? 'una línea' : 'dos líneas'} de ${qc.maxChars} caracteres · aviso a partir de ${qc.cpsWarn} cps. Vacío, ${own} para ${settings.outputMode === 'vertical' ? 'vertical' : 'horizontal'}.`
          : `Entre ${LINE_CHARS.min} y ${LINE_CHARS.max} caracteres por línea.`}
      </div>
      <div className={s.radios}>
        <label><input type="checkbox" checked={settings.sdh} onChange={e => set({ sdh: e.target.checked }, 'sdh')} /> Para sordos (SDH): transcribir los sonidos y quién habla</label>
      </div>
    </div>
  )
}

/**
 * The project's glossary, which every sequence in it obeys — shown where a
 * sequence is created and in Propiedades. Editing it here edits it for the
 * whole project.
 */
export function GlossaryFields({ onChange, commands = false }: {
  onChange?: () => void
  /** Whether the add button is the palette's: only one copy on the page may be. */
  commands?: boolean
}) {
  const { glossary, client, setGlossary } = useSubtitleStore()
  const edit = (entries: typeof glossary) => { setGlossary(entries); onChange?.() }
  return (
    <>
      <span className="caps"><span>Glosario del proyecto</span><span>{glossary.length}</span></span>
      <div className={s.hint}>Cada secuencia de este proyecto traduce estos términos igual. Deja la traducción vacía para conservar el término tal cual. La transcripción los espera, y sus variantes mal escritas se corrigen solas.</div>
      <GlossaryRows entries={glossary} onChange={edit} />
      <div><button className="btn" data-cmd={commands ? 'Añadir un término al glosario' : undefined} onClick={() => edit([...glossary, { term: '', translation: '' }])}>Añadir término</button></div>
      {client && (
        <div className={s.hint}>
          También rigen {client.glossary.length} {client.glossary.length === 1 ? 'término' : 'términos'} de {client.name}, que se editan en la página del proyecto. Donde coinciden, gana el del proyecto.
        </div>
      )}
    </>
  )
}
