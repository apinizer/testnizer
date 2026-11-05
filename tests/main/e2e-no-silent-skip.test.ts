// @vitest-environment node
/**
 * Guard — no "silent green" in the e2e suite.
 *
 * `await x.isVisible().catch(() => false)` answers "no" instantly, with no
 * waiting, and an `if` around it then skips the rest of the test. A spec that
 * does this passes whether or not the feature under test exists: the SOAP
 * Headers test, the dirty-tab test and the SAML Build test all went green that
 * way while asserting nothing.
 *
 * Rule: every `isVisible()` probe in `tests/e2e` (specs and helpers) must either
 * be replaced by an `expect(...).toBeVisible()` or be marked, on the line above
 * it, with `// optional: <why the test is still meaningful if it is absent>`.
 * The screen tour (`ui/tour/`) is a screenshot sweep that asserts nothing by
 * design (see its header) and is exempt.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const E2E_ROOT = resolve(__dirname, '../e2e')
const EXEMPT_DIR = `ui${sep}tour`
const MARKER = /\/\/ optional: \S/

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      if (relative(E2E_ROOT, full) === EXEMPT_DIR) continue
      out.push(...listTsFiles(full))
    } else if (entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Lines that use `isVisible(` as a probe without an `// optional:` marker.
 * A probe may be split over several lines (`await page` / `.getByTestId(..)` /
 * `.isVisible()` / `.catch(..)`), so the statement head is found by walking up
 * while the line starts with `.`; the marker must sit within the four lines at
 * or above that head (it may sit between an `if (` and the expression).
 */
function unmarkedVisibilityProbes(source: string): number[] {
  const lines = source.split('\n')
  const hits: number[] = []
  lines.forEach((line, i) => {
    if (!line.includes('isVisible(')) return
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    let head = i
    while (head > 0 && lines[head].trim().startsWith('.')) head--
    const above = lines.slice(Math.max(0, head - 3), head + 1)
    if (!MARKER.test(line) && !above.some((l) => MARKER.test(l))) hits.push(i + 1)
  })
  return hits
}

describe('e2e specs have no silent isVisible() branches', () => {
  it('flags an unmarked probe and accepts a marked one', () => {
    const bad = [
      "const gate = page.getByTestId('x')",
      'if (await gate.isVisible().catch(() => false)) {',
      '  await gate.click()',
      '}',
    ].join('\n')
    expect(unmarkedVisibilityProbes(bad)).toEqual([2])

    const marked = [
      "const gate = page.getByTestId('x')",
      '// optional: the gate only shows on a first launch',
      'if (await gate.isVisible().catch(() => false)) {',
      '  await gate.click()',
      '}',
    ].join('\n')
    expect(unmarkedVisibilityProbes(marked)).toEqual([])

    const chained = [
      '// optional: records the starting state',
      'const wasOpen = await window',
      "  .getByTestId('right-panel')",
      '  .isVisible()',
      '  .catch(() => false)',
    ].join('\n')
    expect(unmarkedVisibilityProbes(chained)).toEqual([])
    expect(unmarkedVisibilityProbes(chained.replace('// optional:', '// note:'))).toEqual([4])
  })

  it('scans the whole e2e tree', () => {
    expect(listTsFiles(E2E_ROOT).length).toBeGreaterThan(100)
  })

  it('every isVisible() probe in tests/e2e carries an "// optional:" reason', () => {
    const offenders: string[] = []
    for (const file of listTsFiles(E2E_ROOT)) {
      for (const line of unmarkedVisibilityProbes(readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(E2E_ROOT, file)}:${line}`)
      }
    }
    expect(
      offenders,
      'Replace the probe with expect(...).toBeVisible(), or mark it with `// optional: <why>`',
    ).toEqual([])
  })
})
