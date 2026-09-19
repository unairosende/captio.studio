'use client'

import type { CSSProperties, ReactNode } from 'react'

import s from './styleguide.module.css'

/**
 * La biblioteca de piezas, con sus siete estados.
 *
 * Fase 04. Cada pieza de app/ui.css puesta en reposo · hover · foco · activo ·
 * deshabilitado · cargando · error, sobre la misma página que los tokens. Un
 * estado que no aplica se dice por escrito en su casilla, no se deja en
 * blanco: la casilla vacía es la que nadie diseñó.
 *
 * Los estados de ratón y teclado se fuerzan con data-state, que existe solo
 * para esta página. Los demás son los atributos que el producto escribirá de
 * verdad: disabled, aria-busy, aria-invalid, aria-selected.
 */

export const STATES = ['reposo', 'hover', 'foco', 'activo', 'deshabilitado', 'cargando', 'error'] as const
export type St = (typeof STATES)[number]

type StateAttrs = {
  'data-state'?: 'hover' | 'focus' | 'active'
  disabled?: boolean
  'aria-disabled'?: boolean
  'aria-busy'?: boolean
  'aria-invalid'?: boolean
}

/** Atributos que ponen un control de formulario en un estado. */
export function at(st: St): StateAttrs {
  switch (st) {
    case 'hover':         return { 'data-state': 'hover' }
    case 'foco':          return { 'data-state': 'focus' }
    case 'activo':        return { 'data-state': 'active' }
    case 'deshabilitado': return { disabled: true }
    case 'cargando':      return { 'aria-busy': true }
    case 'error':         return { 'aria-invalid': true }
    default:              return {}
  }
}

/** Lo mismo para lo que no es un control: una fila, una tarjeta. */
function atDiv(st: St): StateAttrs {
  const a = at(st)
  if (a.disabled) return { 'aria-disabled': true }
  return a
}

/* ── Cues de muestra ────────────────────────────────────────────────────── */

/* La entrevista de la bodega — los mismos cues del boceto B. Contenido real:
   la fila que hay que juzgar es la que trae dos líneas de cuarenta y tantos
   caracteres, no «Lorem ipsum». */
type Qc = 'ok' | 'warn' | 'danger'

export const CUES: {
  n: number; tin: string; tout: string
  es: [string, string]; en: [string, string]
  cps: string; chars: string; qc: Qc
}[] = [
  {
    n: 1, tin: '00:00:03,360', tout: '00:00:08,960',
    es: ['Tienes un sentimiento que las cosas cuestan', 'más a veces de conservar que de enamorarse.'],
    en: ['You get the feeling that sometimes', 'things cost more to hold on to than to fall in love.'],
    cps: '15,5', chars: '43/46', qc: 'ok',
  },
  {
    n: 2, tin: '00:00:16,800', tout: '00:00:19,280',
    es: ['Cuando empecé a trabajar aquí,', 'hace veinticuatro años'],
    en: ['When I started working here,', 'about twenty-four years ago now,'],
    cps: '21,4', chars: '32/46', qc: 'warn',
  },
  {
    n: 3, tin: '00:00:19,480', tout: '00:00:22,600',
    es: ['y vi una filosofía de trabajo, no solo', 'en la viña, sino en lo que es la finca.'],
    en: ['and I saw a whole philosophy of work,', 'not just in the vineyard but the whole estate.'],
    cps: '25,0', chars: '45/46', qc: 'danger',
  },
  {
    n: 4, tin: '00:00:22,880', tout: '00:00:25,440',
    es: ['Aquí se cuida cada cepa', 'como si fuera la única.'],
    en: ['Here every vine is tended', 'as if it were the only one.'],
    cps: '13,2', chars: '27/46', qc: 'ok',
  },
]

type Cue = (typeof CUES)[number]

/** One language at a time, the one whose tab is open: the same table the
 *  editor draws. Editing happens in the cell, and that is the row's active
 *  state — a cue is selected or it is being corrected, nothing in between. */
function CueRow({ c, selected = false, editing = false, busy = false, ...rest }: { c: Cue; selected?: boolean; editing?: boolean; busy?: boolean } & StateAttrs) {
  return (
    <div className="cue" data-qc={c.qc === 'ok' ? undefined : c.qc} aria-selected={selected || undefined} aria-busy={busy || undefined} tabIndex={0} {...rest}>
      <span className="cue-n">{c.n}</span>
      <span className="cue-tc">{c.tin}<br />{c.tout}</span>
      {busy
        ? <div className="cue-text"><span className="skeleton" style={{ width: '70%' }} /><span className="skeleton" style={{ width: '85%' }} /></div>
        : editing
          ? <div className="cue-text" data-active=""><textarea className="cue-edit" defaultValue={c.es.join('\n')} wrap="off" aria-label="Texto del cue" readOnly /></div>
          : <div className="cue-text"><div>{c.es[0]}</div><div>{c.es[1]}</div></div>}
      <span className="cue-stat">{busy ? '—' : c.cps}</span>
      <span className="cue-stat">{busy ? '—' : c.chars}</span>
    </div>
  )
}

/** The header is the tab strip, so the languages never scroll away. */
function CueHead() {
  return (
    <div className="cue-tabs">
      <span className="cue-n">#</span>
      <span>in · out</span>
      <div className="tabs" role="tablist" aria-label="Idiomas">
        <button className="tab" role="tab" aria-selected="true"><span>Original</span><span className="tab-dot" /></button>
        <button className="tab" role="tab" aria-selected="false" data-qc="warn"><span>EN</span><span className="tab-dot" /><span className="tab-x" role="button" tabIndex={-1} aria-label="Quitar EN">×</span></button>
      </div>
      <span className="cue-stat">cps</span>
      <span className="cue-stat">car</span>
    </div>
  )
}

/** La fila 1 va seleccionada a propósito, pegada a la fila 2 con aviso: si las
 *  dos se parecen, el acento no ha cedido. */
export function CueTable({ className = '' }: { className?: string }) {
  return (
    <div className={`cues ${className}`} style={{ '--cols': '36px 116px minmax(0, 1fr) 52px 56px' } as CSSProperties}>
      <CueHead />
      {CUES.map(c => <CueRow key={c.n} c={c} selected={c.n === 1} />)}
    </div>
  )
}

/* ── La rejilla de estados ──────────────────────────────────────────────── */

function Grid({ title, note, na = {}, wide = false, children }: {
  title: string
  note: ReactNode
  na?: Partial<Record<St, string>>
  wide?: boolean
  children: (st: St) => ReactNode
}) {
  return (
    <section className={s.section}>
      <div>
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      <div className={wide ? s.wide : s.grid7}>
        {STATES.map(st => (
          <div key={st} className={s.cell}>
            <span className={s.cellHead}>{st}</span>
            {na[st] ? <span className={s.na}>— {na[st]}</span> : children(st)}
          </div>
        ))}
      </div>
    </section>
  )
}

const Sk = ({ w }: { w: string }) => <span className="skeleton" style={{ width: w }} />

/* ── Las piezas ─────────────────────────────────────────────────────────── */

export function Pieces() {
  return (
    <>
      <Grid
        title="Botón"
        note={<>Cuatro variantes, dos alturas y el de solo icono. El primario es el único con el acento como relleno: hay uno por superficie, o ninguno. El atajo va escrito dentro. Cargando, el texto se vuelve invisible en vez de desaparecer: el botón no cambia de anchura.</>}
        na={{ error: 'un botón no falla; falla el formulario, y lo dice el campo o el aviso' }}
      >
        {st => (
          <div className={s.stack}>
            <button className="btn" {...at(st)}>Retraducir <span className="kbd">⌘R</span></button>
            <button className="btn btn-primary" {...at(st)}>Exportar SRT <span className="kbd">⌘E</span></button>
            <button className="btn btn-danger" {...at(st)}>Borrar cue</button>
            <button className="btn btn-quiet" {...at(st)}>Cancelar</button>
            <button className="btn btn-lg btn-primary" {...at(st)}>Empezar gratis</button>
            <button className="btn btn-quiet btn-icon" aria-label="Cerrar" {...at(st)}>×</button>
          </div>
        )}
      </Grid>

      <Grid
        title="Campo"
        note={<>Borde que se afirma al pasar el ratón, anillo neutro con foco, rojo solo si hay error — y el error dice qué pasa y qué hacer. Nada por debajo lleva icono: la ayuda es una línea de texto.</>}
        na={{ activo: 'es el foco', cargando: 'un campo no carga; carga el formulario, y lo dice el botón' }}
      >
        {st => (
          <div className={s.stackWide}>
            <label className="caps" htmlFor={`f-${st}`}>Nombre del proyecto</label>
            <input id={`f-${st}`} className="field" defaultValue="Documental Groenlandia — EP03" {...at(st)} />
            {st === 'error'
              ? <div className="field-msg err">Ya hay un proyecto con ese nombre. Cámbialo o abre el que existe.</div>
              : <div className="field-msg">Se ve en el panel y en el nombre del archivo exportado.</div>}
          </div>
        )}
      </Grid>

      <Grid
        title="Desplegable"
        note={<>Un campo con una punta de flecha que dibuja el envoltorio, porque una imagen de fondo no puede leer el tema.</>}
        na={{ activo: 'es el foco', cargando: 'como el campo' }}
      >
        {st => (
          <div className={s.stackWide}>
            <label className="caps" htmlFor={`s-${st}`}>Idioma de destino</label>
            <div className="select-wrap">
              <select id={`s-${st}`} className="field" defaultValue="en" {...at(st)}>
                <option value="en">Inglés</option>
                <option value="fr">Francés</option>
                <option value="de">Alemán</option>
              </select>
            </div>
            {st === 'error' && <div className="field-msg err">Elige al menos un idioma para traducir.</div>}
          </div>
        )}
      </Grid>

      <Grid
        title="Pestañas de idioma"
        note={<>Pestañas de fichero: la activa se funde con la tabla, las demás van hundidas. Un idioma que se traduce lleva un punto que gira; uno con fallos, un punto ámbar o rojo. La cruz solo aparece al pasar el ratón o en la activa. Comparando, una pestaña se pliega a una tira de 28 px y vuelve al pulsarla.</>}
      >
        {st => (
          <div className="tabs" role="tablist">
            <button className="tab" role="tab" aria-selected={st !== 'activo'}><span>ES · original</span></button>
            <button className="tab" role="tab" {...(st === 'error' ? { 'data-qc': 'danger' } : st === 'activo' ? { 'aria-selected': true } : at(st))}>
              <span>EN</span><span className="tab-dot" /><span className="tab-x">×</span>
            </button>
            <button className="tab" role="tab"><span>FR</span><span className="tab-dot" /><span className="tab-fold" role="button" tabIndex={-1} aria-label="Plegar FR">‹</span></button>
            <button className="tab" data-folded="" aria-label="Desplegar DE"><span>DE</span></button>
          </div>
        )}
      </Grid>

      <Grid
        title="Fila de lista"
        note={<>Un miembro del equipo, un comentario, una invitación, un proyecto en el panel. Lo que hay a la derecha —atajo, distintivo, botón— se alinea solo.</>}
        wide
      >
        {st => (
          <div className="row" tabIndex={0} {...atDiv(st)}>
            {st === 'cargando'
              ? <><span className="skeleton skeleton-circle" /><Sk w="120px" /><Sk w="60px" /></>
              : <>
                  <span className={s.avatar}>MR</span>
                  <span>Marta Rivas</span>
                  <span className="muted">revisora · invitada hace 2 días</span>
                  {st === 'error'
                    ? <><span className="err">No se pudo enviar la invitación</span><button className="btn btn-quiet">Copiar enlace</button></>
                    : <span className="kbd">⏎</span>}
                </>}
          </div>
        )}
      </Grid>

      <Grid
        title="Fila de cue"
        note={<>Altura fija de 56 px. Seleccionada, neutra; corrigiendo, el texto se edita en su sitio; con aviso, un tick ámbar en el margen y la cifra en ámbar; con error, en rojo. Cargando, la traducción se convierte en esqueleto y la fila sigue midiendo lo mismo.</>}
        na={{ deshabilitado: 'no hay cues deshabilitados: se editan o no existen' }}
        wide
      >
        {st => (
          <div className="cues">
            {st === 'error'
              ? <CueRow c={CUES[2]} />
              : <CueRow c={CUES[0]} selected={st === 'activo'} editing={st === 'activo'} busy={st === 'cargando'} {...(st === 'activo' ? {} : atDiv(st))} />}
          </div>
        )}
      </Grid>

      <Grid
        title="Panel de diálogo"
        note={<>Alto en la pantalla, no centrado: cada diálogo trata de algo que hay detrás, y tapar el centro del editor esconde justo lo que se discute. Detrás, el velo: lo que hay debajo se ve, apagado. El primario, a la derecha; lo que no compromete, a la izquierda.</>}
        na={{ hover: 'un diálogo no se pasa por encima; sus botones sí', foco: 'el foco entra en el primer campo', activo: 'abierto es su único estado', deshabilitado: 'se cierra, no se deshabilita' }}
        wide
      >
        {st => (
          <div className={`overlay ${s.scrim}`}>
          <div className="panel" style={{ '--panel-w': '460px', maxHeight: 'none' } as CSSProperties} aria-busy={st === 'cargando' || undefined}>
            <div className="panel-head">
              <span className="panel-title">Invitar a un compañero</span>
              <button className="btn btn-quiet btn-icon panel-close" aria-label="Cerrar">×</button>
            </div>
            <div className="panel-body">
              {st === 'cargando'
                ? <div className={s.stackWide}><Sk w="40%" /><Sk w="100%" /><Sk w="55%" /></div>
                : <div className={s.stackWide}>
                    <label className="caps" htmlFor={`p-${st}`}>Correo</label>
                    <input id={`p-${st}`} className="field" defaultValue="marta@productora.es" />
                    <div className="field-msg">Recibirá un enlace que caduca en siete días.</div>
                  </div>}
            </div>
            <div className="panel-foot">
              {st === 'error'
                ? <><span className="err">El correo no salió. El enlace copiable sí funciona.</span><button className="btn">Copiar enlace</button></>
                : <><button className="btn btn-quiet">Cancelar</button><button className="btn btn-primary" aria-busy={st === 'cargando' || undefined}>Invitar</button></>}
            </div>
          </div>
          </div>
        )}
      </Grid>

      <Grid
        title="Paleta de comandos"
        note={<>La superficie principal de acción, y lo dice el propio campo. Es el índice completo de lo que Captio sabe hacer: por eso la pantalla puede estar callada sin que nadie dude de lo que hay dentro. Cada acción lleva su atajo al lado.</>}
        na={{ hover: 'dentro: una fila con el ratón encima', foco: 'el foco vive en el campo', activo: 'dentro: la fila seleccionada', deshabilitado: 'no existe' }}
        wide
      >
        {st => (
          <div className="palette">
            <input className="palette-input" placeholder="Cue, timecode o acción…" defaultValue={st === 'cargando' ? 'retrad' : st === 'error' ? 'xq' : ''} readOnly />
            <div className="palette-list">
              {st === 'cargando'
                ? <div className={s.stackWide} style={{ padding: 8 }}><Sk w="60%" /><Sk w="45%" /><Sk w="70%" /></div>
                : st === 'error'
                  // A search with no answer is not an error: it is the empty
                  // state, and it says so in the list's own words.
                  ? <div className="palette-empty">Nada para «xq».</div>
                  : <>
                    <span className="caps palette-group">Acciones</span>
                    <div className="palette-item" data-state="hover"><span className="palette-label">Retraducir el cue</span><span className="muted">EN</span><span className="kbd">⌘R</span></div>
                    <div className="palette-item" aria-selected="true"><span className="palette-label">Partir el cue por el salto de línea</span><span className="kbd">⌘⏎</span></div>
                    <div className="palette-item"><span className="palette-label">Exportar SRT</span><span className="kbd">⌘E</span></div>
                    <span className="caps palette-group">Cues</span>
                    <div className="palette-item"><span className="palette-label">El hielo se rompe antes de que amanezca.</span><span className="muted">#142 · 00:08:14,320</span></div>
                  </>}
            </div>
            <div className="palette-foot"><span>↑↓ moverse</span><span>⏎ ejecutar</span><span>esc cerrar</span></div>
          </div>
        )}
      </Grid>

      <Grid
        title="Distintivo de comentario"
        note={<>Una línea con un hilo lo dice en reposo. Sin leer, en tinta; leído, en gris; resuelto, en verde. Nunca en ámbar: el ámbar es del control de calidad.</>}
        na={{ cargando: 'no carga: está o no está', error: 'un hilo no falla' }}
      >
        {st => (
          <div className={s.stack}>
            <button className="badge" data-unread="true" {...at(st)}>2 sin leer</button>
            <button className="badge" {...at(st)}>3</button>
            <button className="badge" data-resolved="true" {...at(st)}>resuelto</button>
          </div>
        )}
      </Grid>

      <Grid
        title="Medidor de cuota"
        note={<>Una barra, no un porcentaje: «has usado el 68 %» es una cuenta que hacer; una barra a dos tercios es un vistazo. Ámbar por debajo del 20 %, rojo a cero; cargando, rayas que se mueven.</>}
        na={{ hover: 'no se toca', foco: 'no se toca', activo: 'no se toca', deshabilitado: 'no se toca' }}
      >
        {st => (
          <div className={s.stackWide}>
            <div className={s.meterRow}><span className="caps">Material</span><span className={s.meterVal}>{st === 'error' ? '0 min' : st === 'cargando' ? '…' : '18 de 30 min'}</span></div>
            <div className="meter" aria-busy={st === 'cargando' || undefined}>
              <div className={`meter-fill ${st === 'error' ? 'none' : ''}`} style={{ width: st === 'error' ? '100%' : '59%' }} />
            </div>
            {st === 'reposo' && <div className="meter"><div className="meter-fill low" style={{ width: '14%' }} /></div>}
          </div>
        )}
      </Grid>

      <Grid
        title="Menú"
        note={<>Filas de la misma altura que un botón, atajos a la derecha, separadores finos. Lo destructivo en rojo, y solo se enciende al pasar por encima. Lo marcable lleva su marca delante, y hueco cuando no.</>}
        na={{ cargando: 'no carga', error: 'no falla' }}
        wide
      >
        {st => (
          <div className="menu" role="menu">
            <span className="caps">Este cue</span>
            <button className="menu-item" role="menuitem">Retraducir<span className="kbd">⌘R</span></button>
            <button className="menu-item" role="menuitem" {...at(st)}>Partir por el salto<span className="kbd">⌘⏎</span></button>
            <button className="menu-item" role="menuitem" disabled>Unir con el siguiente<span className="kbd">⌘J</span></button>
            <div className="menu-sep" />
            <button className="menu-item" role="menuitemcheckbox" aria-checked="true">Seguir el cabezal</button>
            <button className="menu-item" role="menuitemcheckbox" aria-checked="false">Imantar al cambio de plano</button>
            <div className="menu-sep" />
            <button className="menu-item danger" role="menuitem">Borrar cue<span className="kbd">⌫</span></button>
          </div>
        )}
      </Grid>

      <Grid
        title="Barra superior"
        note={<>La marca, un separador y las migas: dónde estás, en tinta apagada, y lo último en tinta. A la derecha, lo que la pantalla necesita a mano —en el editor, guardar y la cuenta. 44 px en todas las pantallas, incluida la del cliente.</>}
        na={{ hover: 'la barra no; las migas se subrayan', foco: 'va a sus piezas', activo: 'no', deshabilitado: 'no', error: 'lo dice la pieza que falla, no la barra' }}
        wide
      >
        {st => (
          <header className="topbar">
            <a href="#" className="brand" onClick={e => e.preventDefault()}>captio</a>
            <span className="topbar-sep" />
            <nav className="crumbs" aria-label="Dónde estás"><a href="#" onClick={e => e.preventDefault()}>Proyectos</a><span>/</span><a href="#" onClick={e => e.preventDefault()}>Documental Groenlandia — EP03</a><span>/</span><span>Rollo 2</span></nav>
            <span className={s.grow} />
            <button className="btn" aria-busy={st === 'cargando' || undefined}>Guardar <span className="kbd">⌘S</span></button>
            <span className="muted">{st === 'cargando' ? 'guardando…' : 'guardado 12:04'}</span>
          </header>
        )}
      </Grid>

      <Grid
        title="Tarjeta"
        note={<>Un bloque con borde en la superficie de trabajo: un plan, un enlace de revisión, un paso de la landing. Cabecera en negrita con su aclaración al lado, y el cuerpo debajo. Nada más: la tarjeta no tiene estados, los tiene lo que lleva dentro.</>}
        na={{ hover: 'no', foco: 'no', activo: 'no', deshabilitado: 'no', cargando: 'cargando es el esqueleto', error: 'lo dice su contenido' }}
        wide
      >
        {() => (
          <div className="card">
            <div className="card-head"><h3>Revisión del cliente</h3><span className="muted">caduca el 18/10/2026</span></div>
            <p>Un enlace abre todas las secuencias de este proyecto a quien lo tenga. Puede corregir el texto y comentar; no puede tocar los tiempos.</p>
          </div>
        )}
      </Grid>

      <Grid
        title="Ficha"
        note={<>Una ficha que se marca: un idioma rápido, un filtro. En tinta cuando está puesta, para que no compita con el ámbar del control de calidad. Mono y pequeña: es un código, no una palabra.</>}
        na={{ cargando: 'no carga', error: 'no falla' }}
      >
        {st => (
          <div className={s.stack}>
            <div className={s.rowWrap}>
              <button className="chip" aria-pressed={st === 'activo'} {...at(st)}>EN</button>
              <button className="chip">FR</button>
              <button className="chip">DE</button>
            </div>
          </div>
        )}
      </Grid>

      <Grid
        title="Transporte"
        note={<>La barra del vídeo, bajo la tabla: reproducir, el reloj en mono, qué archivo suena y, a la derecha, el zoom de la onda y la carga. Con vídeo, la imagen va a la izquierda con la cue encima; sin él, la barra lo dice y ofrece cargarlo.</>}
        na={{ hover: 'sus botones', foco: 'sus botones', activo: 'reproduciendo: el botón cambia de signo', deshabilitado: 'sin archivo, el zoom y reproducir se apagan' }}
        wide
      >
        {st => (
          <div className="transport">
            <div className="transport-video picture" hidden={st !== 'reposo'}>
              <span className="caption">El hielo se rompe antes de que amanezca.</span>
            </div>
            <div className="transport-main">
            <div className="transport-bar">
              <button className="btn" aria-label="Reproducir" disabled={st === 'error'}>▶</button>
              <span className="transport-clock">00:08:14,320 <span className="muted">/ 00:52:10,000</span></span>
              <span className="kbd">2×</span>
              <span className={st === 'error' ? 'err' : 'muted'}>{st === 'cargando' ? 'Descodificando…' : st === 'error' ? 'Ese archivo no se pudo reproducir' : 'groenlandia-ep03-rollo2.mov'}</span>
              <div className="transport-tools">
                <button className="btn btn-quiet" aria-label="Alejar" disabled={st === 'error'}>−</button>
                <span className="transport-zoom">1.0×</span>
                <button className="btn btn-quiet" aria-label="Acercar" disabled={st === 'error'}>+</button>
                <button className="btn">Cargar vídeo o audio</button>
              </div>
            </div>
            </div>
          </div>
        )}
      </Grid>

      <Grid
        title="La imagen"
        note={<>El vídeo con la cue encima, como la quemaría una emisora: abajo, centrada, blanca sobre sombra. No lee el tema: un subtítulo sobre imagen se lee contra la imagen. En el visor del cliente lleva los controles nativos y la cue sube por encima de su franja.</>}
        na={{ hover: 'los controles nativos', foco: 'los controles nativos', activo: 'reproduciendo', deshabilitado: 'no', cargando: 'el navegador lo dice', error: 'lo dice la barra de transporte' }}
        wide
      >
        {() => (
          <div className="picture player">
            <video muted playsInline aria-label="Sin vídeo: la pieza vacía" />
            <div className="player-caption"><span className="caption">Aquí se cuida cada cepa{'\n'}como si fuera la única.</span></div>
          </div>
        )}
      </Grid>

      <Grid
        title="Estado vacío"
        note={<>Un vacío dice tres cosas: qué falta, por qué, y el único botón que lo arregla. Sin ilustración: la ilustración es lo que se pone cuando no se sabe qué decir.</>}
        na={{ hover: 'no', foco: 'va al botón', activo: 'no', deshabilitado: 'no', cargando: 'cargando es el esqueleto, no el vacío' }}
        wide
      >
        {st => (
          st === 'error'
            ? <div className="empty" data-kind="error"><span className="empty-title">No se pudo cargar el proyecto</span><p>La conexión se cortó a medias. Nada se ha perdido: la última versión guardada está en el servidor.</p><button className="btn">Reintentar</button></div>
            : <div className={s.stackWide}>
                <div className="empty"><span className="empty-title">Ningún proyecto todavía</span><p>Un proyecto es un vídeo o una entrega: sus secuencias, sus idiomas y su glosario. Empieza con el que tengas más a mano.</p><button className="btn btn-primary">Nuevo proyecto <span className="kbd">N</span></button></div>
                <div className="empty"><span className="empty-title">Ningún cue con «permafrost»</span><p>Hay 93 cues en la secuencia y ninguno lo contiene. Prueba en el original: quizá se tradujo de otra forma.</p><button className="btn btn-quiet">Quitar el filtro</button></div>
              </div>
        )}
      </Grid>

      <Grid
        title="Esqueleto"
        note={<>Ocupa el sitio de lo que llega, con la forma de lo que llega: una fila de cue en carga sigue midiendo 56 px, y nada salta cuando aparece el texto. Cuando no hay forma que ocupar —una versión que se abre— gira el punto. Sin movimiento si el sistema lo pide.</>}
        na={{ reposo: 'no existe en reposo', hover: 'no', foco: 'no', activo: 'no', deshabilitado: 'no', error: 'si falla, es el vacío de error' }}
        wide
      >
        {() => (
          <div className={s.stackWide}>
            <div className="row"><Sk w="140px" /><Sk w="80px" /><span className="spinner" aria-label="Cargando" /></div>
            <div className="cues"><CueRow c={CUES[3]} busy /></div>
          </div>
        )}
      </Grid>
    </>
  )
}
