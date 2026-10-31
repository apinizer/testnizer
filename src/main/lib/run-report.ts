/**
 * The run report — ONE generator for every way a run leaves the app (issue #266).
 *
 * Callers:
 *   - `runner:export` (the Export HTML / Export JSON buttons on live results,
 *     All Runs and scheduled-task history rows), and
 *   - the run fail script's `pm.run.exportHtml()` / `exportJson()` (issue #267),
 *     so the file a user downloads and the one a hook mails are byte-identical
 *     (apart from the "Generated:" stamp).
 *
 * Masking and serialisation are ONE step: there is no exported way to
 * serialise a run without first masking every row through `maskRunResult`
 * (`sensitive-scrub.ts`, issue #195). `secrets` carries values the DB does not
 * know yet — a value a script of this run wrote to a secret variable. Masking
 * is idempotent, so re-exporting a stored (already masked) run gives the same
 * text.
 *
 * The headline numbers come from `summarizeRun` (`src/shared/runner-summary`),
 * the same helper as both in-app results views, so the report can never
 * disagree with the screen (teardown is reported, never counted).
 */
import { getDb } from '../db/database'
import { maskRunResult, scrubberFor, type SecretDb } from './sensitive-scrub'
import { summarizeRun } from '../../shared/runner-summary'
import {
  countsTowardRunVerdict,
  criticalStopOf,
  endpointDidPass,
  isSkippedStep,
} from '../../shared/runner-verdict'
import type { EndpointRunResult } from '../../shared/runner-types'
import { runEnvironmentOf, type RunEnvironment } from '../../shared/run-environment'

export type RunReportFormat = 'html' | 'json'

export interface RunReportOptions {
  /** Extra values to mask (live secrets the DB does not hold yet). */
  secrets?: readonly unknown[]
  /** The "Generated:" stamp of the HTML report; defaults to now. */
  generatedAt?: Date | number
  /**
   * The environment the run used (issue #307; `src/shared/run-environment.ts`
   * encoding). Unknown (null / absent) prints nothing.
   */
  environmentName?: string | null
}

/** The DB for the secret inventory — null before init (never throws). */
function secretDb(): SecretDb | null {
  try {
    return getDb()
  } catch {
    return null
  }
}

export function buildRunReport(
  results: readonly EndpointRunResult[],
  format: RunReportFormat,
  options: RunReportOptions = {},
): string {
  const scrub = scrubberFor(secretDb(), options.secrets ?? [])
  const masked = (Array.isArray(results) ? results : []).map((r) => maskRunResult(r, scrub))
  const environment = runEnvironmentOf(options.environmentName)
  if (format === 'html') return renderHtml(masked, options.generatedAt, environment)
  // The SAME shape `exportAsJson` always wrote: a plain array of rows. A run-
  // level field has no slot in an array, so each row carries the run's
  // environment (issue #307): its name, or null for "no environment". Unknown
  // adds nothing (a row that already carries one keeps it — idempotent).
  if (environment.kind === 'unknown') return JSON.stringify(masked, null, 2)
  const environmentName = environment.kind === 'named' ? environment.name : null
  return JSON.stringify(
    masked.map((r) => ({ ...r, environmentName })),
    null,
    2,
  )
}

const escapeHtml = (str: string): string =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function stampOf(at: Date | number | undefined): string {
  const d = at === undefined ? new Date() : new Date(at)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

function renderHtml(
  results: EndpointRunResult[],
  generatedAt: Date | number | undefined,
  environment: RunEnvironment,
): string {
  const totalPassed = results.reduce((sum, r) => sum + (r.passed || 0), 0)
  const totalFailed = results.reduce((sum, r) => sum + (r.failed || 0), 0)
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0)
  // Headline counters from the SHARED summary, so the exported report agrees
  // with both in-app results views. A row that never RAN is neither passed nor
  // failed (shared/runner-summary explains the whole class).
  const summary = summarizeRun(results)
  const primary = results.filter(countsTowardRunVerdict)
  const teardown = results.filter((r) => !countsTowardRunVerdict(r))

  // Why the run stopped (issue #304) — from the rows, the only thing an export
  // (or a history row) has.
  const criticalStop = criticalStopOf(results)
  const stopLine = criticalStop
    ? `<p data-testid="report-stop-reason" style="margin:8px 0 0;font-size:13px;color:#cc2200;font-weight:600">${escapeHtml(
        `Stopped: critical request "${criticalStop.endpointName}" failed`,
      )}</p>`
    : ''
  // The environment the run used (issue #307). The report is English-only.
  const environmentLine =
    environment.kind === 'unknown'
      ? ''
      : `<p data-testid="report-environment" style="margin:8px 0 0;font-size:13px;color:#555">${escapeHtml(
          `Environment: ${environment.kind === 'named' ? environment.name : 'No environment'}`,
        )}</p>`
  const criticalBadge =
    '<span data-critical="true" style="padding:2px 6px;border-radius:4px;border:1px solid #cc2200;color:#cc2200;font-size:11px;font-weight:600">Critical</span>'

  const renderRows = (list: EndpointRunResult[]): string =>
    list
      .map((r) => {
        const didPass = endpointDidPass(r)
        // A row that never ran (NOT_RUN after a stop, SKIPPED, UNSUPPORTED,
        // CANCELLED) is neither passed nor failed.
        const neutral = isSkippedStep(r)
        const statusColor = neutral
          ? '#888888'
          : r.error
            ? '#cc2200'
            : !didPass
              ? '#b35a00'
              : '#1a7a4a'
        const statusBg = neutral
          ? '#f5f5f7'
          : r.error
            ? '#fff0f0'
            : !didPass
              ? '#fff4e0'
              : '#e8f9f1'
        const statusText = neutral
          ? escapeHtml((r.statusText || 'SKIPPED').replace('_', ' '))
          : r.error
            ? 'Error'
            : !didPass
              ? 'Failed'
              : 'Passed'

        const assertionRows = (Array.isArray(r.assertions) ? r.assertions : [])
          .map((a) => {
            const aColor = a.passed ? '#1a7a4a' : '#cc2200'
            const aIcon = a.passed ? '&#10003;' : '&#10007;'
            return `<tr><td style="padding:4px 12px;color:${aColor}">${aIcon} ${escapeHtml(a.name)}</td><td style="padding:4px 12px">${a.actual !== undefined ? escapeHtml(String(a.actual)) : ''}</td><td style="padding:4px 12px;color:${aColor}">${a.error ? escapeHtml(a.error) : ''}</td></tr>`
          })
          .join('')

        // Every row is named: a run-level script row (setup / teardown / fail
        // script) has no method or URL, and used to print an empty header, so
        // "Run fail script" and its error were unreadable in the report.
        const name = r.endpointName
          ? `<span style="font-weight:600;font-size:13px">${escapeHtml(r.endpointName)}</span>`
          : ''
        const isScriptRow = !r.method && !r.url
        const headline = isScriptRow
          ? `${name}<span style="flex:1"></span>`
          : `${name}
          <span style="font-weight:600;color:${statusColor};min-width:60px">${escapeHtml(r.method)}</span>
          <span style="flex:1;font-family:monospace;font-size:13px">${escapeHtml(r.url)}</span>`

        return `
      <div style="margin-bottom:16px;border:1px solid #e8e8ed;border-radius:8px;overflow:hidden">
        <div style="display:flex;align-items:center;padding:12px 16px;background:${statusBg};gap:12px">
          ${headline}
          ${r.critical ? criticalBadge : ''}
          <span style="font-size:13px;color:#888">${r.duration}ms</span>
          <span style="padding:2px 8px;border-radius:4px;background:${statusColor};color:white;font-size:12px;font-weight:600">${r.status ?? '-'} ${statusText}</span>
        </div>
        ${r.assertions && r.assertions.length > 0 ? `<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#fafafa;border-top:1px solid #e8e8ed"><th style="padding:6px 12px;text-align:left">Assertion</th><th style="padding:6px 12px;text-align:left">Actual</th><th style="padding:6px 12px;text-align:left">Error</th></tr></thead><tbody>${assertionRows}</tbody></table>` : ''}
        ${r.error ? `<div style="padding:8px 16px;color:#cc2200;font-size:13px;border-top:1px solid #e8e8ed">${escapeHtml(r.error)}</div>` : ''}
      </div>`
      })
      .join('')

  const rows = renderRows(primary)
  // Teardown gets its own titled section so a reader can tell cleanup apart
  // from the run under test at a glance.
  const teardownSection =
    teardown.length > 0
      ? `<h3 style="margin:28px 0 12px;font-size:15px;font-weight:600">Teardown${
          summary.teardownFailed > 0
            ? ` <span style="font-weight:500;font-size:13px;color:#b35a00">(${summary.teardownFailed} failed — does not affect the run verdict)</span>`
            : ''
        }</h3>${renderRows(teardown)}`
      : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Testnizer - Collection Run Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 960px; margin: 40px auto; padding: 0 20px; color: #1a1a2e; background: #f5f5f7; }
    .header { background: white; border-radius: 12px; padding: 24px 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .stats { display: flex; gap: 24px; margin-top: 16px; }
    .stat { text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; }
    .stat-label { font-size: 12px; color: #888; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin:0;font-size:20px;color:#2D5FA0">Testnizer</h1>
    <h2 style="margin:8px 0 0;font-size:16px;font-weight:500">Collection Run Report</h2>
    <p style="margin:8px 0 0;font-size:13px;color:#888">Generated: ${stampOf(generatedAt)}</p>
    ${environmentLine}
    ${stopLine}
    <div class="stats">
      <div class="stat"><div class="stat-value" data-stat="passed" style="color:#1a7a4a">${summary.passed}</div><div class="stat-label">Passed</div></div>
      <div class="stat"><div class="stat-value" data-stat="failed" style="color:#cc2200">${summary.failed}</div><div class="stat-label">Failed</div></div>
      ${summary.skipped > 0 ? `<div class="stat"><div class="stat-value" data-stat="skipped" style="color:#888">${summary.skipped}</div><div class="stat-label">Skipped</div></div>` : ''}
      <div class="stat"><div class="stat-value" data-stat="total">${summary.total}</div><div class="stat-label">Total</div></div>
      ${teardown.length > 0 ? `<div class="stat"><div class="stat-value" data-stat="teardown" style="color:${summary.teardownFailed > 0 ? '#b35a00' : '#1a7a4a'}">${teardown.length}</div><div class="stat-label">Teardown</div></div>` : ''}
      <div class="stat"><div class="stat-value" style="color:#0066cc">${totalDuration}ms</div><div class="stat-label">Duration</div></div>
      <div class="stat"><div class="stat-value" style="color:#1a7a4a">${totalPassed}</div><div class="stat-label">Assertions Passed</div></div>
      <div class="stat"><div class="stat-value" style="color:#cc2200">${totalFailed}</div><div class="stat-label">Assertions Failed</div></div>
    </div>
  </div>
  ${rows}
  ${teardownSection}
</body>
</html>`
}
