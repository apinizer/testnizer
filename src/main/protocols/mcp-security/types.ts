/**
 * MCP Security Scan (issue #142) — public, JSON-serialisable shapes.
 *
 * Mirrored by hand in `src/preload/index.d.ts` (the web tsconfig cannot
 * import main); the renderer derives its types from the preload bridge.
 */

export type McpSecuritySeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'
export type McpSecurityStatus = 'pass' | 'warn' | 'fail' | 'info' | 'skipped'
export type McpSecurityGrade = 'A' | 'B' | 'C' | 'D' | 'F'
export type McpSecurityTransport = 'http' | 'sse'

export type McpSecurityCategoryId =
  | 'transport'
  | 'auth'
  | 'protocol'
  | 'injection'
  | 'disclosure'
  | 'cors'
  | 'headers'
  | 'ratelimit'

export interface McpSecurityEvidenceRequest {
  method: string
  url: string
  /** Credential headers redacted by name (`Bearer ••••`). */
  headers: Record<string, string>
}

export interface McpSecurityEvidenceResponse {
  status: number
  headers: Record<string, string>
  /** Redacted, truncated body. */
  bodyPreview?: string
}

export interface McpSecurityEvidence {
  request?: McpSecurityEvidenceRequest
  response?: McpSecurityEvidenceResponse
  /** Network-level failure of the exchange (no HTTP response). */
  error?: string
  /** What a content heuristic matched — `tool "x" description: …excerpt…`. */
  matches?: string[]
}

export interface McpSecurityFinding {
  /** Stable check id, e.g. `transport.https`. */
  id: string
  category: McpSecurityCategoryId
  title: string
  severity: McpSecuritySeverity
  status: McpSecurityStatus
  detail: string
  evidence?: McpSecurityEvidence
  recommendation?: string
  /** Spec / RFC URLs. */
  refs?: string[]
}

export interface McpSecurityCategory {
  id: McpSecurityCategoryId
  title: string
  /** 0–100, same deduction table as the overall score. */
  score: number
  findings: McpSecurityFinding[]
}

export interface McpSecuritySummary {
  pass: number
  warn: number
  fail: number
  info: number
  skipped: number
}

export interface McpSecurityServerInfo {
  name: string
  version: string
  protocolVersion: string
  capabilities: Record<string, unknown>
  /**
   * Protocol era the scan's session ran on (issue #152): `modern` = the
   * stateless 2026-07-28 protocol (`server/discover`), `legacy` = the 2025
   * `initialize` handshake.
   */
  era?: 'legacy' | 'modern'
  /** `supportedVersions` of the server's `server/discover` descriptor (modern era). */
  supportedVersions?: string[]
}

export interface McpSecurityReport {
  id: string
  /** Epoch ms. */
  startedAt: number
  finishedAt: number
  target: { url: string; transport: McpSecurityTransport; host: string; scheme: string }
  grade: McpSecurityGrade
  score: number
  categories: McpSecurityCategory[]
  summary: McpSecuritySummary
  serverInfo?: McpSecurityServerInfo
  /** The scan did not run to completion (cancelled) — unrun checks are `skipped`. */
  truncated?: boolean
  cancelled?: boolean
  /**
   * The target never produced an HTTP response. Nothing could be verified, so
   * the grade is forced to F / 0 rather than computed from skipped checks.
   */
  error?: string
}

export interface McpSecurityProgress {
  done: number
  total: number
  /** Title of the check that just started (empty once the scan is finished). */
  current: string
}

export interface McpSecurityScanOptions {
  /** Opt-in: ~30 rapid requests over the authenticated session. */
  rateLimitProbe: boolean
  /**
   * Opt-in (issue #152): call up to `MAX_ELICIT_PROBES` argument-free tools
   * annotated read-only, or unannotated tools whose name does not look like a
   * write, to find one that answers `input_required`, then retry it with a
   * tampered `requestState` (`auth.request_state_tampering`). The UI drives it
   * with the same "active probes" checkbox as `rateLimitProbe`. Absent = off.
   */
  toolInvocationProbe?: boolean
  /** Per-HTTP-request timeout (default 15 s). */
  timeoutMs?: number
}
