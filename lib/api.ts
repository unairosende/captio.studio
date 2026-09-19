/**
 * One way to call our own routes from the browser.
 *
 * `fetch` throws on a network failure and resolves on every HTTP status, so a
 * request written as `const res = await fetch(…)` under a busy flag leaves the
 * flag set for ever the moment the connection drops: the button says it is
 * saving and never saves again. Every call site in the product was written
 * that way. This never throws. A request that never reached the server comes
 * back as status 0 with a sentence that says so, and the caller's own error
 * line prints it like any other refusal.
 *
 * It also says the refusals the server states in English in Spanish, by
 * status, for the three a reader has to act on rather than read: a session
 * that has expired, a thing they may not do, a thing that is gone. The rest
 * carry the server's own words — a 409 is answered by the caller, a 402 names
 * what ran out.
 */

export interface Reply<T> {
  ok: boolean
  /** 0 when the request never reached the server. */
  status: number
  json: T & { error?: string }
  /** What to print when `ok` is false; empty when it is true. */
  error: string
}

export const OFFLINE = 'Sin conexión con el servidor. Comprueba la red y vuelve a intentarlo.'

const BY_STATUS: Record<number, string> = {
  401: 'Tu sesión ha caducado. Entra de nuevo en otra pestaña y vuelve a intentarlo: lo que tienes en pantalla no se pierde.',
  403: 'No tienes permiso para hacer esto. Pídeselo a un propietario o administrador.',
  404: 'Eso ya no existe. Recarga la página.',
}

type Json = Record<string, unknown>

export async function api<T = Json>(url: string, init?: RequestInit): Promise<Reply<T>> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    return { ok: false, status: 0, json: {} as T & { error?: string }, error: OFFLINE }
  }
  // A gateway that gives up answers with an HTML page, and `res.json()` then
  // fails on `<!DOCTYPE`: that is a request cut short, not a broken reply.
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  const error = res.ok
    ? ''
    : (BY_STATUS[res.status] ?? json.error ?? `El servidor respondió ${res.status} sin decir por qué.`)
  return { ok: res.ok, status: res.status, json, error }
}

/** JSON in, JSON out: the header and the encoding written once. */
export function send<T = Json>(url: string, body: unknown, method = 'POST', headers: Record<string, string> = {}): Promise<Reply<T>> {
  return api<T>(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
}

/** The JSON, or an Error carrying the sentence to print — for code that already unwinds with throw. */
export async function must<T = Json>(url: string, init?: RequestInit): Promise<T & { error?: string }> {
  const reply = await api<T>(url, init)
  if (!reply.ok) throw new Error(reply.error)
  return reply.json
}
