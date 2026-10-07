import type {
  McpSecurityCategoryId,
  McpSecurityEvidence,
  McpSecurityFinding,
  McpSecurityGrade,
  McpSecurityReport,
  McpSecuritySeverity,
} from '../../../types/mcp'
import { headerLines } from './oauth-steps'

/**
 * Presentation helpers of the MCP Security section (issue #142). Colours are
 * CSS variables from `globals.css` only (light + dark themes), never hex.
 */

export const SECURITY_CATEGORY_ORDER: readonly McpSecurityCategoryId[] = [
  'transport',
  'auth',
  'protocol',
  'injection',
  'disclosure',
  'cors',
  'headers',
  'ratelimit',
]

export const GRADE_CLASS: Readonly<Record<McpSecurityGrade, string>> = {
  A: 'bg-[var(--green)]',
  B: 'bg-[var(--blue)]',
  C: 'bg-[var(--orange)]',
  D: 'bg-[var(--red)] opacity-80',
  F: 'bg-[var(--red)]',
}

export const SEVERITY_CLASS: Readonly<Record<McpSecuritySeverity, string>> = {
  critical: 'border-[var(--red)] bg-[var(--red)] text-white',
  high: 'border-[var(--red)] text-[var(--red)]',
  medium: 'border-[var(--orange)] text-[var(--orange)]',
  low: 'border-[var(--blue)] text-[var(--blue)]',
  info: 'border-[var(--border)] text-[var(--muted)]',
}

export interface CategoryView {
  id: McpSecurityCategoryId
  /** Engine title (English) — the i18n key wins when defined. */
  title: string
  /** Category score — only once the report is in. */
  score?: number
  findings: McpSecurityFinding[]
}

/** The report's categories, or — while scanning — the streamed findings grouped the same way. */
export function categoryViews(
  report: McpSecurityReport | null,
  findings: McpSecurityFinding[],
): CategoryView[] {
  if (report) {
    return report.categories.map((c) => ({
      id: c.id,
      title: c.title,
      score: c.score,
      findings: c.findings,
    }))
  }
  return SECURITY_CATEGORY_ORDER.map((id) => ({
    id,
    title: id,
    findings: findings.filter((f) => f.category === id),
  })).filter((c) => c.findings.length > 0)
}

/** i18n lookup with a fallback when the key is not in the dictionary. */
export function translated(t: (key: string) => string, key: string, fallback: string): string {
  const value = t(key)
  return value === key ? fallback : value
}

export function requestText(e: McpSecurityEvidence): string {
  if (!e.request) return ''
  return [`${e.request.method} ${e.request.url}`, headerLines(e.request.headers)]
    .filter(Boolean)
    .join('\n')
}

export function responseText(e: McpSecurityEvidence): string {
  if (!e.response) return e.error ? `Error: ${e.error}` : ''
  return [
    `HTTP ${e.response.status}`,
    headerLines(e.response.headers),
    e.response.bodyPreview ? `\n${e.response.bodyPreview}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
