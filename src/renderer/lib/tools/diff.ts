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
