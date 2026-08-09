import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { newStorageKey, presign, presignedUrl } from '../../lib/storage/r2.ts'

/**
 * The signer is written by hand, so it is checked against somebody else's
 * arithmetic rather than its own.
 *
 * A wrong signature is not a subtle bug — every upload fails with a 403 — but
 * it is an expensive one to diagnose from the outside, because the only
 * feedback is a rejection. AWS publishes a worked example with the final
 * signature; reproducing it proves the canonical request, the string to sign
 * and the key derivation are all right at once.
 */

// From AWS's own documented example. Not credentials: they exist to be printed.
const EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  host: 'examplebucket.s3.amazonaws.com',
  canonicalUri: '/test.txt',
  region: 'us-east-1',
  method: 'GET',
  expiresIn: 86400,
  now: new Date('2013-05-24T00:00:00Z'),
}

const EXPECTED_SIGNATURE = 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'

const R2 = {
  accountId: 'acct123',
  accessKeyId: 'synthetic-access-key',
  secretAccessKey: 'synthetic-secret-key',
  bucket: 'captio-media',
}

describe('SigV4 presigning', () => {
  it("reproduces AWS's published example", () => {
    const url = new URL(presignedUrl(EXAMPLE))

    assert.equal(url.searchParams.get('X-Amz-Signature'), EXPECTED_SIGNATURE)
    assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256')
    assert.equal(
      url.searchParams.get('X-Amz-Credential'),
      'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request',
    )
    assert.equal(url.searchParams.get('X-Amz-Date'), '20130524T000000Z')
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host')
  })

  it('signs the method, so a read URL cannot be used to write', () => {
    const get = new URL(presignedUrl({ ...EXAMPLE, method: 'GET' }))
    const put = new URL(presignedUrl({ ...EXAMPLE, method: 'PUT' }))

    assert.notEqual(
      get.searchParams.get('X-Amz-Signature'),
      put.searchParams.get('X-Amz-Signature'),
    )
  })

  it('names extra signed headers so the server holds the request to them', () => {
    const url = new URL(presignedUrl({ ...EXAMPLE, signedHeaders: { 'content-length': '1024' } }))

    // Sorted, lowercased, semicolon-separated — and `host` is still in there.
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;host')
    assert.notEqual(url.searchParams.get('X-Amz-Signature'), EXPECTED_SIGNATURE)
  })

  it('signs the declared size, so a bigger file cannot be substituted', () => {
    const small = new URL(presignedUrl({ ...EXAMPLE, signedHeaders: { 'content-length': '1024' } }))
    const large = new URL(
      presignedUrl({ ...EXAMPLE, signedHeaders: { 'content-length': '999999999' } }),
    )

    assert.notEqual(
      small.searchParams.get('X-Amz-Signature'),
      large.searchParams.get('X-Amz-Signature'),
    )
  })

  it('signs the expiry, so it cannot be widened by editing the URL', () => {
    const short = new URL(presignedUrl({ ...EXAMPLE, expiresIn: 60 }))
    const long = new URL(presignedUrl({ ...EXAMPLE, expiresIn: 86400 }))

    assert.notEqual(
      short.searchParams.get('X-Amz-Signature'),
      long.searchParams.get('X-Amz-Signature'),
    )
  })
})

describe('presign against R2', () => {
  it('addresses the bucket in the path, not the host', () => {
    const url = new URL(presign('PUT', 'org1/file.mp3', { config: R2 }))

    assert.equal(url.host, 'acct123.r2.cloudflarestorage.com')
    assert.equal(url.pathname, '/captio-media/org1/file.mp3')
  })

  it('refuses to sign when nothing is configured', () => {
    const saved = { ...process.env }
    for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
      delete process.env[key]
    }
    try {
      assert.throws(() => presign('PUT', 'org1/file.mp3'), /not configured/i)
    } finally {
      Object.assign(process.env, saved)
    }
  })
})

describe('storage keys', () => {
  it('prefixes with the organisation and keeps the extension', () => {
    const key = newStorageKey('org_abc123', 'entrevista final.MP3')

    assert.match(key, /^org_abc123\/[0-9a-f-]{36}\.mp3$/)
  })

  it('cannot be steered out of its own prefix', () => {
    // A slash or a dot-dot in the id would put one customer's upload inside
    // another's prefix, which is where a per-organisation erasure would miss it.
    for (const hostile of ['../other', 'a/b', 'org/../../root', 'org id']) {
      const key = newStorageKey(hostile, 'x.wav')
      const prefix = key.slice(0, key.indexOf('/'))

      assert.ok(!prefix.includes('..'), `traversal survived: ${key}`)
      assert.match(prefix, /^[A-Za-z0-9_-]+$/, `unexpected prefix: ${prefix}`)
      assert.equal(key.split('/').length, 2, `extra path segments: ${key}`)
    }
  })

  it('refuses an organisation with nothing usable in it', () => {
    assert.throws(() => newStorageKey('///', 'x.wav'), /without an organisation/)
  })

  it('falls back to a neutral extension rather than inventing one', () => {
    assert.match(newStorageKey('org1', 'no-extension'), /\.bin$/)
  })
})
