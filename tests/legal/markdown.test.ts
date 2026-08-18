import assert from 'node:assert/strict'
import { test, describe } from 'node:test'

import { isPublished, renderMarkdown } from '../../lib/legal.ts'

describe('the markdown subset the legal documents use', () => {
  test('headings keep their level', () => {
    assert.equal(renderMarkdown('# Terms'), '<h1>Terms</h1>')
    assert.equal(renderMarkdown('## 3 · Paying'), '<h2>3 · Paying</h2>')
  })

  test('a paragraph is rejoined from the lines it was wrapped over', () => {
    assert.equal(
      renderMarkdown('You keep every right in\nthe recordings you upload.'),
      '<p>You keep every right in the recordings you upload.</p>',
    )
  })

  test('a blank line ends the paragraph rather than joining the next', () => {
    assert.equal(renderMarkdown('One.\n\nTwo.'), '<p>One.</p>\n<p>Two.</p>')
  })

  test('bullets become one list, not one list each', () => {
    assert.equal(
      renderMarkdown('- first\n- second'),
      '<ul><li>first</li><li>second</li></ul>',
    )
  })

  test('a table drops the alignment row and keeps the header', () => {
    const html = renderMarkdown(
      '| Subprocessor | Where |\n|---|---|\n| **Vercel** | Stockholm |',
    )
    assert.equal(
      html,
      '<table><thead><tr><th>Subprocessor</th><th>Where</th></tr></thead>' +
        '<tbody><tr><td><strong>Vercel</strong></td><td>Stockholm</td></tr></tbody></table>',
    )
  })

  test('a rule is a rule, and a table separator is not', () => {
    assert.equal(renderMarkdown('---'), '<hr />')
    assert.ok(!renderMarkdown('| a |\n|---|\n| b |').includes('<hr />'))
  })

  test('a cross-reference becomes the link it is already written as', () => {
    assert.equal(
      renderMarkdown('the providers listed at [/subprocessors].'),
      '<p>the providers listed at <a href="/subprocessors">/subprocessors</a>.</p>',
    )
  })

  test('an unfilled placeholder is left alone, not turned into a link', () => {
    assert.equal(renderMarkdown('Entity: [LEGAL ENTITY]'), '<p>Entity: [LEGAL ENTITY]</p>')
  })

  /**
   * The output is handed to dangerouslySetInnerHTML, so this is the assertion
   * that keeps that safe as the documents change.
   */
  test('markup in the source is text, not markup', () => {
    assert.equal(
      renderMarkdown('write to <script>alert(1)</script> & wait'),
      '<p>write to &lt;script&gt;alert(1)&lt;/script&gt; &amp; wait</p>',
    )
  })
})

describe('what may be served', () => {
  test('a document that does not declare itself published is not', () => {
    assert.equal(isPublished('**Not reviewed by a lawyer. Do not publish.**'), false)
    // The phrasing that defeated the first version of this guard.
    assert.equal(isPublished('**Status: draft. Not reviewed by a lawyer.**'), false)
  })

  test('an unfilled placeholder keeps a document unpublished, marker or not', () => {
    assert.equal(isPublished('Status: published\n\nLast updated: [DATE]'), false)
  })

  /**
   * A privacy policy naming [LEGAL ENTITY] is worse than no privacy policy: the
   * missing one is an omission, the published one tells a regulator we do not
   * know who the controller is.
   */
  test('a cross-reference is not a placeholder', () => {
    assert.equal(isPublished('Status: published\n\nlisted at [/subprocessors].'), true)
  })

  test('a finished document is published', () => {
    assert.equal(
      isPublished('# Terms of Service\n\nStatus: published\n\nLast updated: 1 September 2026.'),
      true,
    )
  })
})
