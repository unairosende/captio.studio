import type { Metadata } from 'next'

import Shell from '@/components/marketing/Shell'
import m from '@/components/marketing/marketing.module.css'

import Plans from './Plans'

export const metadata: Metadata = {
  title: 'Precios · Captio',
  description:
    'Un precio al mes por el material que procesas, con todos los idiomas incluidos. Prueba gratis sin tarjeta.',
}

/**
 * The prices, stated in the same numbers the API enforces.
 *
 * Every figure on the cards is read from lib/plans.ts, so the promise here
 * cannot drift from the limit lib/entitlement.ts applies. The note under them
 * says what reaching that limit does: a ceiling nobody was told about is the
 * same ambush as one nobody was warned of.
 */
export default function PricingPage() {
  return (
    <Shell>
      <section className={m.intro}>
        <span className="caps">Precios</span>
        <h1>Un precio al mes, y todos los idiomas dentro</h1>
        <p>
          Se paga por el material que se procesa, no por idioma ni por subtítulo. Todos los
          planes incluyen todo lo que Captio hace.
        </p>
      </section>

      <Plans />

      <div className={m.note}>
        <p>
          La cuota mensual vuelve a empezar el primer día de cada mes. Cuando se agota, las
          transcripciones y traducciones nuevas se detienen; tus proyectos se quedan donde están
          y siguen exportándose.
        </p>
        <p>Facturación mensual · Cancela cuando quieras</p>
        <p>
          ¿Dudas? <a href="mailto:hello@captio.studio" className="link">hello@captio.studio</a>
        </p>
      </div>
    </Shell>
  )
}
