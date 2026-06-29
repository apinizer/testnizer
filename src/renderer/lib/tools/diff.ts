import {
  diffChars,
  diffWords,
  diffWordsWithSpace,
  diffLines,
  diffTrimmedLines,
  type Change,
} from 'diff'

export type DiffMode = 'chars' | 'words' | 'lines'

export type DiffOptions = {
  /** Granularity of the diff. Default 'lines'. */
  mode?: DiffMode
  /** Ignore leading/trailing whitespace per line (lines mode only). Default false. */
  ignoreWhitespace?: boolean
  /** Ignore case when comparing. Default false. */
  ignoreCase?: boolean
}

export type DiffResult = {
  changes: Change[]
  added: number
  removed: number
  unchanged: number
}

/**
 * Compute a diff between two text inputs. Returns the array of Change segments
 * along with summary counts. Equivalent in spirit to `git diff` for text.
 */
export function computeDiff(left: string, right: string, opts: DiffOptions = {}): DiffResult {
  const mode = opts.mode ?? 'lines'
  const a = opts.ignoreCase ? left.toLowerCase() : left
  const b = opts.ignoreCase ? right.toLowerCase() : right

  let changes: Change[]
  if (mode === 'chars') {
    changes = diffChars(a, b)
  } else if (mode === 'words') {
    changes = opts.ignoreWhitespace ? diffWords(a, b) : diffWordsWithSpace(a, b)
  } else {
    changes = opts.ignoreWhitespace ? diffTrimmedLines(a, b) : diffLines(a, b)
  }

  let added = 0
  let removed = 0
  let unchanged = 0
  for (const c of changes) {
    const units = mode === 'lines' ? (c.count ?? c.value.split('\n').length - 1) : c.value.length
    if (c.added) added += units
    else if (c.removed) removed += units
    else unchanged += units
  }
  return { changes, added, removed, unchanged }
}

/**
 * Render a diff result as a unified-diff-style string with `+`/`-` prefixes.
 * Useful for pasting into the output Monaco pane with line decoration.
 */
export function renderUnifiedDiff(result: DiffResult): string {
  const lines: string[] = []
  for (const c of result.changes) {
    const prefix = c.added ? '+' : c.removed ? '-' : ' '
    const segLines = c.value.split('\n')
    // Drop trailing empty line caused by terminating newline
    if (segLines.length > 1 && segLines[segLines.length - 1] === '') segLines.pop()
    for (const l of segLines) lines.push(prefix + l)
  }
  return lines.join('\n')
}

// ───────────────────────────────────────────────────────────────────
// Side-by-side diff
// ───────────────────────────────────────────────────────────────────

export type Segment = { value: string; kind: 'equal' | 'removed' | 'added' }

export type SideBySideRow = {
  /** 1-based line number on the left side, undefined = no left line (added-only). */
  leftNum?: number
  /** 1-based line number on the right side, undefined = no right line (removed-only). */
  rightNum?: number
  /** Row classification. `modify` means a paired removal+addition with intra-line highlights. */
  kind: 'equal' | 'removed' | 'added' | 'modify' | 'empty'
  /** Left-side intra-line segments (kinds: equal | removed). */
  leftSegments?: Segment[]
  /** Right-side intra-line segments (kinds: equal | added). */
  rightSegments?: Segment[]
}

export type SideBySideResult = {
  rows: SideBySideRow[]
  removals: number
  additions: number
  leftLines: number
  rightLines: number
}

/** Split a string into lines, dropping the final empty line caused by a trailing newline. */
function splitLines(s: string): string[] {
  const out = s.split('\n')
  if (out.length > 1 && out[out.length - 1] === '') out.pop()
  return out
}

/**
 * Compute intra-line character segments for a paired removed+added line.
 * Returns the segments to render on the left (equal/removed) and right (equal/added) side.
 */
function pairCharSegments(
  leftLine: string,
  rightLine: string,
): { left: Segment[]; right: Segment[] } {
  const changes = diffChars(leftLine, rightLine)
  const left: Segment[] = []
  const right: Segment[] = []
  for (const c of changes) {
    if (c.added) right.push({ value: c.value, kind: 'added' })
    else if (c.removed) left.push({ value: c.value, kind: 'removed' })
    else {
      left.push({ value: c.value, kind: 'equal' })
      right.push({ value: c.value, kind: 'equal' })
    }
  }
  return { left, right }
}

/**
 * Build a side-by-side diff: line-aligned rows with intra-line character
 * highlights for paired changes.
 *
 * Algorithm:
 * 1. Run diffLines (or diffTrimmedLines if ignoreWhitespace).
 * 2. Walk the changes, pairing each `removed` block with the immediately
 *    following `added` block (or vice versa) line-by-line. Excess lines on
 *    either side become solo removed/added rows.
 * 3. `equal` segments produce rows with both line numbers and identical text.
 */
export function computeSideBySide(
  left: string,
  right: string,
  opts: { ignoreWhitespace?: boolean; ignoreCase?: boolean } = {},
): SideBySideResult {
  const a = opts.ignoreCase ? left.toLowerCase() : left
  const b = opts.ignoreCase ? right.toLowerCase() : right
  const changes = opts.ignoreWhitespace ? diffTrimmedLines(a, b) : diffLines(a, b)

  // Map back to original-cased lines for display purposes.
  const leftLinesAll = splitLines(left)
  const rightLinesAll = splitLines(right)

  let leftCursor = 0
  let rightCursor = 0
  const rows: SideBySideRow[] = []
  let removals = 0
  let additions = 0

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]
    const segLines = splitLines(c.value)

    if (!c.added && !c.removed) {
      // Equal: emit one row per line, copying from original arrays for case fidelity.
      for (let k = 0; k < segLines.length; k++) {
        const lText = leftLinesAll[leftCursor + k] ?? segLines[k]
        const rText = rightLinesAll[rightCursor + k] ?? segLines[k]
        rows.push({
          leftNum: leftCursor + k + 1,
          rightNum: rightCursor + k + 1,
          kind: 'equal',
          leftSegments: [{ value: lText, kind: 'equal' }],
          rightSegments: [{ value: rText, kind: 'equal' }],
        })
      }
      leftCursor += segLines.length
      rightCursor += segLines.length
      continue
    }

    if (c.removed) {
      // Look ahead: does the next change pair this removal with an addition?
      const next = changes[i + 1]
      if (next && next.added) {
        const addLines = splitLines(next.value)
        const pairs = Math.min(segLines.length, addLines.length)
        // Paired modified lines with intra-line char diff
        for (let k = 0; k < pairs; k++) {
          const lText = leftLinesAll[leftCursor + k] ?? segLines[k]
          const rText = rightLinesAll[rightCursor + k] ?? addLines[k]
          const { left: lSegs, right: rSegs } = pairCharSegments(lText, rText)
          rows.push({
            leftNum: leftCursor + k + 1,
            rightNum: rightCursor + k + 1,
            kind: 'modify',
            leftSegments: lSegs,
            rightSegments: rSegs,
          })
        }
        // Excess removals (left has more lines than right)
        for (let k = pairs; k < segLines.length; k++) {
          const lText = leftLinesAll[leftCursor + k] ?? segLines[k]
          rows.push({
            leftNum: leftCursor + k + 1,
            kind: 'removed',
            leftSegments: [{ value: lText, kind: 'removed' }],
          })
        }
        // Excess additions (right has more lines than left)
        for (let k = pairs; k < addLines.length; k++) {
          const rText = rightLinesAll[rightCursor + k] ?? addLines[k]
          rows.push({
            rightNum: rightCursor + k + 1,
            kind: 'added',
            rightSegments: [{ value: rText, kind: 'added' }],
          })
        }
        removals += segLines.length
        additions += addLines.length
        leftCursor += segLines.length
        rightCursor += addLines.length
        i++ // skip the paired addition
      } else {
        // Standalone removal
        for (let k = 0; k < segLines.length; k++) {
          const lText = leftLinesAll[leftCursor + k] ?? segLines[k]
          rows.push({
            leftNum: leftCursor + k + 1,
            kind: 'removed',
            leftSegments: [{ value: lText, kind: 'removed' }],
          })
        }
        removals += segLines.length
        leftCursor += segLines.length
      }
      continue
    }

    if (c.added) {
      // Standalone addition (no preceding removal — it would have been paired above)
      for (let k = 0; k < segLines.length; k++) {
        const rText = rightLinesAll[rightCursor + k] ?? segLines[k]
        rows.push({
          rightNum: rightCursor + k + 1,
          kind: 'added',
          rightSegments: [{ value: rText, kind: 'added' }],
        })
      }
      additions += segLines.length
      rightCursor += segLines.length
    }
  }

  return {
    rows,
    removals,
    additions,
    leftLines: leftLinesAll.length,
    rightLines: rightLinesAll.length,
  }
}

// ───────────────────────────────────────────────────────────────────
// Result navigation + find (consumed by the DiffTool result view)
// ───────────────────────────────────────────────────────────────────

/** Half-open range [start, end) of contiguous rows that form one diff block. */
export type DiffBlock = { start: number; end: number }

/** A single find hit inside one rendered segment. */
export type FindMatchRange = { start: number; length: number; globalIndex: number }

export type FindResult = {
  /** Ordered list of all matches; index is the global match index used for navigation. */
  matches: { rowIndex: number }[]
  /** Lookup keyed `${rowIndex}:${side}:${segIndex}` → ranges within that segment. */
  map: Map<string, FindMatchRange[]>
}

/**
 * Group consecutive non-equal rows into navigable diff blocks. Each block is a
 * half-open range of row indices; `equal` rows separate blocks. Used by the
 * "previous/next difference" navigation.
 */
export function computeDiffBlocks(rows: SideBySideRow[]): DiffBlock[] {
  const blocks: DiffBlock[] = []
  let start = -1
  for (let i = 0; i < rows.length; i++) {
    const isDiff = rows[i].kind !== 'equal'
    if (isDiff && start === -1) start = i
    else if (!isDiff && start !== -1) {
      blocks.push({ start, end: i })
      start = -1
    }
  }
  if (start !== -1) blocks.push({ start, end: rows.length })
  return blocks
}

/**
 * Find every case-insensitive occurrence of `query` across the rendered row
 * segments. Returns the flat ordered match list (for navigation) and a
 * per-segment lookup map (for in-place highlighting). Walk order matches the
 * visual reading order: row → left side then right side → segment.
 */
export function computeFindMatches(rows: SideBySideRow[], rawQuery: string): FindResult {
  const query = rawQuery.toLowerCase()
  const matches: { rowIndex: number }[] = []
  const map = new Map<string, FindMatchRange[]>()
  if (!query) return { matches, map }

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    for (const side of ['left', 'right'] as const) {
      const segs = side === 'left' ? row.leftSegments : row.rightSegments
      if (!segs) continue
      for (let s = 0; s < segs.length; s++) {
        const lower = segs[s].value.toLowerCase()
        let from = lower.indexOf(query)
        while (from !== -1) {
          const globalIndex = matches.length
          matches.push({ rowIndex: r })
          const key = `${r}:${side}:${s}`
          const arr = map.get(key)
          const range: FindMatchRange = { start: from, length: query.length, globalIndex }
          if (arr) arr.push(range)
          else map.set(key, [range])
          from = lower.indexOf(query, from + query.length)
        }
      }
    }
  }
  return { matches, map }
}
