import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { organization } from 'better-auth/plugins/organization'

import { db } from '../db/client.ts'
import { firstMembershipForUser } from '../db/organizations.ts'
import {
  invitationEmail,
  resetPasswordEmail,
  sendMail,
  verificationEmail,
} from '../email/send.ts'

/**
 * Authentication and organisations.
 *
 * Better Auth keeps its tables (user, session, account, verification,
 * organization, member, invitation) in our own Postgres rather than in a
 * vendor's. That is the whole point of choosing it: moving off Supabase later is
 * a pg_dump, not an auth migration with re-issued sessions and rehashed
 * passwords.
 */

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * Google is wired only when both halves of the credential exist.
 *
 * The credentials must come from a Google Cloud project owned by the business
 * that invoices customers. Passing a half-configured provider makes Better Auth
 * advertise a login button that fails on click, which is worse than not
 * offering it at all.
 */
const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}

/**
 * Kept as a named object so `db/auth-schema.ts` can hand the exact same options
 * to Better Auth's schema generator. If the generator saw different options
 * from the running app, the migration it produced would not match the tables
 * the app expects.
 */
export const authOptions = {
  database: db(),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? appUrl,

  // Email and password stays on: requiring a Google account would lock out every
  // productora that runs on Microsoft, which is a lot of them.
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({ to: user.email, ...resetPasswordEmail(url) })
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({ to: user.email, ...verificationEmail(url) })
    },
  },

  socialProviders: google,

  /**
   * Every new session starts in the organisation the user belongs to.
   *
   * Without this, signing in a second time produces a session with no active
   * organisation: the membership is still there, but nothing points at it. The
   * app then refuses the editor and bounces to onboarding, which sees the
   * membership and bounces back — a loop with no exit, and one every returning
   * customer would meet rather than an unlucky few.
   *
   * `requireOrgContext` falls back to membership as well, so between them
   * neither a stale session nor a missed hook can produce that deadlock again.
   */
  databaseHooks: {
    session: {
      create: {
        before: async session => ({
          data: {
            ...session,
            activeOrganizationId:
              session.activeOrganizationId ??
              (await firstMembershipForUser(session.userId))?.organizationId ??
              null,
          },
        }),
      },
    },
  },

  plugins: [
    organization({
      // A seat is a paid thing; the ceiling gets raised from the subscription,
      // not from a constant, once billing is wired.
      membershipLimit: 100,
      invitationExpiresIn: 60 * 60 * 24 * 7,
      /**
       * Say so when the message did not go out — in the log, which is as far as
       * it can travel from here.
       *
       * `sendMail` reports failure by returning false rather than throwing, so
       * a mail provider having a bad afternoon cannot undo an invitation that
       * is already in the database. That answer used to be discarded entirely.
       *
       * Throwing does not reach the browser: Better Auth runs this as a
       * background task, catches whatever comes out, and answers 200 to the
       * invite regardless — by design, since the invitation is already written
       * and the response is not waiting on an SMTP round trip. So this is a
       * line in the server log and nothing more, which is worth having and is
       * not worth mistaking for the whole fix.
       *
       * What the person clicking Invite actually gets is the accept link, in
       * the team panel, on every pending invitation — the one delivery route
       * that does not depend on a provider agreeing to send.
       *
       * The message carries no URL on purpose: an invitation link is a
       * credential, and a log is not a private place to keep one.
       */
      sendInvitationEmail: async data => {
        const acceptUrl = `${appUrl}/accept-invitation/${data.id}`
        const sent = await sendMail({
          to: data.email,
          ...invitationEmail({
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name || data.inviter.user.email,
            acceptUrl,
          }),
        })
        if (!sent) throw new Error('INVITATION_EMAIL_FAILED')
      },
    }),

    // Must stay last: it rewrites Set-Cookie headers on the way out, so any
    // plugin registered after it would have its cookies dropped.
    nextCookies(),
  ],
  // `satisfies` rather than a type annotation: it restores the contextual types
  // the callbacks lost when these options moved out of the betterAuth() call,
  // while keeping the literal type that `auth.$Infer` is derived from.
} satisfies BetterAuthOptions

export const auth = betterAuth(authOptions)

export type Session = typeof auth.$Infer.Session
