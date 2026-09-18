import type { Metadata } from 'next'
import Link from 'next/link'
import type { CSSProperties } from 'react'

import { LEGAL_DOCS, publishedLegalSlugs } from '@/lib/legal'
import { PLANS, TRIAL } from '@/lib/plans'

import s from './landing.module.css'

export const metadata: Metadata = {
  title: 'Captio — subtitulado en una sola ventana',
  description:
    'Transcribe el vídeo, traduce con el glosario del proyecto, comprueba la calidad, revisa con el cliente y exporta a SRT, VTT, ASS o TTML. Para traductores y productoras.',
}

/**
 * The front door.
 *
 * Marketing, so the scale the editor forbids is allowed here — one large
 * headline and room around it — but the pieces are the product's own. Instead
 * of an illustration the page shows the editor's table with a real-looking
 * job in it: what sells a subtitling tool is the subtitling, and the guide's
 * rule for every screen applies to this one too — nothing designed empty or
 * with filler text.
 *
 * Every figure is read from lib/plans.ts, so the promise on this page cannot
 * drift from the limit the API enforces.
 */

/** The legal documents as a Spanish reader names them; the files keep their English titles. */
const LEGAL_LABEL: Record<keyof typeof LEGAL_DOCS, string> = {
  terms: 'Términos',
  privacy: 'Privacidad',
  dpa: 'Encargo de datos',
  subprocessors: 'Subencargados',
}

/** Four cues of one job, with the two states the quality checks paint. */
const SAMPLE: { n: number; tin: string; tout: string; es: string[]; en: string[]; qc?: 'warn' | 'danger' }[] = [
  { n: 41, tin: '00:12:04,120', tout: '00:12:06,880', es: ['El hielo se rompe antes', 'de que amanezca.'], en: ['The ice breaks before dawn.'] },
  { n: 42, tin: '00:12:07,000', tout: '00:12:09,400', es: ['Nadie sale del campamento', 'hasta que Nuka lo diga.'], en: ['Nobody leaves camp', 'until Nuka says so.'] },
  { n: 43, tin: '00:12:09,640', tout: '00:12:11,200', es: ['—¿Y si no vuelve?', '—Vuelve siempre.'], en: ['"And what if he never comes back?"', '"He always comes back, every single time."'], qc: 'danger' },
  { n: 44, tin: '00:12:11,480', tout: '00:12:14,000', es: ['Tres semanas de luz.', 'Después, nada.'], en: ['Three weeks of daylight, and after that', 'nothing at all.'], qc: 'warn' },
]

const STEPS = [
  {
    title: 'Transcribir',
    body: 'Sube el vídeo o el audio. En unos minutos tienes cada cue con sus tiempos sobre la forma de onda, listo para ajustar.',
  },
  {
    title: 'Traducir',
    body: 'A todos los idiomas que necesites, sin tarifa por idioma. El glosario del proyecto vale para todas sus secuencias: los nombres se escriben una vez.',
  },
  {
    title: 'Comprobar',
    body: 'Velocidad de lectura, caracteres por línea y duración, marcados en la fila. Acorta lo que se pasa con un clic y retrotraduce para comprobar lo que no puedes leer.',
  },
  {
    title: 'Revisar con el cliente',
    body: 'Un enlace, sin cuenta. Tu cliente lee todos los idiomas cue a cue junto al vídeo, comenta y corrige sobre el texto. Cada guardado es una versión.',
  },
  {
    title: 'Entregar',
    body: 'SRT, VTT, ASS, TTML o CSV, con los tiempos ajustados al fotograma. El archivo vuelve a Premiere, donde sigue viviendo el vídeo.',
  },
  {
    title: 'En equipo',
    body: `Hasta ${Math.max(...PLANS.map(p => p.seats))} plazas con una cuota mensual compartida. Todo el mundo en la productora ve los mismos proyectos, y el mismo glosario.`,
  },
]

export default async function LandingPage() {
  const legal = await publishedLegalSlugs()
  const cheapest = Math.min(...PLANS.map(p => p.price))

  return (
    <div className={`v2 ${s.page}`}>
      <header className={`topbar ${s.head}`}>
        <Link href="/" className="brand">captio</Link>
        <nav className={s.nav} aria-label="Principal">
          <Link href="/pricing" className="btn btn-quiet">Precios</Link>
          <Link href="/login" className="btn btn-quiet">Entrar</Link>
          <Link href="/signup" className="btn btn-primary">Empezar gratis</Link>
        </nav>
      </header>

      <main className={s.main}>
        <section className={s.hero}>
          <span className="caps">Para traductores y productoras</span>
          <h1>El subtitulado entero, en una sola ventana.</h1>
          <p className={s.lede}>
            Transcribe el vídeo, traduce a los idiomas que haga falta con el glosario del proyecto,
            comprueba la calidad, revísalo con tu cliente y devuelve el archivo a Premiere. Sin Excel,
            sin traductor online, sin pasar cuatro veces por lo mismo.
          </p>
          <div className={s.cta}>
            <Link href="/signup" className="btn btn-primary btn-lg">Empezar gratis</Link>
            <Link href="/pricing" className="btn btn-lg">Ver precios</Link>
          </div>
          <p className={s.fine}>
            {TRIAL.mediaMinutes} minutos de material gratis, sin tarjeta · desde {cheapest} €/mes
          </p>
        </section>

        {/* The editor, as it is: a documentary's reel with the original beside
            the translation, one line over the reading speed and one over the
            limit. Decorative to a screen reader — the page says the same in
            words. */}
        <div className={s.shot} aria-hidden="true">
          <div className={s.shotBar}>
            <span className="brand">captio</span>
            <span className="topbar-sep" />
            <span className="crumbs">
              <span>Proyectos</span>
              <span>/</span>
              <span>Documental Groenlandia — EP03</span>
              <span>/</span>
              <span>Rollo 2</span>
            </span>
            <div className={s.shotEnd}>
              <span className="btn">Guardar <span className="kbd">⌘S</span></span>
              <span className={s.shotSaved}>guardado 12:04</span>
            </div>
          </div>
          <div className="cues" data-view="compare" style={{ '--cols': '36px 116px minmax(0, 1fr) minmax(0, 1fr)' } as CSSProperties}>
            <div className="cue-tabs">
              <span className="cue-n">#</span>
              <span>in · out</span>
              <span className="tab" aria-selected="true"><span>ES · original</span></span>
              <span className="tab"><span>EN</span></span>
            </div>
            {SAMPLE.map(c => (
              <div key={c.n} className="cue" data-qc={c.qc}>
                <span className="cue-n">{c.n}</span>
                <span className="cue-tc">{c.tin}<br />{c.tout}</span>
                <div className="cue-text" data-active="">{c.es.map(l => <div key={l}>{l}</div>)}</div>
                <div className="cue-text" data-qc={c.qc}>{c.en.map(l => <div key={l}>{l}</div>)}</div>
              </div>
            ))}
          </div>
        </div>

        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2>De la transcripción a la entrega, sin cambiar de sitio</h2>
            <p>Lo que hoy se reparte entre Premiere, un Excel, un traductor online y una herramienta de control de calidad.</p>
          </div>
          <div className={s.grid}>
            {STEPS.map((step, i) => (
              <div key={step.title} className={`card ${s.feature}`}>
                <span className="caps">{String(i + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2>Un precio al mes, y todos los idiomas dentro</h2>
            <p>Se paga por el material que se procesa, no por idioma ni por subtítulo. Cuando la cuota se acaba, lo que ya está hecho sigue ahí y sigue exportándose.</p>
          </div>
          <div className={s.plans}>
            <div className="card">
              <span className="caps">Prueba</span>
              <div className={s.price}>0 €</div>
              <p className={s.planLine}>
                {TRIAL.mediaMinutes} minutos de material, sin tarjeta y sin caducidad: una cantidad, no una quincena.
              </p>
            </div>
            {PLANS.map(plan => (
              <div key={plan.id} className="card">
                <span className="caps">{plan.name}</span>
                <div className={s.price}>{plan.price} €<span className={s.per}>/mes</span></div>
                <p className={s.planLine}>
                  {plan.monthlyMediaMinutes / 60} horas de material al mes · {plan.seats} {plan.seats === 1 ? 'plaza' : 'plazas'}
                </p>
              </div>
            ))}
          </div>
          <Link href="/pricing" className="link">Ver los planes con detalle</Link>
        </section>
      </main>

      <footer className={`${s.main} ${s.foot}`}>
        <span className="brand">captio</span>
        <nav className={s.footNav} aria-label="Pie">
          <Link href="/pricing">Precios</Link>
          <Link href="/login">Entrar</Link>
          {legal.map(slug => <Link key={slug} href={`/${slug}`}>{LEGAL_LABEL[slug]}</Link>)}
          <a href="mailto:hello@captio.studio">hello@captio.studio</a>
        </nav>
      </footer>
    </div>
  )
}
