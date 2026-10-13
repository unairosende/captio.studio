import AssistantClient from './AssistantClient'

/**
 * A project set up by talking: attach the material, say what is needed.
 *
 * The session and the organisation are checked by app/(app)/layout.tsx. What
 * is decided here is only whether the assistant can run at all — the key is
 * a server secret, so the page is told yes or no and never the key itself.
 */
export default function NewProjectPage() {
  return <AssistantClient configured={Boolean(process.env.ANTHROPIC_API_KEY)} />
}
