/**
 * Tests-tab assertion rows → Postman-compatible `pm.test(...)` code (issue #270).
 *
 * A Postman / Insomnia export used to carry the visual assertion rows only in
 * the `x-apinizer` extension, which Postman and Newman ignore — the exported
 * collection ran with none of the request's checks. This module turns each
 * enabled row into a `pm.test` whose verdict is the SAME boolean Testnizer's
 * Send evaluator computes (`src/renderer/lib/test-runner.ts` → `runAssertions`,
 * after `resolveAssertionVars`). It uses only pm APIs that Postman, Insomnia
 * (`insomnia.` prefix) and our own shared runtime (`src/shared/script/`) all
 * provide — `test`, `response.code/text()/headers.get/responseTime/
 * responseSize`, `variables.replaceIn` — and computes the verdict in plain JS
 * (no chai matcher whose semantics could differ, e.g. deep-eql vs Testnizer's
 * key-order-sensitive `JSON.stringify` compare), so a re-import runs the same.
 *
 * Block shape (one per script; the markers let the importer recognise it):
 *
 *   // --- Testnizer Tests tab assertions (generated) ---
 *   ;(function () {
 *   var __tnJsonPath = …            (only when a JSONPath row exists)
 *   // tn-assert:status_equals
 *   pm.test("Status is 200", function () { … });
 *   })();
 *   // --- end Testnizer Tests tab assertions ---
 *
 * Every row is a `// tn-assert:<kind>` tag line followed by EXACTLY one line
 * (the `pm.test`, or a `// not exportable …` comment). The importer strips the
 * rows it restores from `x-apinizer` by that tag (`stripExportedAssertions`).
 * Pure TS, no imports — shared by main (export/import) and tests.
 */

export const ASSERTION_BLOCK_BEGIN = '// --- Testnizer Tests tab assertions (generated) ---'
export const ASSERTION_BLOCK_END = '// --- end Testnizer Tests tab assertions ---'
export const ASSERTION_TAG_PREFIX = '// tn-assert:'

/** Script object prefix: `pm` (Postman) or `insomnia` (Insomnia's own binding). */
export type AssertionScriptPrefix = 'pm' | 'insomnia'

/** The row shape this converter reads — mirrors `TestAssertion` (renderer types). */
export interface AssertionRowLike {
  name?: string
  type: string
  enabled?: boolean
  expected?: string | number
  jsonPath?: string
  xPath?: string
  headerName?: string
  rangeMin?: number | string
  rangeMax?: number | string
}

/**
 * Mirror of `evaluateJsonPath` (src/renderer/lib/test-runner.ts and
 * src/main/lib/json-path.ts): `$`, dot/bracket keys, `[n]`, `[*]` mapping the
 * rest of the path over each element, `.length`. Emitted into the script
 * because neither Postman nor Insomnia has a JSONPath engine in its sandbox.
 */
const JSON_PATH_HELPER = [
  'var __tnJsonPath = function (obj, path) {',
  "  if (path.charAt(0) !== '$') return undefined;",
  '  var s = path.slice(1);',
  "  if (s === '' || s === '.') return obj;",
  "  if (s === '.length') return Array.isArray(obj) || typeof obj === 'string' ? obj.length : undefined;",
  '  var tokens = [], i = 0, t;',
  '  while (i < s.length) {',
  "    if (s.charAt(i) === '[') {",
  "      i++; t = ''; while (i < s.length && s.charAt(i) !== ']') { t += s.charAt(i); i++ } i++; tokens.push('[' + t + ']');",
  '    } else {',
  "      if (s.charAt(i) === '.') i++;",
  "      t = ''; while (i < s.length && s.charAt(i) !== '.' && s.charAt(i) !== '[') { t += s.charAt(i); i++ } if (t) tokens.push(t);",
  '    }',
  '  }',
  '  var walk = function (cur, toks) {',
  '    for (var k = 0; k < toks.length; k++) {',
  '      var tok = toks[k];',
  '      if (cur === null || cur === undefined) return undefined;',
  "      if (tok === 'length') {",
  "        if (Array.isArray(cur) || typeof cur === 'string') return cur.length;",
  "        if (typeof cur === 'object' && 'length' in cur) return cur['length'];",
  '        return undefined;',
  '      }',
  "      if (tok.charAt(0) === '[' && tok.charAt(tok.length - 1) === ']') {",
  '        var inner = tok.slice(1, -1);',
  "        if (inner === '*') {",
  '          if (!Array.isArray(cur)) return undefined;',
  '          var rest = toks.slice(k + 1);',
  '          if (rest.length === 0) return cur;',
  '          return cur.map(function (el) { return walk(el, rest) });',
  '        }',
  '        var idx = parseInt(inner, 10);',
  '        if (!isNaN(idx) && Array.isArray(cur)) cur = cur[idx];',
  "        else if (typeof cur === 'object') cur = cur[inner.replace(/^['\"]|['\"]$/g, '')];",
  '        else return undefined;',
  "      } else if (typeof cur === 'object' && !Array.isArray(cur)) cur = cur[tok];",
  '      else return undefined;',
  '    }',
  '    return cur;',
  '  };',
  '  return walk(obj, tokens);',
  '};',
]

const str = (v: unknown, fallback: string): string => (v == null ? fallback : String(v))

/** Default label for a row the user left unnamed. */
function defaultName(a: AssertionRowLike): string {
  switch (a.type) {
    case 'status_equals':
      return `Status is ${str(a.expected, '')}`.trim()
    case 'status_in_range':
      return `Status in ${str(a.rangeMin, '0')}-${str(a.rangeMax, '999')}`
    case 'body_contains':
      return 'Body contains'
    case 'body_equals_json':
      return 'Body equals JSON'
    case 'body_jsonpath':
      return `JSONPath ${str(a.jsonPath, '$')}`
    case 'header_exists':
      return `Header ${str(a.headerName, '')} exists`
    case 'header_equals':
      return `Header ${str(a.headerName, '')} equals`
    case 'header_contains':
      return `Header ${str(a.headerName, '')} contains`
    case 'response_time_under':
      return `Response time under ${str(a.expected, '0')} ms`
    case 'response_size_under':
      return `Response size under ${str(a.expected, '0')} bytes`
    default:
      return a.type
  }
}

/**
 * One `pm.test` line (or a not-exportable comment) for a row. `null` never —
 * an unknown kind yields a comment so nothing is silently dropped.
 */
function rowLine(a: AssertionRowLike, P: AssertionScriptPrefix): string {
  // `{{var}}` resolves like `resolveAssertionVars` does on Send: only strings
  // carrying a placeholder go through replaceIn; literals stay literals.
  const text = (s: string): string =>
    s.includes('{{') ? `${P}.variables.replaceIn(${JSON.stringify(s)})` : JSON.stringify(s)
  /** A row number field the form may hold as text (incl. `{{var}}`). */
  const num = (v: unknown, fallback: number): string => {
    if (v == null) return String(fallback)
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NaN'
    return `Number(${text(String(v))})`
  }
  const name = JSON.stringify((a.name ?? '').trim() || defaultName(a))
  const test = (body: string): string => `${P}.test(${name}, function () { ${body} });`
  const fail = (cond: string, msg: string): string => `if (!(${cond})) throw new Error(${msg});`
  const R = `${P}.response`

  switch (a.type) {
    case 'status_equals': {
      // Send: Number(expected) — a missing value is NaN and never matches.
      const exp =
        a.expected == null
          ? 'NaN'
          : typeof a.expected === 'number'
            ? String(a.expected)
            : `Number(${text(a.expected)})`
      return test(
        `var e = ${exp}, a = ${R}.code; ${fail('a === e', "'expected status ' + e + ' but got ' + a")}`,
      )
    }
    case 'status_in_range':
      return test(
        `var lo = ${num(a.rangeMin, 0)}, hi = ${num(a.rangeMax, 999)}, a = ${R}.code; ` +
          fail('a >= lo && a <= hi', "'expected status in ' + lo + '-' + hi + ' but got ' + a"),
      )
    case 'body_contains':
      return test(
        `var e = ${text(str(a.expected, ''))}; ` +
          fail(`${R}.text().indexOf(e) !== -1`, "'body does not contain ' + JSON.stringify(e)"),
      )
    case 'body_equals_json':
      // Key-order sensitive on purpose: Testnizer compares JSON.stringify output.
      return test(
        `var a = JSON.stringify(JSON.parse(${R}.text())), e = JSON.stringify(JSON.parse(${text(str(a.expected, '{}'))})); ` +
          fail('a === e', "'body ' + a + ' does not equal ' + e"),
      )
    case 'body_jsonpath':
      // Empty expected = existence check; objects compare as JSON text.
      return test(
        `var v = __tnJsonPath(JSON.parse(${R}.text()), ${JSON.stringify(str(a.jsonPath, '$'))}), ` +
          `s = typeof v === 'object' ? JSON.stringify(v) : String(v == null ? '' : v), ` +
          `e = ${text(str(a.expected, ''))}; ` +
          `if (e === '') { ${fail('v !== undefined', "'JSONPath matched nothing'")} } ` +
          `else { ${fail('s === e', "'expected ' + JSON.stringify(e) + ' but got ' + JSON.stringify(s)")} }`,
      )
    case 'header_exists':
      return test(
        `var n = ${text(str(a.headerName, ''))}.trim(); ` +
          fail(`${R}.headers.get(n) !== undefined`, "'header ' + n + ' not found'"),
      )
    case 'header_equals':
      return test(
        `var n = ${text(str(a.headerName, ''))}.trim(), a = String(${R}.headers.get(n) || '').trim(), ` +
          `e = ${text(str(a.expected, ''))}.trim(); ` +
          fail(
            'a === e',
            "'header ' + n + ': expected ' + JSON.stringify(e) + ' but got ' + JSON.stringify(a)",
          ),
      )
    case 'header_contains':
      return test(
        `var n = ${text(str(a.headerName, ''))}.trim(), a = String(${R}.headers.get(n) || '').trim(), ` +
          `e = ${text(str(a.expected, ''))}.trim(); ` +
          fail('a.indexOf(e) !== -1', "'header ' + n + ' does not contain ' + JSON.stringify(e)"),
      )
    case 'response_time_under':
      return test(
        `var e = ${num(a.expected ?? 0, 0)}, a = ${R}.responseTime; ` +
          fail('a < e', "'response time ' + a + ' ms is not under ' + e"),
      )
    case 'response_size_under':
      return test(
        `var e = ${num(a.expected ?? 0, 0)}, a = ${R}.responseSize; ` +
          fail('a < e', "'response size ' + a + ' is not under ' + e"),
      )
    case 'body_xpath':
      // Postman's and Insomnia's sandboxes have no DOMParser / XPath engine.
      // The row still travels in x-apinizer (Postman) for a Testnizer re-import.
      return (
        `// not exportable: Postman/Insomnia scripts have no XPath engine — ` +
        `${name} xpath=${JSON.stringify(str(a.xPath, ''))} expected=${JSON.stringify(str(a.expected, ''))}`
      )
    default:
      return `// Testnizer assertion ${JSON.stringify(a.type)} not exportable — ${name}`
  }
}

/**
 * Enabled rows → the generated block, or '' when there is nothing enabled.
 * Disabled rows are skipped (Testnizer does not run them either).
 */
export function assertionsToScript(
  rows: readonly AssertionRowLike[] | null | undefined,
  prefix: AssertionScriptPrefix = 'pm',
): string {
  const enabled = (rows ?? []).filter((r) => r && typeof r.type === 'string' && r.enabled !== false)
  if (enabled.length === 0) return ''
  const lines: string[] = [ASSERTION_BLOCK_BEGIN, ';(function () {']
  if (enabled.some((r) => r.type === 'body_jsonpath')) lines.push(...JSON_PATH_HELPER)
  for (const r of enabled) {
    lines.push(`${ASSERTION_TAG_PREFIX}${r.type}`, rowLine(r, prefix))
  }
  lines.push('})();', ASSERTION_BLOCK_END)
  return lines.join('\n')
}

/**
 * The exported post-response script: the generated block FIRST (Testnizer runs
 * the rows before the request's script, with the variables as they stood
 * before it), then the user's own script.
 */
export function withAssertionScript(
  postScript: string | null | undefined,
  rows: readonly AssertionRowLike[] | null | undefined,
  prefix: AssertionScriptPrefix = 'pm',
): string | undefined {
  const block = assertionsToScript(rows, prefix)
  const user = postScript && postScript.trim() ? postScript : ''
  if (!block) return user || undefined
  return user ? `${block}\n${user}` : block
}

/**
 * Import side: remove the generated tests whose kinds come back as rows (from
 * `x-apinizer`), so nothing runs twice. Tests of other kinds stay in the
 * script, still inside the block; a block left with no test is removed whole.
 * Text outside the markers (the user's script) is never touched.
 */
export function stripExportedAssertions(script: string, kinds: ReadonlySet<string>): string {
  if (!script.includes(ASSERTION_BLOCK_BEGIN)) return script
  const lines = script.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim() !== ASSERTION_BLOCK_BEGIN) {
      out.push(lines[i])
      i++
      continue
    }
    let end = i + 1
    while (end < lines.length && lines[end].trim() !== ASSERTION_BLOCK_END) end++
    if (end >= lines.length) {
      // Unterminated block (edited by hand) — leave the rest as it is.
      out.push(...lines.slice(i))
      break
    }
    const block: string[] = []
    let remainingTests = 0
    for (let k = i; k <= end; k++) {
      const t = lines[k].trim()
      if (t.startsWith(ASSERTION_TAG_PREFIX)) {
        const kind = t.slice(ASSERTION_TAG_PREFIX.length).trim()
        if (kinds.has(kind) && k + 1 < end) {
          k++ // drop the tag and its one line
          continue
        }
        remainingTests++
      }
      block.push(lines[k])
    }
    if (remainingTests > 0) out.push(...block)
    i = end + 1
  }
  const result = out.join('\n').replace(/^\s*\n/, '')
  return result.trim() ? result : ''
}
