'use client'

import { useEffect, useState } from 'react'

import { CueTable, Pieces } from './pieces'
import s from './styleguide.module.css'

/**
 * Las fundaciones del rediseño, pintadas.
 *
 * Fase 03: los tokens de app/tokens.css puestos sobre una superficie real para
 * que se vean antes de que ninguna pantalla los use. Es la referencia contra la
 * que se revisará todo lo demás: si algo no está aquí, no existe.
 *
 * La letra se eligió aquí mismo: dos candidatas sobre la misma fila de cue,
 * Plex frente a Geist, mirando la fila y no los nombres. Ganó Geist.
 */

type Theme = 'light' | 'system' | 'dark'

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Claro' },
  { id: 'system', label: 'Sistema' },
  { id: 'dark', label: 'Oscuro' },
]

const SCALE = [
  ['xs', '11'], ['sm', '12'], ['md', '13'], ['lg', '15'], ['xl', '18'], ['2xl', '24'],
] as const

function TypeScale() {
  return (
    <div className={s.scale}>
      {SCALE.map(([k, px]) => (
        <div key={k}>
          <span style={{ fontSize: `var(--fs-${k})`, lineHeight: 1.2 }}>Cepa</span>
          <small>{k} · {px}</small>
        </div>
      ))}
    </div>
  )
}

export default function StyleguidePage() {
  const [theme, setTheme] = useState<Theme>('system')

  // El tema es un atributo de <html>, fuera de React: se sincroniza desde un
  // efecto, que es lo que un efecto es para. Sin atributo, manda el sistema.
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    return () => root.removeAttribute('data-theme')
  }, [theme])

  return (
    <div className={s.page}>
      <header className={s.bar}>
        <span className={s.brand}>CAPTIO</span>
        <span className={s.crumb}>Fundaciones y piezas · fases 03 y 04</span>
        <div className={s.seg} role="group" aria-label="Tema">
          {THEMES.map(t => (
            <button key={t.id} className={s.segBtn} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className={s.main}>

        <section className={s.section}>
          <div>
            <h2>Superficies</h2>
            <p>Una escala, no unos roles. <code>s0</code> es el extremo: la única superficie
            blanca a la vez, el área en la que se trabaja. El resto es cromo, y se retira.</p>
          </div>
          <div className={s.surfaces}>
            <div className={s.surface} style={{ background: 'var(--s0)' }}><span className={s.label}>s0</span><small>trabajo</small></div>
            <div className={s.surface} style={{ background: 'var(--s1)' }}><span className={s.label}>s1</span><small>cromo</small></div>
            <div className={s.surface} style={{ background: 'var(--s2)' }}><span className={s.label}>s2</span><small>anidado</small></div>
            <div className={s.surface} style={{ background: 'var(--s3)' }}><span className={s.label}>s3</span><small>hundido</small></div>
            <div className={`${s.surface} ${s.lifted}`}><span className={s.label}>raised</span><small>encima</small></div>
          </div>
        </section>

        <section className={s.section}>
          <div>
            <h2>Tinta y líneas</h2>
            <p>Tres tintas. Bordes, lavados y anillo de foco se derivan de la tinta con
            <code> color-mix</code>: nunca un gris elegido a mano que luego no casa con el
            texto de al lado.</p>
          </div>
          <div className={s.inks}>
            <div className={s.inkCard} style={{ background: 'var(--s0)' }}>
              <div className={s.inkLine}><span style={{ color: 'var(--ink)' }}>Reserva de la Familia</span><small className={s.label}>ink</small></div>
              <div className={s.inkLine}><span style={{ color: 'var(--ink-2)' }}>Reserva de la Familia</span><small className={s.label}>ink-2</small></div>
              <div className={s.inkLine}><span style={{ color: 'var(--ink-3)' }}>Reserva de la Familia</span><small className={s.label}>ink-3</small></div>
              <div className={s.rule} /><div className={s.rule2} />
              <div className={s.washes}>
                <div className={`${s.wash} ${s.washHover}`}><span>ratón encima</span><span className={s.label}>hover · 4 %</span></div>
                <div className={`${s.wash} ${s.washSelect}`}><span>seleccionado</span><span className={s.label}>select · 8 %</span></div>
              </div>
            </div>
            <div className={s.inkCard} style={{ background: 'var(--s1)' }}>
              <div className={s.inkLine}><span style={{ color: 'var(--ink)' }}>Reserva de la Familia</span><small className={s.label}>ink</small></div>
              <div className={s.inkLine}><span style={{ color: 'var(--ink-2)' }}>Reserva de la Familia</span><small className={s.label}>ink-2</small></div>
              <div className={s.inkLine}><span style={{ color: 'var(--ink-3)' }}>Reserva de la Familia</span><small className={s.label}>ink-3</small></div>
              <div className={s.rule} /><div className={s.rule2} />
              <div className={s.washes}>
                <div className={`${s.wash} ${s.washHover}`}><span>ratón encima</span><span className={s.label}>hover · 4 %</span></div>
                <div className={`${s.wash} ${s.washSelect}`}><span>seleccionado</span><span className={s.label}>select · 8 %</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className={s.section}>
          <div>
            <h2>Acento y semánticos</h2>
            <p>El acento vive en la marca, el enlace y el botón primario, y <strong>cede dentro
            del editor</strong>: la fila 1 está seleccionada y es neutra; la 2 tiene un aviso
            y es ámbar. No se parecen, y eso es lo que había que comprobar.</p>
          </div>
          <div>
            <div className={s.accentRow}>
              <button className={s.btnPrimary}>Exportar SRT</button>
              <button className={s.btnQuiet}>Retraducir</button>
              <a className={s.link} href="#acento">Ver el glosario</a>
              <span className={s.label} style={{ marginLeft: 'auto' }}>accent · accent-fill</span>
            </div>
            <div className={s.semantics}>
              <span className={`${s.pill} ${s.ok}`}>13,2 cps</span>
              <span className={`${s.pill} ${s.warn}`}>21,4 cps · sobre 17</span>
              <span className={`${s.pill} ${s.danger}`}>25,0 cps · ilegible</span>
            </div>
            <CueTable />
          </div>
        </section>

        <section className={s.section}>
          <div>
            <h2>Tipografía</h2>
            <p>Geist para la interfaz, Geist Mono para lo que se alinea en columna:
            timecodes, cifras, fichas. Seis tamaños, ninguno por debajo de 11 px. La auditoría
            contó quince, con 10 px como el más usado del editor.</p>
          </div>
          <div className={s.cand}>
            <div className={s.candHead}>
              <h3>Geist + Geist Mono</h3>
              <span className={s.label}>elegida el 14 sep 2026 frente a Plex</span>
            </div>
            <TypeScale />
            <CueTable className={s.candTable} />
          </div>
        </section>

        <section className={s.section}>
          <div>
            <h2>Espacio y forma</h2>
            <p>Rejilla de 4. Tres radios que se distinguen a simple vista: fichas, controles,
            paneles. Una sombra, solo para lo que flota. Dos duraciones, 120 y 180 ms, saliendo
            rápido: lo que aparece encima entra en su sitio, la fila que acaba de ocupar uno lo
            dice un momento, y lo que espera gira. Nada más se mueve; y nada de esto si el
            sistema pide menos movimiento.</p>

          </div>
          <div>
            <div className={s.spaces}>
              {[1, 2, 3, 4, 6, 8].map(n => (
                <div key={n} className={s.space}><div style={{ height: n * 4 }} /><small>sp-{n} · {n * 4}</small></div>
              ))}
            </div>
            <div className={s.shapes}>
              <div className={s.shape}><div className={s.rSm} /><small>r-sm · 2</small></div>
              <div className={s.shape}><div className={s.rMd} /><small>r-md · 4</small></div>
              <div className={s.shape}><div className={s.rLg} /><small>r-lg · 8</small></div>
              <div className={s.shape}><div className={`${s.rLg} ${s.lifted}`} /><small>lift</small></div>
            </div>
          </div>
        </section>

        <div className={s.divider}>
          <span className="caps">Las piezas</span>
          <p>Cada una en sus siete estados. La casilla que no aplica lo dice por escrito;
          la casilla vacía es la que nadie diseñó.</p>
        </div>

        <Pieces />

      </main>
    </div>
  )
}
