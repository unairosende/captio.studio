import { Resend } from 'resend'

import { RESET_EXPIRY_HOURS } from '../auth/expiry.ts'

/**
 * Transactional email.
 *
 * Lazily constructed so that importing this module during a build, or in a test,
 * does not require the API key to exist.
 */
let client: Resend | null = null

function resend(): Resend {
  if (!client) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY is not set')
    client = new Resend(key)
  }
  return client
}

export interface Mail {
  to: string
  subject: string
  html: string
  text: string
}

/**
 * Send one message.
 *
 * Returns whether it went out rather than throwing: the invitation row is
 * already written by the time this runs, and a mail provider being down should
 * not roll back the invitation — the link can always be copied by hand.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const from = process.env.EMAIL_FROM
  if (!from || !process.env.RESEND_API_KEY) {
    // Outside production, print the message instead of sending it. Signing up
    // requires a verified address, so with no mail provider configured a
    // developer could not create a single account. Never in production: these
    // bodies carry verification and password-reset links, and a log is not a
    // private enough place to keep them.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[mail:dev] to ${mail.to} — ${mail.subject}\n${mail.text}`)
      return true
    }
    console.error('mail is not configured; not sending', mail.subject)
    return false
  }

  try {
    const { error } = await resend().emails.send({
      from,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    })
    if (error) {
      console.error('resend refused the message', error)
      return false
    }
    return true
  } catch (err) {
    console.error('resend request failed', err)
    return false
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The app's accent, written out.
 *
 * Mail clients have no custom properties, so `--accent` cannot reach here. The
 * literal at least sits next to the only markup that uses it, which is as close
 * to one source as an email template gets.
 */
const ACCENT = '#5b7cf6'

/** Shared shell so every message looks like it came from the same product. */
function layout(heading: string, body: string, cta?: { url: string; label: string }): string {
  return `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#111">
  <h1 style="font-size:20px;font-weight:600;margin:0 0 16px">${heading}</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 24px">${body}</p>
  ${
    cta
      ? `<p style="margin:0 0 24px">
    <a href="${cta.url}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px">
      ${cta.label}
    </a>
  </p>`
      : ''
  }
  <p style="font-size:13px;line-height:1.6;color:#666;margin:0">
    Si no esperabas este correo, puedes ignorarlo.
  </p>
</div>`.trim()
}

export function verificationEmail(url: string): Omit<Mail, 'to'> {
  return {
    subject: 'Confirma tu correo en captio',
    text: `Confirma tu correo para activar tu cuenta de captio:\n\n${url}\n\nSi no esperabas este correo, puedes ignorarlo.`,
    html: layout('Confirma tu correo', 'Un último paso para activar tu cuenta de captio.', {
      url: esc(url),
      label: 'Confirmar correo',
    }),
  }
}

export function resetPasswordEmail(url: string): Omit<Mail, 'to'> {
  // Said out loud because these are read hours later, on a phone, on the way
  // somewhere. Somebody who knows the link is short-lived opens it now; somebody
  // who does not blames the product when it has quietly gone stale.
  const lifespan =
    RESET_EXPIRY_HOURS === 1 ? 'El enlace caduca en una hora.' : `El enlace caduca en ${RESET_EXPIRY_HOURS} horas.`

  return {
    subject: 'Restablecer tu contraseña de captio',
    text: `Alguien pidió restablecer la contraseña de esta cuenta:\n\n${url}\n\n${lifespan}\n\nSi no fuiste tú, ignora este correo: tu contraseña no cambia hasta que se use el enlace.`,
    html: layout(
      'Restablecer tu contraseña',
      `Alguien pidió restablecer la contraseña de esta cuenta. ${lifespan} Si no fuiste tú, ignora este correo: la contraseña no cambia hasta que se use el enlace.`,
      { url: esc(url), label: 'Elegir nueva contraseña' },
    ),
  }
}

/**
 * Invitation to join an organisation.
 *
 * Organisation and inviter names are user input, so they are escaped before
 * going anywhere near the HTML body.
 */
export function invitationEmail(input: {
  organizationName: string
  inviterName: string
  acceptUrl: string
}): Omit<Mail, 'to'> {
  const org = esc(input.organizationName)
  const who = esc(input.inviterName)
  const url = esc(input.acceptUrl)

  return {
    subject: `${input.inviterName} te invita a ${input.organizationName} en captio`,
    text: [
      `${input.inviterName} te ha invitado a unirte a ${input.organizationName} en captio.`,
      '',
      `Acepta la invitación aquí: ${input.acceptUrl}`,
      '',
      'Si no esperabas este correo, puedes ignorarlo.',
    ].join('\n'),
    html: layout(
      `Te han invitado a ${org}`,
      `${who} te ha invitado a unirte a <strong>${org}</strong> en captio.`,
      { url, label: 'Aceptar invitación' },
    ),
  }
}
