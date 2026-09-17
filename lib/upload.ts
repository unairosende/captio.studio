/**
 * The most one upload may weigh.
 *
 * One number, read by the route that signs the grant and by the browser that
 * decides what to send. A proxy fits; a broadcast master does not, and the
 * browser strips the audio out of it instead — which transcribes as well and
 * plays back not at all. Comfortably under the recogniser's own 2 GB ceiling.
 */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
