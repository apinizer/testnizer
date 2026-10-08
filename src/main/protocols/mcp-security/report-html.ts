/**
 * MCP Security Scan (issue #142) — self-contained HTML report.
 *
 * Same look as the Collection Runner's HTML export (`runner.handler.ts`
 * `exportAsHtml`): white header card with the stats row, one bordered card
 * per section. Every interpolated string is attacker-influenced (tool
 * descriptions, response bodies, header values) and is escaped; only http(s)
 * references become links. The report arrives from the renderer, so it is
 * read defensively and its evidence headers are re-redacted before use.
 */

import { redactReport } from './redact'
import type {
  McpSecurityEvidence,
  McpSecurityFinding,
  McpSecurityGrade,
  McpSecurityReport,
  McpSecurityStatus,
} from './types'

export const DISCLAIMER =
  'Scan only servers you are authorized to test. Active probes (a ~30-request rate-limit burst, and calls without arguments to argument-free tools annotated read-only, or unannotated tools whose name does not look like a write, to test requestState tampering) run only when explicitly enabled. This report reflects automated, heuristic checks of one MCP server at the time shown; it is not a penetration test or a certification.'

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const GRADE_COLOR: Record<McpSecurityGrade, string> = {
  A: '#1a7a4a',
  B: '#2D5FA0',
  C: '#b35a00',
  D: '#cc5200',
  F: '#cc2200',
}

const STATUS_STYLE: Record<McpSecurityStatus, { color: string; bg: string; icon: string }> = {
  pass: { color: '#1a7a4a', bg: '#e8f9f1', icon: '&#10003;' },
  warn: { color: '#b35a00', bg: '#fff4e0', icon: '!' },
  fail: { color: '#cc2200', bg: '#fff0f0', icon: '&#10007;' },
  info: { color: '#0066cc', bg: '#eef5ff', icon: 'i' },
  skipped: { color: '#888888', bg: '#f5f5f7', icon: '&ndash;' },
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function headerText(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

function evidenceHtml(e: McpSecurityEvidence | undefined): string {
  if (!e) return ''
  const parts: string[] = []
  if (e.matches?.length) parts.push(`Matches:\n${e.matches.map((m) => `  • ${m}`).join('\n')}`)
  if (e.request) {
    parts.push(`${e.request.method} ${e.request.url}\n${headerText(e.request.headers)}`)
  }
  if (e.response) {
    parts.push(
      `HTTP ${e.response.status}\n${headerText(e.response.headers)}${e.response.bodyPreview ? `\n\n${e.response.bodyPreview}` : ''}`,
    )
  }
  if (e.error) parts.push(`Error: ${e.error}`)
  if (parts.length === 0) return ''
  return `<pre style="margin:6px 0 0;padding:8px;background:#fafafa;border:1px solid #e8e8ed;border-radius:6px;white-space:pre-wrap;word-break:break-all;font-size:12px">${esc(parts.join('\n\n'))}</pre>`
}

/**
 * Protocol era line (issue #152): `2026-07-28 (modern) · supported versions …`
 * or `2025 (legacy, initialize)`. Read defensively — the report comes from the
 * renderer.
 */
function eraHtml(info: McpSecurityReport['serverInfo']): string {
  const era = info?.era
  if (era !== 'modern' && era !== 'legacy') return ''
  const versions = Array.isArray(info?.supportedVersions)
    ? info.supportedVersions.filter((v): v is string => typeof v === 'string')
    : []
  const text =
    era === 'modern'
      ? `2026-07-28 (modern, server/discover)${versions.length ? ` · supported versions ${versions.join(', ')}` : ''}`
      : '2025 (legacy, initialize)'
  return `<p data-era="${era}" style="margin:2px 0 0;font-size:13px;color:#555">Protocol era: ${esc(text)}</p>`
}

function refsHtml(refs: string[] | undefined): string {
  const links = (refs ?? [])
    .filter((r) => /^https?:\/\//i.test(r))
    .map((r) => `<a href="${esc(r)}" rel="noopener noreferrer">${esc(r)}</a>`)
  return links.length
    ? `<div style="margin-top:6px;font-size:12px">References: ${links.join(' · ')}</div>`
    : ''
}

function findingRow(f: McpSecurityFinding): string {
  const style = STATUS_STYLE[f.status] ?? STATUS_STYLE.info
  const details = [
    f.recommendation
      ? `<div style="font-size:13px"><strong>Recommendation:</strong> ${esc(f.recommendation)}</div>`
      : '',
    refsHtml(f.refs),
    evidenceHtml(f.evidence),
  ].join('')
  return `<tr style="border-top:1px solid #e8e8ed;vertical-align:top">
  <td style="padding:8px 12px;white-space:nowrap"><span style="display:inline-block;min-width:64px;padding:2px 8px;border-radius:4px;background:${style.bg};color:${style.color};font-size:12px;font-weight:600">${style.icon} ${esc(f.status)}</span></td>
  <td style="padding:8px 12px;font-size:12px;color:#555;white-space:nowrap">${esc(f.severity)}</td>
  <td style="padding:8px 12px">
    <div style="font-weight:600;font-size:13px">${esc(f.title)} <span style="font-family:monospace;font-weight:400;color:#888;font-size:11px">${esc(f.id)}</span></div>
    <div style="font-size:13px;margin-top:2px">${esc(f.detail)}</div>
    ${details.trim() ? `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:12px;color:#2D5FA0">Evidence &amp; recommendation</summary>${details}</details>` : ''}
  </td>
</tr>`
}

function sanitizeReport(raw: unknown): McpSecurityReport {
  if (!isRecord(raw) || !Array.isArray(raw.categories) || !isRecord(raw.target)) {
    throw new Error('Not a security scan report')
  }
  return redactReport(raw as unknown as McpSecurityReport)
}

export function buildMcpSecurityHtmlReport(raw: unknown): string {
  const report = sanitizeReport(raw)
  const grade = (['A', 'B', 'C', 'D', 'F'] as const).includes(report.grade) ? report.grade : 'F'
  const s = report.summary ?? { pass: 0, warn: 0, fail: 0, info: 0, skipped: 0 }
  const started = Number.isFinite(report.startedAt) ? new Date(report.startedAt).toISOString() : ''
  const finished = Number.isFinite(report.finishedAt)
    ? new Date(report.finishedAt).toISOString()
    : ''
  const stat = (value: unknown, label: string, color: string): string =>
    `<div class="stat"><div class="stat-value" style="color:${color}">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`

  const sections = report.categories
    .map(
      (c) => `
  <div style="margin-bottom:16px;border:1px solid #e8e8ed;border-radius:8px;overflow:hidden;background:white">
    <div style="display:flex;align-items:center;padding:12px 16px;background:#fafafa;gap:12px">
      <span style="flex:1;font-weight:600;font-size:14px">${esc(c.title)}</span>
      <span style="font-size:13px;color:#888">${esc((c.findings ?? []).length)} checks</span>
      <span style="padding:2px 8px;border-radius:4px;background:#2D5FA0;color:white;font-size:12px;font-weight:600">${esc(c.score)}/100</span>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#fafafa;border-top:1px solid #e8e8ed;font-size:12px;text-align:left"><th style="padding:6px 12px">Status</th><th style="padding:6px 12px">Severity</th><th style="padding:6px 12px">Check</th></tr></thead>
      <tbody>${(c.findings ?? []).map(findingRow).join('')}</tbody>
    </table>
  </div>`,
    )
    .join('')

  const server = report.serverInfo
    ? `<p style="margin:4px 0 0;font-size:13px;color:#555">Server: ${esc(report.serverInfo.name)} ${esc(report.serverInfo.version)} · protocol ${esc(report.serverInfo.protocolVersion)}</p>${eraHtml(report.serverInfo)}`
    : ''
  const flags = [
    report.cancelled ? 'Cancelled — unrun checks are reported as skipped.' : '',
    report.truncated && !report.cancelled ? 'Partial — a list was cut at the scan limit.' : '',
    report.error ? `Error: ${report.error}` : '',
  ].filter(Boolean)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Testnizer - MCP Security Scan Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 960px; margin: 40px auto; padding: 0 20px; color: #1a1a2e; background: #f5f5f7; }
    .header { background: white; border-radius: 12px; padding: 24px 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .stats { display: flex; gap: 24px; margin-top: 16px; flex-wrap: wrap; align-items: center; }
    .stat { text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; }
    .stat-label { font-size: 12px; color: #888; margin-top: 4px; }
    .grade { width: 64px; height: 64px; border-radius: 12px; color: white; font-size: 36px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
    a { color: #2D5FA0; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin:0;font-size:20px;color:#2D5FA0">Testnizer</h1>
    <h2 style="margin:8px 0 0;font-size:16px;font-weight:500">MCP Security Scan Report</h2>
    <p style="margin:8px 0 0;font-size:13px;font-family:monospace">${esc(report.target.url)} (${esc(report.target.transport)})</p>
    ${server}
    <p style="margin:8px 0 0;font-size:13px;color:#888">Scan started: ${esc(started)} · finished: ${esc(finished)}</p>
    <p data-role="disclaimer" style="margin:12px 0 0;padding:8px 12px;border-radius:6px;background:#fff4e0;color:#b35a00;font-size:13px">${esc(DISCLAIMER)}</p>
    ${flags.map((f) => `<p style="margin:8px 0 0;font-size:13px;color:#cc2200">${esc(f)}</p>`).join('')}
    <div class="stats">
      <div class="grade" data-role="grade" style="background:${GRADE_COLOR[grade]}">${esc(grade)}</div>
      ${stat(`${report.score}/100`, 'Score', '#1a1a2e')}
      ${stat(s.pass, 'Passed', '#1a7a4a')}
      ${stat(s.warn, 'Warnings', '#b35a00')}
      ${stat(s.fail, 'Failed', '#cc2200')}
      ${stat(s.info, 'Info', '#0066cc')}
      ${stat(s.skipped, 'Skipped', '#888')}
    </div>
  </div>
  ${sections}
</body>
</html>`
}
