import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

/**
 * The contrast report, as a test.
 *
 * Phase 08 measured every text colour against the two surfaces almost all
 * text sits on, in both themes, and moved three light tokens and one dark
 * one to the nearest value that reaches AA. Measuring once is a report;
 * measuring on every run is the only way the next "slightly lighter grey"
 * does not quietly take it back.
 */

const css = readFileSync(new URL('../../app/tokens.css', import.meta.url), 'utf8')

const tokens: Record<string, [string, string]> = {}
for (const m of css.matchAll(/--([a-z0-9-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi)) {
  tokens[m[1]] = [m[2], m[3]]
}

const luminance = (hex: string): number => {
  const c = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** WCAG 2 contrast ratio, 1 to 21. */
export const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const AA_TEXT = 4.5

describe('the ink on the surfaces it sits on', () => {
  it('reads the tokens', () => {
    for (const name of ['s0', 's1', 'ink', 'ink-2', 'ink-3', 'accent', 'ok', 'warn', 'danger', 'accent-fill']) {
      assert.ok(tokens[name], `${name} is declared with light-dark()`)
    }
  })

  for (const [mode, theme] of [['light', 0], ['dark', 1]] as const) {
    for (const surface of ['s0', 's1']) {
      for (const text of ['ink', 'ink-2', 'ink-3', 'accent', 'ok', 'warn', 'danger']) {
        it(`${text} on ${surface} passes AA for small text in ${mode}`, () => {
          const ratio = contrast(tokens[text][theme], tokens[surface][theme])
          assert.ok(ratio >= AA_TEXT, `${text} ${tokens[text][theme]} on ${surface} ${tokens[surface][theme]}: ${ratio.toFixed(2)}`)
        })
      }
    }
  }

  it('the primary button can be read', () => {
    for (const theme of [0, 1] as const) {
      assert.ok(contrast('#1b1b1d', tokens['accent-fill'][theme]) >= AA_TEXT)
    }
  })

  it('a current search match can be read on the warning colour', () => {
    // .cue-text mark[data-current] prints s0 on warn.
    for (const theme of [0, 1] as const) {
      assert.ok(contrast(tokens.s0[theme], tokens.warn[theme]) >= AA_TEXT)
    }
  })
})
