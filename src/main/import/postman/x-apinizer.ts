/**
 * x-apinizer extension helpers (Apinizer <-> Testnizer test interop, contract
 * v1.0). Moved verbatim out of import-export.handler.ts (issue #276) so the
 * Postman importer modules and the Postman exporter share one copy.
 */
import { genKvId } from './normalize'
// ─── x-apinizer extension (Apinizer ↔ Testnizer test interop, contract v1.0) ──
//
// Postman v2.1 preserves unknown custom keys, so Apinizer ships its extra test
// fidelity under an `x-apinizer` key on each item — and reads it back on the
// return trip. We READ it on import (additive; a collection without the key
// still imports as plain Postman) and WRITE it on export so the round-trip
// through Testnizer is lossless for the four assertion kinds Apinizer can carry
// (STATUS_CODE / BODY / JSONPATH / XPATH). Testnizer-only assertion types stay
// in Testnizer's own `assertions` JSON and are simply omitted from the
// extension (contract §4.1). See md_files/testnizer-interop/00-shared-contract.md.

export type XApinizerKind = 'STATUS_CODE' | 'BODY' | 'JSONPATH' | 'XPATH'

export interface XApinizerAssertion {
  kind: XApinizerKind
  expected?: string | number
  /** JSONPath / XPath expression — only present for *PATH kinds. */
  path?: string
}

export interface XApinizerExtension {
  schemaVersion?: string
  source?: string
  /** Raw-body sub-type Postman can't carry natively: JSON / XML / TEXT / HTML. */
  bodyRowType?: string
  timeoutSeconds?: number
  testType?: string
  apiType?: string
  assertions?: XApinizerAssertion[]
}

/** Minimal Testnizer assertion shape produced/consumed here — mirrors
 *  TestAssertion in renderer types. Kept local to avoid importing renderer
 *  code into the main process (same pattern as runner.handler.ts). */
export interface TestAssertionLike {
  id: string
  name: string
  type: string
  enabled: boolean
  expected?: string | number
  jsonPath?: string
  xPath?: string
  headerName?: string
  rangeMin?: number
  rangeMax?: number
}

/**
 * Testnizer row kinds `x-apinizer` restores on import (`xApinizerAssertionsToUi`).
 * Their generated pm.test lines (issue #270) are dropped from the imported test
 * script when the rows come back, or they would run twice.
 */
export const X_APINIZER_RESTORED_KINDS: ReadonlySet<string> = new Set([
  'status_equals',
  'body_contains',
  'body_equals_json',
  'body_jsonpath',
  'body_xpath',
])

/** Major version of the x-apinizer schema this build understands. A collection
 *  tagged with a newer MAJOR falls back to plain Postman (graceful). */
const X_APINIZER_SCHEMA_MAJOR = 1

/** True when we understand this item's x-apinizer payload. An omitted version is
 *  treated as current; a mismatched MAJOR means ignore-and-fall-back. */
export function xApinizerVersionOk(ext: XApinizerExtension | undefined): boolean {
  if (!ext) return false
  const v = ext.schemaVersion
  if (!v) return true
  const major = parseInt(String(v).split('.')[0] ?? '', 10)
  return Number.isFinite(major) && major === X_APINIZER_SCHEMA_MAJOR
}

/** x-apinizer body row-type (JSON/XML/TEXT/HTML) → Testnizer raw sub-type.
 *  Postman keeps the language in `options.raw.language`, but Apinizer's RAW
 *  export often omits it, collapsing every raw body to plain text — this
 *  recovers the json/xml/html distinction. */
export function apinizerRowTypeToBodyType(rowType: string | undefined): string | undefined {
  switch ((rowType ?? '').toUpperCase()) {
    case 'JSON':
      return 'json'
    case 'XML':
      return 'xml'
    case 'HTML':
      return 'html'
    case 'TEXT':
      return 'text'
    default:
      return undefined
  }
}

/** Only refine the raw text family — never re-type form-data / urlencoded /
 *  binary / none, which have no row-type. */
export function isRawFamilyBodyType(t: string | undefined): boolean {
  return t === 'text' || t === 'json' || t === 'xml' || t === 'html' || t === 'raw'
}

function looksLikeJson(s: string): boolean {
  const t = s.trim()
  if (!t || !/^[[{]/.test(t)) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

function truncateLabel(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

/** x-apinizer.assertions[] → Testnizer TestAssertion[]. Unknown kinds are
 *  skipped with a warning (no silent drop). This is the *primary* assertion
 *  source when present — more reliable than parsing the Postman test script. */
export function xApinizerAssertionsToUi(
  assertions: XApinizerAssertion[] | undefined,
  warnings: string[],
): TestAssertionLike[] {
  if (!Array.isArray(assertions)) return []
  const out: TestAssertionLike[] = []
  for (const a of assertions) {
    const expected = a.expected
    switch (a.kind) {
      case 'STATUS_CODE':
        out.push({
          id: genKvId(),
          name: `Status code is ${expected ?? ''}`.trim(),
          type: 'status_equals',
          enabled: true,
          expected,
        })
        break
      case 'BODY': {
        // Apinizer's BODY assertion is a full-body match. Prefer a JSON deep
        // equal when the expected value parses as JSON; otherwise fall back to
        // a substring `contains` (best-effort, per contract §4).
        const raw = typeof expected === 'string' ? expected : JSON.stringify(expected ?? '')
        const isJson = looksLikeJson(raw)
        out.push({
          id: genKvId(),
          name: isJson ? 'Body equals JSON' : `Body contains "${truncateLabel(raw, 32)}"`,
          type: isJson ? 'body_equals_json' : 'body_contains',
          enabled: true,
          expected: raw,
        })
        break
      }
      case 'JSONPATH':
        out.push({
          id: genKvId(),
          name: `JSONPath ${a.path ?? '$'} equals ${expected ?? ''}`.trim(),
          type: 'body_jsonpath',
          enabled: true,
          jsonPath: a.path ?? '$',
          expected,
        })
        break
      case 'XPATH':
        out.push({
          id: genKvId(),
          name: `XPath ${a.path ?? ''} equals ${expected ?? ''}`.trim(),
          type: 'body_xpath',
          enabled: true,
          xPath: a.path ?? '',
          expected,
        })
        break
      default:
        warnings.push(
          `Skipped unknown x-apinizer assertion kind "${String((a as XApinizerAssertion).kind)}"`,
        )
    }
  }
  return out
}

/** Testnizer body sub-type → x-apinizer bodyRowType. Only the raw family maps. */
export function bodyTypeToApinizerRowType(bodyType: string | undefined): string | undefined {
  switch ((bodyType ?? '').toLowerCase()) {
    case 'json':
      return 'JSON'
    case 'xml':
      return 'XML'
    case 'html':
      return 'HTML'
    case 'text':
    case 'raw':
      return 'TEXT'
    default:
      return undefined
  }
}

/** Testnizer TestAssertion[] → x-apinizer.assertions[], keeping only the four
 *  kinds Apinizer's boolean-flag model can carry. Unmappable types
 *  (status_in_range, header_*, response_time/size_under, pm_script) are dropped
 *  from the extension — they stay in Testnizer's own `assertions` JSON for a
 *  Testnizer→Testnizer round-trip (contract §4.1). */
export function assertionsToXApinizer(assertions: TestAssertionLike[]): XApinizerAssertion[] {
  const out: XApinizerAssertion[] = []
  for (const a of assertions) {
    switch (a.type) {
      case 'status_equals':
        out.push({ kind: 'STATUS_CODE', expected: a.expected })
        break
      case 'body_equals_json':
      case 'body_contains':
        out.push({ kind: 'BODY', expected: a.expected })
        break
      case 'body_jsonpath':
        out.push({ kind: 'JSONPATH', path: a.jsonPath ?? '$', expected: a.expected })
        break
      case 'body_xpath':
        out.push({ kind: 'XPATH', path: a.xPath ?? '', expected: a.expected })
        break
      default:
        // Unmappable — intentionally skipped (kept in Testnizer's own channel).
        break
    }
  }
  return out
}

/**
 * Derive Apinizer's `apiType` (EnumApiType) + `testType`
 * (EnumApiTestConsoleTestType) from the Testnizer protocol.
 *
 * We DERIVE rather than preserve an original value because a test imported into
 * Testnizer loses its Apinizer proxy binding (contract §0/§5.6 — apiProxyID etc.
 * are null), so it is a standalone test regardless of where it came from — the
 * original `PROXY` testType would be wrong to carry back. Deriving gives both
 * natively-authored and round-tripped tests a correct, proxy-free value:
 *   - apiType picks the closest EnumApiType (REST/SOAP/GRPC/WEBSOCKET/AI).
 *   - testType picks a standalone test-console kind: RESOURCE for the REST
 *     family (isRest), WSDL for SOAP (isSoap), API (neutral) for the rest.
 */
export function protocolToApinizerTypes(protocol: string | undefined): {
  apiType: string
  testType: string
} {
  switch ((protocol ?? 'http').toLowerCase()) {
    case 'soap':
      return { apiType: 'SOAP', testType: 'WSDL' }
    case 'grpc':
      return { apiType: 'GRPC', testType: 'API' }
    case 'websocket':
    case 'socketio':
      return { apiType: 'WEBSOCKET', testType: 'API' }
    case 'ai':
      return { apiType: 'AI', testType: 'API' }
    default:
      // http / graphql / sse / mcp — all HTTP/REST-family.
      return { apiType: 'REST', testType: 'RESOURCE' }
  }
}
