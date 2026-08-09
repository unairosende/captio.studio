import { createHash, createHmac, randomUUID } from 'node:crypto'

/**
 * Object storage on Cloudflare R2, through its S3-compatible API.
 *
 * Media never travels through a serverless function. The browser uploads
 * straight to the bucket with a presigned PUT, and a transcription provider
 * reads it back with a presigned GET. That removes the platform's request-body
 * limit from the path — a few megabytes, which is minutes of audio — and stops
 * us paying to move bytes we only ever hand to somebody else.
 *
 * Signing is done here rather than with `@aws-sdk/*`. A presigned URL is an
 * HMAC chain over a canonical string; the whole of it is below, against a
 * published specification, and it keeps megabytes of SDK out of a function that
 * would load it on every cold start. The exactness is not taken on trust:
 * `tests/storage/r2.test.ts` reproduces AWS's own worked example.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256'
const SERVICE = 's3'
/** R2 has no regions, but SigV4 demands one and R2 requires this exact value. */
const R2_REGION = 'auto'

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

/**
 * Configuration, or null when the bucket has not been set up.
 *
 * Read on each call rather than at import time: `next build` evaluates module
 * scope on a machine that has no credentials, and a module that demands one
 * there fails the build rather than the request.
 */
export function r2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

/**
 * RFC 3986 escaping.
 *
 * `encodeURIComponent` leaves `!'()*` alone; SigV4 does not, and a single
 * character escaped differently from how the server escapes it changes the
 * canonical request and invalidates the signature.
 */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** Path segments are escaped individually so the separators survive. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeRfc3986).join('/')
}

const sha256hex = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex')
const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data, 'utf8').digest()

function signingKey(secret: string, date: string, region: string): Buffer {
  let key: Buffer | string = `AWS4${secret}`
  for (const part of [date, region, SERVICE, 'aws4_request']) key = hmac(key, part)
  return key as Buffer
}

export interface SignatureInput {
  method: string
  host: string
  /** Path, already escaped, beginning with a slash. */
  canonicalUri: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  expiresIn: number
  now: Date
  /**
   * Extra headers the request must carry exactly, beyond `host`.
   *
   * Anything named here becomes part of the signature, so the holder of the URL
   * cannot change it. That is how a declared upload size turns into an enforced
   * one instead of a polite request.
   */
  signedHeaders?: Record<string, string>
}

/**
 * A presigned URL: everything the signature covers is in the query string, so
 * whoever holds the URL can make exactly this one request until it expires.
 *
 * Kept separate from `presign` below, and exported, so the signer can be
 * checked against AWS's published example — which uses a different host,
 * region and addressing style than R2 does.
 */
export function presignedUrl(input: SignatureInput): string {
  const amzDate = input.now.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const date = amzDate.slice(0, 8)
  const scope = `${date}/${input.region}/${SERVICE}/aws4_request`

  // Header names lowercased, values trimmed, sorted by name — the canonical
  // form is byte-exact, and a different order is a different signature.
  const headers = Object.entries({ host: input.host, ...input.signedHeaders })
    .map(([name, value]) => [name.toLowerCase(), String(value).trim()] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const canonicalHeaders = headers.map(([name, value]) => `${name}:${value}\n`).join('')
  const signedHeaderNames = headers.map(([name]) => name).join(';')

  // Also sorted by escaped name, as the canonical form requires.
  const canonicalQuery = (
    [
      ['X-Amz-Algorithm', ALGORITHM],
      ['X-Amz-Credential', `${input.accessKeyId}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(input.expiresIn)],
      ['X-Amz-SignedHeaders', signedHeaderNames],
    ] as const
  )
    .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
    .sort()
    .join('&')

  const canonicalRequest = [
    input.method,
    input.canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames,
    // The body is not signed: it does not exist yet when the URL is minted.
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join('\n')
  const signature = createHmac('sha256', signingKey(input.secretAccessKey, date, input.region))
    .update(stringToSign, 'utf8')
    .digest('hex')

  return `https://${input.host}${input.canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

export class StorageNotConfiguredError extends Error {
  readonly status = 503
  constructor() {
    super('Object storage is not configured')
    this.name = 'StorageNotConfiguredError'
  }
}

/** A URL granting one operation on one object, for a limited time. */
export function presign(
  method: 'GET' | 'PUT' | 'DELETE',
  key: string,
  options: {
    expiresIn?: number
    now?: Date
    config?: R2Config
    signedHeaders?: Record<string, string>
  } = {},
): string {
  const config = options.config ?? r2Config()
  if (!config) throw new StorageNotConfiguredError()

  return presignedUrl({
    method,
    host: `${config.accountId}.r2.cloudflarestorage.com`,
    // Path-style: R2 does not serve buckets as subdomains.
    canonicalUri: `/${encodePath(config.bucket)}/${encodePath(key)}`,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: R2_REGION,
    expiresIn: options.expiresIn ?? 600,
    now: options.now ?? new Date(),
    signedHeaders: options.signedHeaders,
  })
}

/**
 * Delete one object.
 *
 * Reports success rather than throwing: the sweeper that calls this works
 * through a list, and one stubborn key must not strand the rest. S3 answers 204
 * whether or not the key existed, so retrying a half-finished sweep is
 * harmless.
 */
export async function deleteObject(key: string): Promise<boolean> {
  const res = await fetch(presign('DELETE', key, { expiresIn: 60 }), { method: 'DELETE' })
  return res.ok
}

/**
 * A key for a new upload.
 *
 * The organisation prefix is what makes a bucket listing auditable and a
 * per-customer erasure a prefix delete. It is scrubbed rather than trusted: an
 * id carrying a slash or a `..` would write into a prefix belonging to somebody
 * else, and the id reaches here from a session whose shape is one dependency
 * upgrade away from changing.
 */
export function newStorageKey(orgId: string, filename: string): string {
  const prefix = orgId.replace(/[^A-Za-z0-9_-]/g, '')
  if (!prefix) throw new Error('Refusing to build a storage key without an organisation')

  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1].toLowerCase() ?? 'bin'
  return `${prefix}/${randomUUID()}.${ext}`
}
