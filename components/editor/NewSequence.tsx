'use client'

import Dialog from '@/components/Dialog'

import s from './editor.module.css'
import SequenceFields, { GlossaryFields } from './SequenceFields'

/**
 * What a sequence is made to, asked once, before there is anything in it.
 *
 * The answers decide how the transcription cuts its cues and what every
 * translation must fit, so they are cheapest to give now: changed later, in
 * Propiedades, the content has to be adapted to them. Each field writes to
 * the store as it moves, so closing the dialog any way at all keeps what was
 * chosen — the button only says so.
 */
export default function NewSequence({ onClose }: { onClose: () => void }) {
  return (
    <Dialog label="Nueva secuencia" className={s.newSeq} onClose={onClose}>
      <div className="panel-head">
        <span className="panel-title">Nueva secuencia</span>
        <span className="muted">Se puede cambiar después en Propiedades</span>
      </div>
      <div className={`panel-body ${s.newBody}`}>
        <SequenceFields idPrefix="new" />
        <div className={s.newGlossary}><GlossaryFields /></div>
      </div>
      <div className="panel-foot">
        <button className="btn btn-primary" autoFocus onClick={onClose}>Crear la secuencia</button>
      </div>
    </Dialog>
  )
}
