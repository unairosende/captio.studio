import type { Actor } from '../auth/actor.ts'
import type { CommentRow } from '../db/comments.ts'
import { guestRecipients, recentlyCommented, userRecipients } from '../db/recipients.ts'
import { commentEmail, sendMail } from '../email/send.ts'

/**
 * Tell the people in the conversation that somebody said something.
 *
 * Immediate, with a quiet window: the first comment an author leaves on a
 * sequence goes out at once, and their next ones within half an hour do not —
 * whoever opens the first email finds the rest waiting. No queue, no cron; the
 * window is read off the comments that already exist.
 *
 * Never throws and is awaited by the route rather than fired and forgotten: on
 * a serverless platform the process may be frozen the moment the response is
 * sent, and an email that was "about to go" is an email that did not.
 */
export async function notifyComment(input: {
  actor: Actor
  authorName: string
  comment: CommentRow
  sequence: { id: string; name: string }
  projectName: string
}): Promise<void> {
  const { actor, comment, sequence } = input
  try {
    if (await recentlyCommented(actor.orgId, sequence.id, comment)) return

    const [users, guests] = await Promise.all([
      userRecipients(actor.orgId, sequence.id, comment, actor.kind === 'guest' ? actor.linkId : null),
      guestRecipients(actor.orgId, sequence.id, comment),
    ])

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const at = `${sequence.id}?cue=${comment.cue_index}`
    const message = (url: string) =>
      commentEmail({
        authorName: input.authorName,
        projectName: input.projectName,
        sequenceName: sequence.name,
        cueIndex: comment.cue_index,
        lang: comment.lang,
        body: comment.body,
        url,
      })

    await Promise.all([
      ...users.map(u => sendMail({ to: u.email, ...message(`${appUrl}/review/${at}`) })),
      ...guests.map(g => sendMail({ to: g.email, ...message(`${appUrl}/r/${g.token}/${at}`) })),
    ])
  } catch (err) {
    // The comment is saved. A notification that failed is a line in the log,
    // not a reason to tell the author their note did not land.
    console.error('comment notification failed', err)
  }
}
