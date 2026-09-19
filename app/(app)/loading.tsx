import s from './loading.module.css'

/**
 * The instant between asking for a page and getting it.
 *
 * Every page in this group is drawn on the server from the database, and a
 * database that has gone to sleep answers in seconds, not milliseconds.
 * Without this the click did nothing visible for that long — the previous
 * page stayed put and the person clicked again. The bar and three cards are
 * the shape of what is coming, in the place it will appear.
 */
export default function Loading() {
  return (
    <div className={s.page} aria-busy="true" aria-label="Cargando">
      <header className="topbar">
        <span className="brand">captio</span>
      </header>
      <main className={s.main}>
        <div className={s.grid}>
          {[0, 1, 2].map(i => (
            <div key={i} className={`card ${s.card}`}>
              <span className={`skeleton ${s.short}`} />
              <span className={`skeleton ${s.long}`} />
              <span className={`skeleton ${s.mid}`} />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
