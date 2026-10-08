import { isCredentialHeaderName } from '../../lib/credential-headers'
import { REDACTED } from '../mcp-oauth.engine'
import type { McpSecurityReport } from './types'

/**
 * Re-redact every evidence header map by name — defence in depth for a
 * report about to cross IPC or be exported (the engine already redacted and
 * value-scrubbed it). Returns a deep copy.
 */
export function redactReport<T extends Pick<McpSecurityReport, 'categories'>>(report: T): T {
  const copy = JSON.parse(JSON.stringify(report)) as T
  const fix = (headers: Record<string, string> | undefined): void => {
    if (!headers || typeof headers !== 'object') return
    for (const [name, value] of Object.entries(headers)) {
      if (!isCredentialHeaderName(name) || String(value).includes(REDACTED)) continue
      const scheme = /^(\w+)\s+\S/.exec(String(value))?.[1]
      headers[name] = scheme ? `${scheme} ${REDACTED}` : REDACTED
    }
  }
  for (const category of Array.isArray(copy.categories) ? copy.categories : []) {
    for (const finding of Array.isArray(category?.findings) ? category.findings : []) {
      fix(finding?.evidence?.request?.headers)
      fix(finding?.evidence?.response?.headers)
    }
  }
  return copy
}
