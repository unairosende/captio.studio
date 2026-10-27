/**
 * Who may open an account on this deployment.
 *
 * Anybody, on the product that is sold. On a private copy only somebody
 * already invited — the team panel is how people arrive there — plus the
 * addresses or domains in SIGNUP_ALLOW, because the first owner has nobody
 * to invite them. Public because the sign-up page words itself by it.
 *
 * Pure on purpose: the client pages import this, so the database question it
 * cannot answer is asked by the hook in server.ts.
 */
export const INVITE_ONLY = process.env.NEXT_PUBLIC_SIGNUP === 'invite'

/**
 * The code a refused sign-up carries, and the `?error=` it comes back with.
 *
 * Doubles as the message because the OAuth callback forwards only the message,
 * so a refusal on Google's path and one on the form can be told apart by the
 * same string.
 */
export const SIGNUP_CLOSED = 'SIGNUP_CLOSED'

export const SIGNUP_CLOSED_MESSAGE =
  'Aquí solo se entra con invitación. Crea la cuenta con la dirección a la que te llegó.'

/** Whether an address is on a comma-separated list of addresses and domains. */
export function onAllowList(email: string, list: string): boolean {
  const address = email.trim().toLowerCase()
  const domain = address.slice(address.lastIndexOf('@') + 1)

  return list
    .split(',')
    .map(entry => entry.trim().toLowerCase().replace(/^@/, ''))
    .some(entry => entry !== '' && (entry === address || entry === domain))
}
