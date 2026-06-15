/** Cross-process shapes for the shared script runtime. Pure data. */

/** A response normalized into one shape both paths produce, so the shared
 *  `pm.response` builder (and legacy/alias layers) work identically. */
export interface NormalizedResponse {
  /** Numeric HTTP status (Postman `pm.response.code`). */
  code: number
  /** Status reason text (Postman `pm.response.status`, e.g. 'OK'). */
  statusText: string
  /** Case-preserving header map. */
  headers: Record<string, string>
  /** Raw body string. */
  body: string
  /** Cookies the engine parsed from Set-Cookie. */
  cookies: Array<{ name: string; value: string }>
  /** Round-trip time in ms. */
  responseTime: number
  /** Body size in bytes. */
  responseSize: number
}

export interface ScriptTestResult {
  name: string
  passed: boolean
  error?: string
  skipped?: boolean
}
