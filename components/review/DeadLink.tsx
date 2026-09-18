import s from './review.module.css'

/**
 * A review link that opens nothing.
 *
 * One page for a revoked link, an expired one and one that never existed:
 * saying which would tell a stranger which tokens were once real.
 */
export default function DeadLink() {
  return (
    <div className={`v2 ${s.page} ${s.center}`}>
      <div className={`card ${s.gate}`}>
        <span className="brand">captio</span>
        <div>
          <h1>Este enlace ya no está activo.</h1>
          <p>Pídele otro a quien te lo envió.</p>
        </div>
      </div>
    </div>
  )
}
