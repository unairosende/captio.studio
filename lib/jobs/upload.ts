import { api, must } from '../api.ts'
import { decodeAudio } from '../audio/decode.ts'
import { MAX_UPLOAD_BYTES } from '../upload.ts'

/**
 * A recording into the bucket, from the browser.
 *
 * Moved out of the editor's Transcribir step unchanged, because the project
 * assistant uploads the same way: the whole file, so it plays back from the
 * bucket later — unless it is a master that would not fit, in which case the
 * audio alone goes, and playback stays local to the session that loaded it.
 * Straight to object storage either way: routing the bytes through our own
 * API would cap the file at the platform's request-body limit.
 */

export interface UploadMeta {
  /** What the file is, as the player was told — see mediaType in lib/audio/decode.ts. */
  contentType: string
  /** Read off the file when it was decoded; absent when it would not decode. */
  durationSeconds?: number | null
  peaks?: number[]
}

export interface UploadStage {
  message: string
  progress: number
}

export async function uploadMedia(
  file: File,
  meta: UploadMeta,
  hooks: {
    onStage: (stage: UploadStage) => void
    /**
     * The upload's id, as soon as the server has granted it and before the
     * bytes go. The editor remembers it there: the save attaches it to the
     * sequence, and a translation names it as the material it belongs to.
     */
    onGrant?: (mediaId: string) => void
  },
): Promise<string> {
  const isVideo = meta.contentType.startsWith('video/')

  let upload: Blob = file
  let uploadName = file.name
  let uploadType = meta.contentType
  if (file.size > MAX_UPLOAD_BYTES) {
    hooks.onStage({ message: 'Demasiado grande para subir entero — extrayendo el audio…', progress: 40 })
    // Decoded again rather than held since loading: a feature's samples
    // kept in memory for a transcription nobody may ask for is the wrong
    // way round, and only a master this size needs them twice.
    const decoded = await decodeAudio(file)
    if (!decoded) throw new Error('El archivo pasa de 1 GB y no se pudo extraer el audio para subirlo')
    upload = new Blob([audioBufferToWav(decoded.buffer)], { type: 'audio/wav' })
    uploadName = file.name.replace(/\.[^.]+$/, '.wav')
    uploadType = 'audio/wav'
  }

  hooks.onStage({ message: isVideo && upload === file ? 'Subiendo el vídeo…' : 'Subiendo el audio…', progress: 55 })

  const grant = await must('/api/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: uploadName,
      contentType: uploadType,
      bytes: upload.size,
      durationSeconds: meta.durationSeconds ?? undefined,
      peaks: meta.peaks?.length ? meta.peaks : undefined,
    }),
  })
  const mediaId = grant.mediaId as string
  hooks.onGrant?.(mediaId)

  const put = await api(grant.uploadUrl as string, {
    method: 'PUT',
    body: upload,
    headers: { 'Content-Type': uploadType },
  })
  if (!put.ok) throw new Error(put.status ? `La subida falló (HTTP ${put.status})` : put.error)

  return mediaId
}

/** 16-bit mono PCM of the first channel, for a master too big to upload whole. */
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const samples    = buffer.getChannelData(0)
  const dataLength = samples.length * 2
  const wav        = new ArrayBuffer(44 + dataLength)
  const v          = new DataView(wav)
  const ws  = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  const w32 = (off: number, n: number) => v.setUint32(off, n, true)
  const w16 = (off: number, n: number) => v.setUint16(off, n, true)
  ws(0, 'RIFF'); w32(4, 36 + dataLength); ws(8, 'WAVE')
  ws(12, 'fmt '); w32(16, 16); w16(20, 1); w16(22, 1)
  w32(24, buffer.sampleRate); w32(28, buffer.sampleRate * 2); w16(32, 2); w16(34, 16)
  ws(36, 'data'); w32(40, dataLength)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2
  }
  return wav
}
