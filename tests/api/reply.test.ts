import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { OFFLINE, api, must, send } from '../../lib/api.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const answer = (status: number, body: unknown) => {
  globalThis.fetch = async () => new Response(body === undefined ? '<!DOCTYPE html>' : JSON.stringify(body), { status, headers: body === undefined ? {} : { 'Content-Type': 'application/json' } })
}

describe('calling our own routes', () => {
  it('never throws when the request never left', async () => {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
    const r = await api('/api/x')
    assert.deepEqual([r.ok, r.status, r.error], [false, 0, OFFLINE])
  })

  it('says the three refusals a reader must act on in Spanish, and keeps the rest as the server said', async () => {
    answer(401, { error: 'Unauthorized' })
    assert.match((await api('/api/x')).error, /sesión ha caducado/)
    answer(403, { error: 'Only an owner or admin can manage billing' })
    assert.match((await api('/api/x')).error, /permiso/)
    answer(402, { error: 'Se acabó' })
    assert.equal((await api('/api/x')).error, 'Se acabó')
  })

  it('reads a reply that is not JSON as a request cut short', async () => {
    answer(502, undefined)
    const r = await api('/api/x')
    assert.equal(r.ok, false)
    assert.match(r.error, /502/)
  })

  it('carries an empty error on success, and the body', async () => {
    answer(200, { url: 'https://stripe' })
    const r = await send<{ url: string }>('/api/x', { planId: 'team' })
    assert.deepEqual([r.ok, r.error, r.json.url], [true, '', 'https://stripe'])
  })

  it('throws the sentence to print when asked to', async () => {
    answer(500, { error: 'Boom' })
    await assert.rejects(must('/api/x'), /Boom/)
  })
})
