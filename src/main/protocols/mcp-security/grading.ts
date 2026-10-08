/**
 * MCP Security Scan grading (issue #142) — the ONE table to tune.
 *
 * Score starts at 100; every failing check subtracts its severity weight, a
 * warning half of it; pass / info / skipped subtract nothing. The result is
 * clamped to 0–100 and rounded, then mapped to a letter.
 */

import type {
  McpSecurityFinding,
  McpSecurityGrade,
  McpSecuritySeverity,
  McpSecurityStatus,
  McpSecuritySummary,
} from './types'

export const SEVERITY_WEIGHT: Readonly<Record<McpSecuritySeverity, number>> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 0,
}

/** Share of the severity weight a status costs. */
export const STATUS_FACTOR: Readonly<Record<McpSecurityStatus, number>> = {
  fail: 1,
  warn: 0.5,
  pass: 0,
  info: 0,
  skipped: 0,
}

/** Lowest score for each letter, best first; anything below the last is F. */
export const GRADE_THRESHOLDS: ReadonlyArray<readonly [number, McpSecurityGrade]> = [
  [90, 'A'],
  [80, 'B'],
  [65, 'C'],
  [50, 'D'],
]

export function deduction(finding: Pick<McpSecurityFinding, 'severity' | 'status'>): number {
  return SEVERITY_WEIGHT[finding.severity] * STATUS_FACTOR[finding.status]
}

export function scoreOf(
  findings: ReadonlyArray<Pick<McpSecurityFinding, 'severity' | 'status'>>,
): number {
  const lost = findings.reduce((sum, f) => sum + deduction(f), 0)
  return Math.round(Math.min(100, Math.max(0, 100 - lost)))
}

export function gradeOf(score: number): McpSecurityGrade {
  for (const [min, grade] of GRADE_THRESHOLDS) if (score >= min) return grade
  return 'F'
}

export function summarize(
  findings: ReadonlyArray<Pick<McpSecurityFinding, 'status'>>,
): McpSecuritySummary {
  const summary: McpSecuritySummary = { pass: 0, warn: 0, fail: 0, info: 0, skipped: 0 }
  for (const f of findings) summary[f.status] += 1
  return summary
}
