/**
 * JKL, the transport every editor's hands already know.
 *
 * J runs back, K stops, L runs forward, and pressing the same key again goes
 * faster. It is muscle memory from Avid and Premiere, which is the whole
 * argument for it: a subtitler arrives already able to use it.
 *
 * The fiddly part is the speed ladder, and it is fiddly in a way that stays
 * invisible until it annoys somebody — a window too short and repeated presses
 * never accelerate, too long and a press an age later unexpectedly doubles.
 */

/** Beyond this the picture is a blur and the audio is a chipmunk. */
export const MAX_SPEED = 16

/** Presses further apart than this are separate intentions, not a repeat. */
export const REPEAT_WINDOW_MS = 500

export type Direction = 1 | -1

export interface Transport {
  direction: Direction
  speed: number
  /** When the key was pressed, for judging the next one. */
  at: number
}

/**
 * What the next press of J or L produces.
 *
 * Reversing direction always drops back to normal speed. Somebody running
 * forward at 8x who presses J wants to go back and look at something, not to
 * fly backwards past it at 8x.
 */
export function nextTransport(
  previous: Transport | null,
  direction: Direction,
  now: number,
): Transport {
  const repeat =
    previous !== null && previous.direction === direction && now - previous.at < REPEAT_WINDOW_MS

  return {
    direction,
    speed: repeat ? Math.min(MAX_SPEED, previous.speed * 2) : 1,
    at: now,
  }
}

/** How the speed reads in the toolbar: `1×`, not `1.0×`. */
export function speedLabel(transport: Transport | null): string {
  if (!transport) return '1×'
  return `${transport.direction < 0 ? '−' : ''}${transport.speed}×`
}
