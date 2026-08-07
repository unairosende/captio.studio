export type DiffOp = { type: 'eq' | 'ins' | 'del'; val: string }

/**
 * Cost ceiling for the diff.
 *
 * The table is O(m×n). A pathological pair of cues would otherwise freeze the
 * editor while someone is typing, and a diff is a reading aid — degrading to
 * plain text is a fair trade for staying responsive.
 */
const MAX_CELLS = 10_000

/**
 * Word-level difference between a source cue and its back-translation.
 *
 * Back-translation is a quality check: translate the target back to the source
 * language and see what moved. Highlighting only the words that changed is what
 * makes it readable at a glance.
 *
 * Returns operations rather than markup. The previous implementation built HTML
 * strings, which meant the safety of the editor depended on every caller
 * escaping correctly — and cue text is customer input.
 */
export function wordDiff(source: string, backTranslation: string): DiffOp[] {
  const tokA = source.replace(/\n/g, ' ').split(/\s+/).filter(Boolean)
  const tokB = backTranslation.replace(/\n/g, ' ').split(/\s+/).filter(Boolean)

  if (!tokB.length) return []
  // Nothing to compare against, or too big to be worth it: show it unmarked.
  if (!tokA.length || tokA.length * tokB.length > MAX_CELLS) {
    return tokB.map(val => ({ type: 'eq', val }))
  }

  const m = tokA.length
  const n = tokB.length

  // Longest common subsequence over lowercased tokens, so a capitalisation
  // change does not read as a rewrite.
  const dp: Int16Array[] = Array.from({ length: m + 1 }, () => new Int16Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        tokA[i - 1].toLowerCase() === tokB[j - 1].toLowerCase()
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const ops: DiffOp[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokA[i - 1].toLowerCase() === tokB[j - 1].toLowerCase()) {
      ops.unshift({ type: 'eq', val: tokB[j - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'ins', val: tokB[j - 1] })
      j--
    } else {
      ops.unshift({ type: 'del', val: tokA[i - 1] })
      i--
    }
  }
  return ops
}
