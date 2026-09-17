'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { cueAt } from '@/lib/subtitles'
import type { Playback } from '@/types/media'
import type { Subtitle } from '@/types/subtitle'

import Caption from './Caption'

/**
 * The picture with the words under it, for people who are not editing.
 *
 * The browser's own controls: a client reviewing a translation gets play,
 * pause and a scrubber they already know, and nothing JKL-shaped to learn. The
 * cue on screen is read off the element every frame while it plays — the
 * `timeupdate` event fires four times a second, which is a quarter-second late
 * for a subtitle — and reported upwards only when it changes, so the sheet can
 * follow along without re-rendering per frame.
 *
 * The element itself is the parent's, through the ref: the sheet seeks it
 * when a row is clicked, and that is the whole of the coupling.
 */
interface Props {
  playback: Playback
  /** The track whose line goes under the picture. */
  cues: Subtitle[]
  videoRef: RefObject<HTMLVideoElement | null>
  onActive?: (index: number | null) => void
}

export default function Player({ playback, cues, videoRef, onActive }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const activeRef = useRef<number | null>(null)
  const [playing, setPlaying] = useState(false)

  const show = useCallback(
    (t: number) => {
      const index = cueAt(cues, t)?.index ?? null
      if (index === activeRef.current) return
      activeRef.current = index
      setActiveIndex(index)
      onActive?.(index)
    },
    [cues, onActive],
  )

  // Follow the clock while it runs; the cleanup stops it on pause and unmount.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const loop = () => {
      const video = videoRef.current
      if (video) show(video.currentTime)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [playing, show, videoRef])

  const active = activeIndex === null ? null : (cues.find(c => c.index === activeIndex) ?? null)

  return (
    <div style={{ position: 'relative', background: '#000', containerType: 'inline-size' }}>
      <video
        ref={videoRef}
        src={playback.url}
        controls
        playsInline
        preload="metadata"
        style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'contain' }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        // A seek while paused still moves the line under the picture.
        onSeeked={e => show(e.currentTarget.currentTime)}
      />
      {/* Above the native controls' strip — a fixed height, not a share of a player that may be small. */}
      <div style={{ position: 'absolute', inset: '0 0 56px 0', pointerEvents: 'none' }}>
        <Caption text={active?.text} />
      </div>
    </div>
  )
}
