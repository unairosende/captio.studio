import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

/**
 * "/styleguide is the truth: if it is not there, it does not exist."
 *
 * A rule in CLAUDE.md is a rule somebody has to remember. This one is read
 * from the files, in both directions. Every class ui.css defines has to be
 * drawn in the style guide, or the guide is missing a piece; and every one of
 * them has to be used by the product, or the guide is showing a piece that
 * exists nowhere else — which is how the command palette spent five days
 * being described by a guide it did not read.
 */

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

/** Every .tsx under a directory, recursively. */
function tsx(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(new URL(dir, root))) {
    const path = join(dir, name)
    if (statSync(new URL(path, root)).isDirectory()) out.push(...tsx(path))
    else if (name.endsWith('.tsx')) out.push(path)
  }
  return out
}

/**
 * The class names ui.css defines.
 *
 * Comments go first, then every declaration block, innermost first, so what
 * is left is selectors and at-rule preludes; a `.5s` inside a block never gets
 * mistaken for a class because blocks are gone before names are read.
 */
function classesOf(css: string): string[] {
  let text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (let depth = 0; depth < 8 && /\{[^{}]*\}/.test(text); depth++) {
    text = text.replace(/\{[^{}]*\}/g, '')
  }
  return [...new Set([...text.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]))].sort()
}

/** Whether a class name appears as a whole token in the given source. */
const names = (source: string, cls: string) =>
  new RegExp(`(?<![\\w-])${cls}(?![\\w-])`).test(source)

const pieces = classesOf(read('app/ui.css'))
const guide = tsx('app/styleguide').map(read).join('\n')
const product = [...tsx('app'), ...tsx('components')]
  .filter(p => !p.startsWith('app/styleguide'))
  .map(read)
  .join('\n')

describe('the style guide and the pieces', () => {
  it('reads the pieces', () => {
    assert.ok(pieces.length > 40, `found ${pieces.length} classes in ui.css`)
    for (const known of ['btn', 'field', 'panel', 'row', 'caps', 'meter', 'cue', 'palette', 'menu']) {
      assert.ok(pieces.includes(known), `${known} is a piece`)
    }
  })

  it('draws every piece in the style guide', () => {
    const missing = pieces.filter(c => !names(guide, c))
    assert.deepEqual(missing, [], `defined in ui.css but never drawn in /styleguide: ${missing.join(', ')}`)
  })

  it('shows no piece the product does not use', () => {
    const unused = pieces.filter(c => !names(product, c))
    assert.deepEqual(unused, [], `in ui.css and the style guide, but no screen uses: ${unused.join(', ')}`)
  })
})
