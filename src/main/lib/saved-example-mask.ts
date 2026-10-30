/**
 * Saved examples (`saved_responses`, issue #125) — the ONE mask for the two
 * places an example carries the request that went out on the wire:
 *
 *   - `request_json.sent`           — the example's request snapshot;
 *   - `response_json.actualRequest` — the engine's report of the same request,
 *                                     copied in by the renderer's
 *                                     `serializeResponseForSave`.
 *
 * Both are the resolved wire form, so both carry the real credential: a
 * credential header (`Authorization`, `Cookie`, `X-API-Key`…) and, on a SOAP
 * Send, the WS-Security `<wsse:Password>` inside the envelope (peer review of
 * issue #298). They are masked with the SAME rule, in MAIN — the renderer is
 * never trusted to have done it. The credential values found there are also
 * scrubbed wherever else they appear in the example (an echo server returning
 * the envelope), the History row rule (`maskHistoryRow`).
 *
 * Pure (no DB): the repo's write path and `stripLocalSecrets` (every file / git
 * boundary — rows written before this rule existed) share it.
 */
import { HISTORY_MASK } from '../../shared/credential-headers'
import {
  collectCredentialValues,
  createScrubber,
  maskBodyText,
  type Scrubber,
} from './sensitive-scrub'

type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Header names whose values never reach disk in a saved example. The
 * resolved snapshot is the wire form, so it carries the real credential —
 * unlike the template (`{{token}}`).
 */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
])

export function maskSensitiveHeaders(
  headers: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) && v ? HISTORY_MASK : v
  }
  return out
}

function isSensitiveKvp(h: unknown): h is { key: string; value: unknown } {
  return (
    !!h &&
    typeof h === 'object' &&
    typeof (h as { key?: unknown }).key === 'string' &&
    SENSITIVE_HEADERS.has((h as { key: string }).key.toLowerCase()) &&
    Boolean((h as { value?: unknown }).value)
  )
}

/**
 * A wire request (`sent` / `actualRequest`): credential headers by name, the
 * body by the credential NAME rule (`<wsse:Password>`, a JSON `"password"`),
 * then the value scrub.
 */
function maskWireRequest(req: Json, scrub: Scrubber): Json {
  const out: Json = { ...req }
  if (isRecord(req.headers)) {
    const masked = maskSensitiveHeaders(req.headers) ?? {}
    out.headers = Object.fromEntries(
      Object.entries(masked).map(([k, v]) => [k, typeof v === 'string' ? scrub.text(v) : v]),
    )
  }
  if (typeof req.body === 'string') out.body = maskBodyText(req.body, scrub)
  if (typeof req.url === 'string') out.url = scrub.text(req.url)
  return out
}

function parseObject(text: string | null | undefined): Json | null {
  if (!text) return null
  try {
    const v = JSON.parse(text) as unknown
    return isRecord(v) ? v : null
  } catch {
    return null
  }
}

/** The credential values the two wire snapshots carried by name. */
function wireCredentials(...reqs: unknown[]): Scrubber {
  return createScrubber(reqs.flatMap((r) => (isRecord(r) ? collectCredentialValues(r) : [])))
}

function maskRequestObject(parsed: Json, scrub: Scrubber): Json {
  const out: Json = { ...parsed }
  if (isRecord(parsed.sent)) out.sent = maskWireRequest(parsed.sent, scrub)
  const configured = parsed.configured
  if (isRecord(configured) && Array.isArray(configured.headers)) {
    out.configured = {
      ...configured,
      headers: (configured.headers as unknown[]).map((h) =>
        isSensitiveKvp(h) ? { ...h, value: HISTORY_MASK } : h,
      ),
    }
  }
  return out
}

function maskResponseObject(parsed: Json, scrub: Scrubber): Json {
  const out: Json = { ...parsed }
  if (isRecord(parsed.actualRequest)) {
    out.actualRequest = maskWireRequest(parsed.actualRequest, scrub)
  }
  // The example's own response stays as recorded (it is what the user pinned)
  // — only the request's credential VALUES are scrubbed from it (echoes).
  if (typeof parsed.body === 'string') out.body = scrub.text(parsed.body)
  return out
}

/**
 * Mask secrets inside a serialised request snapshot. Tolerant: anything that
 * is not the expected `{configured, sent}` shape passes through untouched;
 * unparseable text is dropped rather than persisted blindly.
 */
export function maskRequestJson(requestJson: string | null | undefined): string | null {
  return maskSavedExample({ request_json: requestJson ?? null }).request_json
}

/**
 * Both JSON columns of one example, masked together: the credential values of
 * either wire snapshot are scrubbed from both. `response_json` that does not
 * parse is kept as it is (it is NOT NULL and the renderer always writes JSON);
 * `request_json` that does not parse becomes null (`maskRequestJson` rule).
 */
export function maskSavedExample<T extends { response_json?: unknown; request_json?: unknown }>(
  row: T,
): T {
  const req = typeof row.request_json === 'string' ? parseObject(row.request_json) : null
  const res = typeof row.response_json === 'string' ? parseObject(row.response_json) : null
  const scrub = wireCredentials(req?.sent, res?.actualRequest)
  const out: T = { ...row }
  if ('request_json' in row) {
    ;(out as Json).request_json = req
      ? unchangedOr(row.request_json as string, req, maskRequestObject(req, scrub))
      : null
  }
  if (res) {
    ;(out as Json).response_json = unchangedOr(
      row.response_json as string,
      res,
      maskResponseObject(res, scrub),
    )
  }
  return out
}

/**
 * The original text when masking changed nothing — so an export of a clean
 * row stays byte-identical (git `sameExport`, A push → B pull fidelity).
 */
function unchangedOr(original: string, parsed: Json, masked: Json): string {
  const next = JSON.stringify(masked)
  return next === JSON.stringify(parsed) ? original : next
}
