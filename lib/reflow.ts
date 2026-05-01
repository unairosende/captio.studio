export function reflowText(text: string, limit: number): string {
  const flat = text.replace(/\n/g, ' ').replace(/  +/g, ' ').trim()
  if (flat.length <= limit) return flat

  const words = flat.split(' ')
  let bestSplit = -1
  let bestScore = Infinity

  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(' ')
    const l2 = words.slice(i).join(' ')
    if (l1.length > limit || l2.length > limit) continue
    const score = Math.abs(l1.length - l2.length)
    if (score < bestScore) { bestScore = score; bestSplit = i }
  }

  if (bestSplit > 0) {
    return words.slice(0, bestSplit).join(' ') + '\n' + words.slice(bestSplit).join(' ')
  }

  const cut = flat.lastIndexOf(' ', limit)
  if (cut > 0) return flat.slice(0, cut) + '\n' + flat.slice(cut + 1)
  return flat.slice(0, limit) + '\n' + flat.slice(limit)
}

export function charStatus(text: string, limit: number): 'ok' | 'warn' | 'error' {
  const longest = Math.max(...text.split('\n').map(l => l.length))
  if (longest > limit) return 'error'
  if (longest > Math.floor(limit * 0.85)) return 'warn'
  return 'ok'
}

export function wordDiff(source: string, backTrans: string): { type: 'eq' | 'ins' | 'del'; val: string }[] {
  const tokA = source.replace(/\n/g, ' ').split(/\s+/).filter(Boolean)
  const tokB = backTrans.replace(/\n/g, ' ').split(/\s+/).filter(Boolean)

  if (!tokA.length || !tokB.length) return tokB.map(v => ({ type: 'eq' as const, v })).map(({ v }) => ({ type: 'eq' as const, val: v }))
  if (tokA.length * tokB.length > 10000) return tokB.map(val => ({ type: 'eq' as const, val }))

  const m = tokA.length, n = tokB.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = tokA[i-1].toLowerCase() === tokB[j-1].toLowerCase()
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1])

  const ops: { type: 'eq' | 'ins' | 'del'; val: string }[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokA[i-1].toLowerCase() === tokB[j-1].toLowerCase()) {
      ops.unshift({ type: 'eq',  val: tokB[j-1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      ops.unshift({ type: 'ins', val: tokB[j-1] }); j--
    } else {
      ops.unshift({ type: 'del', val: tokA[i-1] }); i--
    }
  }
  return ops
}
