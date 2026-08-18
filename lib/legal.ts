import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * The legal documents, and the only ones that may ever be served.
 *
 * An allow-list rather than a directory listing. docs/legal also holds
 * review-checklist.md, which is our own working notes on what is still unsettled
 * — the last thing to hand a broadcaster's procurement department, and exactly
 * what a `readdir` here would publish the day somebody adds another note.
 *
 * The paths are what they are because the documents already cite each other by
 * absolute path: terms, privacy and the DPA all point at [/subprocessors].
 */
export const LEGAL_DOCS = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  dpa: 'Data Processing Agreement',
  subprocessors: 'Subprocessors',
} as const

export type LegalSlug = keyof typeof LEGAL_DOCS

export interface LegalDocument {
  slug: LegalSlug
  title: string
  html: string
  /**
   * Whether this is finished enough to show the world.
   *
   * False until the document itself says `Status: published` on a line of its
   * own, and still carries no `[PLACEHOLDER]`. See isPublished.
   */
  published: boolean
}

/**
 * The line a document must carry to be served at all.
 *
 * Default deny, and on a marker the author adds rather than a warning this code
 * has to recognise. The first version of this test looked for "do not publish"
 * and would have published subprocessors.md, which says "Status: draft" instead
 * — the same intention, phrased differently, and no way to know which phrasings
 * the next document will use. Guessing wrong in this direction publishes an
 * unreviewed DPA; guessing wrong in the other shows a 404 until somebody adds
 * one line.
 */
const PUBLISHED_MARKER = /^Status: published$/m

/**
 * `[DATE]`, `[LEGAL ENTITY, ADDRESS, VAT NUMBER]`, `[NOTICE PERIOD]`.
 *
 * Anchored on an initial capital so it does not catch `[/subprocessors]`, which
 * is a cross-reference rather than a hole in the text.
 */
const PLACEHOLDER = /\[[A-Z][^\]]*\]/

/**
 * Whether this text may be served to the public.
 *
 * Its own function because it is the guard, not a detail of reading a file: the
 * route, the sitemap and the test all have to ask exactly the same question, and
 * a second copy of this rule that drifts is how a draft gets published.
 *
 * The placeholder check stays as a second lock. A document can be marked
 * published while a `[LEGAL ENTITY]` is still in it, and a privacy policy that
 * names no controller is worse than a missing one: the missing one is an
 * omission, the published one is a statement to a regulator that we do not know.
 */
export function isPublished(source: string): boolean {
  return PUBLISHED_MARKER.test(source) && !PLACEHOLDER.test(source)
}

export async function readLegalDocument(slug: LegalSlug): Promise<LegalDocument> {
  const source = await readFile(path.join(process.cwd(), 'docs', 'legal', `${slug}.md`), 'utf8')
  return {
    slug,
    title: LEGAL_DOCS[slug],
    html: renderMarkdown(source),
    published: isPublished(source),
  }
}

/** The documents a stranger can actually reach, for the sitemap. */
export async function publishedLegalSlugs(): Promise<LegalSlug[]> {
  const slugs = Object.keys(LEGAL_DOCS) as LegalSlug[]
  const docs = await Promise.all(slugs.map(readLegalDocument))
  return docs.filter(d => d.published).map(d => d.slug)
}

// ── A markdown subset ───────────────────────────────────────────────────────

/**
 * Enough markdown for these four files, and deliberately no more.
 *
 * A parser is not worth a dependency here: the input is four documents in this
 * repository, written by us, and every construct they use is in the list below —
 * headings, paragraphs, bullet lists, pipe tables, rules, bold, inline code, and
 * the `[/path]` cross-references. Anything else passes through as text rather
 * than being guessed at.
 *
 * The ceiling is that list. The day a document needs a numbered list, a
 * blockquote or a fenced block, this is where it goes — or that is the day a
 * real parser earns its place.
 */
export function renderMarkdown(source: string): string {
  const lines = source.split('\n')
  const out: string[] = []

  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map(li => `<li>${inline(li)}</li>`).join('')}</ul>`)
    list = []
  }
  const flush = () => { flushParagraph(); flushList() }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) { flush(); continue }

    // A rule, which in these documents also separates the sections. Checked
    // before the table below, because `|---|---|` is not one.
    if (/^-{3,}$/.test(trimmed)) { flush(); out.push('<hr />'); continue }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flush()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    if (trimmed.startsWith('|')) {
      flush()
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = lines[i].trim()
        // The `|---|---|` under the header carries no content, only alignment
        // this renderer does not implement.
        if (!/^\|[\s:|-]+\|$/.test(row)) rows.push(cells(row))
        i++
      }
      i-- // The loop above consumed the line that ended the table.
      if (rows.length) out.push(table(rows))
      continue
    }

    if (trimmed.startsWith('- ')) { flushParagraph(); list.push(trimmed.slice(2)); continue }

    flushList()
    paragraph.push(trimmed)
  }

  flush()
  return out.join('\n')
}

function cells(row: string): string[] {
  return row.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
}

function table(rows: string[][]): string {
  const [header, ...body] = rows
  const head = `<thead><tr>${header.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
  const rest = body
    .map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<table>${head}<tbody>${rest}</tbody></table>`
}

/**
 * Escape first, then mark up.
 *
 * The source is ours rather than a visitor's, so this is not the last line of
 * defence — but the output goes through dangerouslySetInnerHTML, and the cost of
 * escaping is nothing next to the cost of remembering, years from now, that the
 * legal text is the one place where an angle bracket is not just an angle
 * bracket.
 */
function inline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // The documents cite one another by the path they are served at, so the
    // citation may as well be the link.
    .replace(/\[(\/[a-z-]+)\]/g, '<a href="$1">$1</a>')
}
