import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { commentEmail, sendMail, verificationEmail } from '../../lib/email/send.ts'

/**
 * What happens when no mail provider is configured.
 *
 * Two opposite mistakes are possible here and both are quiet. Failing in
 * development locks a developer out of their own signup flow, because an
 * address has to be verified before an account works. Printing in production
 * puts verification and password-reset links in the log, where they are one
 * `vercel logs` away from anyone with dashboard access.
 */

const TARGET = 'someone@example.test'
const LINK = 'https://captio.studio/verify?token=synthetic-token'

/** Runs `fn` with the given variables applied, capturing what it logs. */
async function run(
  env: Record<string, string | undefined>,
  fn: () => Promise<boolean>,
): Promise<{ sent: boolean; logged: string }> {
  const saved: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  const lines: string[] = []
  const collect = (...args: unknown[]) => void lines.push(args.join(' '))
  const { warn, error } = console
  console.warn = collect
  console.error = collect

  try {
    return { sent: await fn(), logged: lines.join('\n') }
  } finally {
    console.warn = warn
    console.error = error
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const unconfigured = {
  RESEND_API_KEY: undefined,
  EMAIL_FROM: undefined,
}

describe('sendMail without a provider', () => {
  it('prints the link outside production so signup still works', async () => {
    const { sent, logged } = await run(
      { ...unconfigured, NODE_ENV: 'development' },
      () => sendMail({ to: TARGET, ...verificationEmail(LINK) }),
    )

    assert.equal(sent, true, 'development must not report the message as lost')
    assert.ok(logged.includes(LINK), 'the link has to be readable in the output')
    assert.ok(logged.includes(TARGET), 'the recipient has to be readable too')
  })

  it('stays silent about the link in production', async () => {
    const { sent, logged } = await run(
      { ...unconfigured, NODE_ENV: 'production' },
      () => sendMail({ to: TARGET, ...verificationEmail(LINK) }),
    )

    assert.equal(sent, false, 'production must report an unsent message')
    assert.ok(!logged.includes(LINK), 'a verification link must never reach the log')
  })

  it('does not send half-configured', async () => {
    // A key with no From address, or the reverse, is a misconfiguration rather
    // than a deliberate choice; production must refuse it either way.
    for (const half of [
      { RESEND_API_KEY: 'synthetic-key', EMAIL_FROM: undefined },
      { RESEND_API_KEY: undefined, EMAIL_FROM: 'captio <no-reply@example.test>' },
    ]) {
      const { sent } = await run({ ...half, NODE_ENV: 'production' }, () =>
        sendMail({ to: TARGET, ...verificationEmail(LINK) }),
      )
      assert.equal(sent, false)
    }
  })
})

/**
 * The comment email is the first message whose every word may have been typed
 * by a stranger: a client who arrived through a link chooses their own name and
 * writes their own note. Both go into HTML.
 */
describe('commentEmail', () => {
  const mail = commentEmail({
    authorName: '<script>alert(1)</script> Ana',
    projectName: 'Doc & Co',
    sequenceName: 'Reel <1>',
    cueIndex: 12,
    lang: 'Spanish',
    body: 'Too literal.\n"Fix" this <b>now</b>',
    url: 'https://captio.studio/r/tok/seq?cue=12',
  })

  it('escapes everything a person wrote before it reaches the HTML', () => {
    assert.ok(!mail.html.includes('<script>'), 'the name is not markup')
    assert.ok(mail.html.includes('&lt;script&gt;'))
    assert.ok(!mail.html.includes('<b>now</b>'), 'the body is not markup')
    assert.ok(mail.html.includes('&lt;b&gt;now&lt;/b&gt;'))
    assert.ok(mail.html.includes('Doc &amp; Co'))
    assert.ok(mail.html.includes('Reel &lt;1&gt;'))
  })

  it('keeps the line breaks of the note and nothing else', () => {
    assert.ok(mail.html.includes('Too literal.<br>&quot;Fix&quot; this'))
  })

  it('says where, and carries the way back', () => {
    assert.ok(mail.subject.includes('#12 (Spanish)'))
    assert.ok(mail.text.includes('https://captio.studio/r/tok/seq?cue=12'))
    assert.ok(mail.html.includes('href="https://captio.studio/r/tok/seq?cue=12"'))
  })
})
