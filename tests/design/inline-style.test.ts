import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

/**
 * "No new style={{}} with a value that already has a name."
 *
 * The disorder the redesign replaced was not one bad decision; it was two
 * hundred small ones, most of them a margin typed where a class should have
 * been. This reads every style={{}} in the product and refuses a literal:
 * a colour, a size, a spacing, a `var(--token)` written inline instead of
 * used from a class. What it lets through is what only the component can
 * know at run time — a width from a percentage, a menu's position, a
 * custom property the piece takes as its parameter — because a value that
 * is computed has no name to be given.
 *
 * The style guide is exempt: it is the catalogue of the values themselves.
 */

const root = new URL('../../', import.meta.url)

function tsx(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(new URL(dir, root))) {
    const path = join(dir, name)
    if (statSync(new URL(path, root)).isDirectory()) out.push(...tsx(path))
    else if (name.endsWith('.tsx')) out.push(path)
  }
  return out
}

/** The text between the braces of `style={{ ... }}`, starting after `style={{`. */
function objectAt(source: string, from: number): string {
  let depth = 1
  let i = from
  let quote: string | null = null
  for (; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') {
      depth--
      if (depth === 0) break
    }
  }
  return source.slice(from, i)
}

/** Top-level `key: value` pairs of an object literal's body. */
function entries(body: string): [string, string][] {
  const out: [string, string][] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  const push = (chunk: string) => {
    const at = chunk.indexOf(':')
    if (at < 0) return
    const key = chunk.slice(0, at).trim().replace(/^['"]|['"]$/g, '')
    const value = chunk.slice(at + 1).trim()
    if (key && value) out.push([key, value])
  }
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      push(body.slice(start, i))
      start = i + 1
    }
  }
  push(body.slice(start))
  return out
}

/** A string or number typed as-is: the kind of value that has a name. */
const literal = (value: string) =>
  /^-?\d+(\.\d+)?$/.test(value) || (/^(['"]).*\1$/.test(value) && !value.includes('${'))

const offenders: string[] = []
for (const path of [...tsx('app'), ...tsx('components')]) {
  if (path.startsWith('app/styleguide')) continue
  const source = readFileSync(new URL(path, root), 'utf8')
  for (const m of source.matchAll(/style=\{\{/g)) {
    const body = objectAt(source, m.index + m[0].length)
    const line = source.slice(0, m.index).split('\n').length
    for (const [key, value] of entries(body)) {
      if (key.startsWith('--')) continue
      if (literal(value)) offenders.push(`${path}:${line} ${key}: ${value}`)
    }
  }
}

describe('inline styles', () => {
  it('carry nothing a class could name', () => {
    assert.deepEqual(offenders, [], `literal values in style={{}}:\n  ${offenders.join('\n  ')}`)
  })
})
