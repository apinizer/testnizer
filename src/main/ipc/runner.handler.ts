// src/main/ipc/runner.handler.ts
// Apinizer API Tester — Collection Runner IPC Handler

import { ipcMain, BrowserWindow } from 'electron'
import { executeHttpRequest, HttpRequestOptions } from '../protocols/http.engine'
import * as endpointRepo from '../db/endpoint.repo'
import * as historyRepo from '../db/history.repo'
import { getDb } from '../db/database'

// ─── Types ───────────────────────────────────────────────────────

interface KeyValuePair {
  id: string
  key: string
  value: string
  description?: string
  enabled: boolean
}

interface RequestBody {
  type: string
  content?: string
  formData?: KeyValuePair[]
  urlEncoded?: KeyValuePair[]
  binaryPath?: string
}

interface AuthConfig {
  type: string
  basic?: { username: string; password: string }
  bearer?: { token: string; prefix?: string }
  apiKey?: { key: string; value: string; in: 'header' | 'query' }
  oauth2?: { token?: string }
  digest?: { username: string; password: string }
  ntlm?: { username: string; password: string; domain?: string; workstation?: string }
  hawk?: { authId: string; authKey: string; algorithm: 'sha1' | 'sha256' }
  awsSignature?: { accessKey: string; secretKey: string; region: string; service: string }
}

interface TestAssertion {
  id: string
  name: string
  type: string
  enabled: boolean
  expected?: string | number
  jsonPath?: string
  xPath?: string
  headerName?: string
  script?: string
  rangeMin?: number
  rangeMax?: number
}

interface RunnerExecuteOptions {
  projectId: string
  endpointIds: string[]
  environmentId?: string
  workspaceId?: string
  delay?: number
  folderName?: string
  source?: string
  sourceLabel?: string
}

interface RunnerExportOptions {
  results: EndpointRunResult[]
  format: 'json' | 'html'
}

interface ResponseTiming {
  total: number
  dns?: number
  tcp?: number
  tls?: number
  ttfb?: number
  download?: number
}

interface EndpointRunResult {
  endpointId: string
  endpointName: string
  folderName?: string
  method: string
  url: string
  status: number | null
  statusText: string
  duration: number
  passed: number
  failed: number
  skipped: number
  assertions: AssertionResult[]
  error?: string
  responseSize?: number
  responseBody?: string
  responseHeaders?: Record<string, string>
}

interface AssertionResult {
  name: string
  passed: boolean
  actual?: string | number
  error?: string
}

interface RunnerProgress {
  current: number
  total: number
  endpointId: string
  result: EndpointRunResult
}

interface RunnerReport {
  projectId: string
  startedAt: number
  completedAt: number
  totalEndpoints: number
  passedEndpoints: number
  failedEndpoints: number
  totalAssertions: number
  passedAssertions: number
  failedAssertions: number
  results: EndpointRunResult[]
}

// ─── State ───────────────────────────────────────────────────────

let isRunning = false
let shouldStop = false

// ─── Helpers ─────────────────────────────────────────────────────

function parseJsonSafe<T>(json: string | null, fallback: T): T {
  if (!json) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

function buildRequestFromEndpoint(
  endpoint: endpointRepo.EndpointRow
): HttpRequestOptions | null {
  const schema = parseJsonSafe<{
    method?: string
    url?: string
    params?: KeyValuePair[]
    headers?: KeyValuePair[]
    body?: RequestBody
    auth?: AuthConfig
    timeout?: number
    followRedirects?: boolean
    sslVerification?: boolean
  }>(endpoint.request_schema, {})

  const url = schema.url || endpoint.path
  if (!url) return null

  return {
    method: schema.method || endpoint.method || 'GET',
    url,
    params: schema.params,
    headers: schema.headers,
    body: schema.body as HttpRequestOptions['body'],
    auth: schema.auth as HttpRequestOptions['auth'],
    timeout: schema.timeout ?? 30000,
    followRedirects: schema.followRedirects ?? true,
    sslVerification: schema.sslVerification ?? true
  }
}

function runAssertionsMainProcess(
  assertions: TestAssertion[],
  response: { status?: number; statusText?: string; headers?: Record<string, string>; body?: string; bodySize?: number; timing: ResponseTiming }
): AssertionResult[] {
  return assertions
    .filter((a) => a.enabled)
    .map((assertion) => {
      try {
        switch (assertion.type) {
          case 'status_equals': {
            const expected = Number(assertion.expected)
            const actual = response.status ?? 0
            return { name: assertion.name, passed: actual === expected, actual }
          }
          case 'status_in_range': {
            const actual = response.status ?? 0
            const min = assertion.rangeMin ?? 0
            const max = assertion.rangeMax ?? 999
            return { name: assertion.name, passed: actual >= min && actual <= max, actual }
          }
          case 'body_contains': {
            const body = response.body ?? ''
            const expected = String(assertion.expected ?? '')
            return { name: assertion.name, passed: body.includes(expected), actual: body.length > 100 ? `${body.slice(0, 100)}...` : body }
          }
          case 'header_exists': {
            const headerName = (assertion.headerName ?? '').toLowerCase()
            const headers = response.headers ?? {}
            const found = Object.keys(headers).some((k) => k.toLowerCase() === headerName)
            return { name: assertion.name, passed: found, actual: found ? 'exists' : 'not found' }
          }
          case 'header_equals': {
            const headerName = (assertion.headerName ?? '').toLowerCase()
            const headers = response.headers ?? {}
            const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === headerName)
            const actual = entry ? entry[1] : ''
            const expected = String(assertion.expected ?? '')
            return { name: assertion.name, passed: actual === expected, actual }
          }
          case 'header_contains': {
            const headerName = (assertion.headerName ?? '').toLowerCase()
            const headers = response.headers ?? {}
            const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === headerName)
            const actual = entry ? entry[1] : ''
            const expected = String(assertion.expected ?? '')
            return { name: assertion.name, passed: actual.includes(expected), actual }
          }
          case 'response_time_under': {
            const actual = response.timing.total
            const expected = Number(assertion.expected ?? 0)
            return { name: assertion.name, passed: actual < expected, actual }
          }
          case 'response_size_under': {
            const actual = response.bodySize ?? 0
            const expected = Number(assertion.expected ?? 0)
            return { name: assertion.name, passed: actual < expected, actual }
          }
          case 'custom_script': {
            return { name: assertion.name, passed: true, actual: 'script (skipped in runner)' }
          }
          default:
            return { name: assertion.name, passed: false, error: `Unknown type: ${assertion.type}` }
        }
      } catch (e) {
        return { name: assertion.name, passed: false, error: (e as Error).message }
      }
    })
}

function sendProgress(progress: RunnerProgress): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('runner:progress', progress)
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Variable Resolution ─────────────────────────────────────────

function loadEnvironmentVariables(environmentId?: string, workspaceId?: string): Record<string, string> {
  const vars: Record<string, string> = {}
  const db = getDb()

  // Load global variables
  if (workspaceId) {
    const globals = db.prepare(
      'SELECT key, value FROM global_variables WHERE workspace_id = ? AND enabled = 1'
    ).all(workspaceId) as Array<{ key: string; value: string }>
    for (const g of globals) {
      vars[g.key] = g.value
    }
  }

  // Load environment variables (override globals)
  if (environmentId) {
    const envVars = db.prepare(
      'SELECT key, value FROM environment_variables WHERE environment_id = ? AND enabled = 1'
    ).all(environmentId) as Array<{ key: string; value: string }>
    for (const v of envVars) {
      vars[v.key] = v.value
    }
  }

  return vars
}

function resolveRunnerVariables(template: string, vars: Record<string, string>): string {
  if (!template) return template
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, expression: string) => {
    const trimmed = expression.trim()
    if (trimmed in vars) return vars[trimmed]
    return `{{${trimmed}}}`
  })
}

function resolveRequestOptions(
  options: HttpRequestOptions,
  vars: Record<string, string>
): HttpRequestOptions {
  if (Object.keys(vars).length === 0) return options

  const resolved = { ...options }
  resolved.url = resolveRunnerVariables(resolved.url, vars)

  if (resolved.params) {
    resolved.params = (resolved.params as KeyValuePair[]).map((p) => ({
      ...p,
      key: resolveRunnerVariables(p.key, vars),
      value: resolveRunnerVariables(p.value, vars),
    }))
  }
  if (resolved.headers) {
    resolved.headers = (resolved.headers as KeyValuePair[]).map((h) => ({
      ...h,
      key: resolveRunnerVariables(h.key, vars),
      value: resolveRunnerVariables(h.value, vars),
    }))
  }
  if (resolved.body && (resolved.body as RequestBody).content) {
    resolved.body = {
      ...(resolved.body as RequestBody),
      content: resolveRunnerVariables((resolved.body as RequestBody).content!, vars),
    } as HttpRequestOptions['body']
  }

  return resolved
}

// ─── Runner Execution ────────────────────────────────────────────

async function executeCollection(options: RunnerExecuteOptions): Promise<RunnerReport> {
  isRunning = true
  shouldStop = false

  const startedAt = Date.now()
  const results: EndpointRunResult[] = []
  const total = options.endpointIds.length

  // Load environment variables for interpolation
  const envVars = loadEnvironmentVariables(options.environmentId, options.workspaceId)

  let totalAssertions = 0
  let passedAssertions = 0
  let failedAssertions = 0
  let passedEndpoints = 0
  let failedEndpoints = 0

  for (let i = 0; i < total; i++) {
    if (shouldStop) break

    const endpointId = options.endpointIds[i]
    const endpoint = endpointRepo.getEndpointById(endpointId)

    if (!endpoint) {
      const result: EndpointRunResult = {
        endpointId,
        endpointName: 'Unknown',
        method: 'GET',
        url: '',
        status: null,
        statusText: '',
        duration: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        assertions: [],
        error: 'Endpoint not found'
      }
      results.push(result)
      failedEndpoints++
      sendProgress({ current: i + 1, total, endpointId, result })
      continue
    }

    const requestOptions = buildRequestFromEndpoint(endpoint)

    if (!requestOptions) {
      const result: EndpointRunResult = {
        endpointId,
        endpointName: endpoint.name,
        method: endpoint.method ?? 'GET',
        url: endpoint.path,
        status: null,
        statusText: '',
        duration: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        assertions: [],
        error: 'No URL configured for endpoint'
      }
      results.push(result)
      failedEndpoints++
      sendProgress({ current: i + 1, total, endpointId, result })
      continue
    }

    try {
      // Resolve environment variables in request
      const resolvedOptions = resolveRequestOptions(requestOptions, envVars)
      const response = await executeHttpRequest(resolvedOptions)

      // Auto-save to history
      try {
        historyRepo.addHistory({
          workspace_id: options.workspaceId,
          project_id: options.projectId,
          endpoint_id: endpointId,
          protocol: endpoint.protocol || 'http',
          method: resolvedOptions.method,
          url: resolvedOptions.url,
          status_code: response.status,
          duration_ms: response.timing?.total ? Math.round(response.timing.total) : undefined,
          request_snapshot: JSON.stringify({
            method: resolvedOptions.method,
            url: resolvedOptions.url,
          }),
          response_snapshot: JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            timing: response.timing,
          }),
        })
      } catch {
        // History save failure should not affect runner
      }

      // Parse assertions from request schema
      const schema = parseJsonSafe<{ assertions?: TestAssertion[] }>(endpoint.request_schema, {})
      const assertions = schema.assertions ?? []

      const assertionResults = runAssertionsMainProcess(assertions, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.body,
        bodySize: response.bodySize,
        timing: response.timing
      })

      const passed = assertionResults.filter((a) => a.passed).length
      const failed = assertionResults.filter((a) => !a.passed).length

      totalAssertions += assertionResults.length
      passedAssertions += passed
      failedAssertions += failed

      const endpointPassed = failed === 0 && !response.error
      if (endpointPassed) passedEndpoints++
      else failedEndpoints++

      const result: EndpointRunResult = {
        endpointId,
        endpointName: endpoint.name,
        method: requestOptions.method,
        url: requestOptions.url,
        status: response.status ?? null,
        statusText: response.statusText ?? '',
        duration: response.timing.total,
        passed,
        failed,
        skipped: 0,
        assertions: assertionResults,
        error: response.error,
        responseSize: response.bodySize ?? 0,
        responseBody: response.body ?? undefined,
        responseHeaders: response.headers ?? undefined,
      }

      results.push(result)
      sendProgress({ current: i + 1, total, endpointId, result })
    } catch (e) {
      const result: EndpointRunResult = {
        endpointId,
        endpointName: endpoint.name,
        method: requestOptions.method,
        url: requestOptions.url,
        status: null,
        statusText: '',
        duration: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        assertions: [],
        error: (e as Error).message
      }
      results.push(result)
      failedEndpoints++
      sendProgress({ current: i + 1, total, endpointId, result })
    }

    // Delay between requests if configured
    if (options.delay && options.delay > 0 && i < total - 1 && !shouldStop) {
      await delay(options.delay)
    }
  }

  isRunning = false

  const completedAt = Date.now()
  const durationMs = completedAt - startedAt
  const avgRespTime = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.duration, 0) / results.length)
    : 0

  // Save to runner_history
  try {
    const db = getDb()
    const { randomUUID } = require('crypto')
    db.prepare(`
      INSERT INTO runner_history (id, project_id, environment_name, source, iterations, duration_ms,
        total_endpoints, passed_endpoints, failed_endpoints, total_tests, passed_tests, failed_tests,
        skipped_tests, avg_resp_time, results_json, started_at, folder_name, source_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      options.projectId,
      options.environmentId || null,
      options.source || 'Runner',
      1,
      durationMs,
      results.length,
      passedEndpoints,
      failedEndpoints,
      totalAssertions,
      passedAssertions,
      failedAssertions,
      0,
      avgRespTime,
      JSON.stringify(results),
      startedAt,
      options.folderName || null,
      options.sourceLabel || null
    )
  } catch {
    // History save failure should not affect runner
  }

  return {
    projectId: options.projectId,
    startedAt,
    completedAt,
    totalEndpoints: results.length,
    passedEndpoints,
    failedEndpoints,
    totalAssertions,
    passedAssertions,
    failedAssertions,
    results
  }
}

// ─── Export Helpers ───────────────────────────────────────────────

function exportAsJson(results: EndpointRunResult[]): string {
  return JSON.stringify(results, null, 2)
}

function exportAsHtml(results: EndpointRunResult[]): string {
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0)
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0)
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)
  const endpointsPassed = results.filter((r) => r.failed === 0 && !r.error).length
  const endpointsFailed = results.length - endpointsPassed

  const escapeHtml = (str: string): string =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const rows = results.map((r) => {
    const statusColor = r.error ? '#cc2200' : (r.failed > 0 ? '#b35a00' : '#1a7a4a')
    const statusBg = r.error ? '#fff0f0' : (r.failed > 0 ? '#fff4e0' : '#e8f9f1')
    const statusText = r.error ? 'Error' : (r.failed > 0 ? 'Failed' : 'Passed')

    const assertionRows = r.assertions.map((a) => {
      const aColor = a.passed ? '#1a7a4a' : '#cc2200'
      const aIcon = a.passed ? '&#10003;' : '&#10007;'
      return `<tr><td style="padding:4px 12px;color:${aColor}">${aIcon} ${escapeHtml(a.name)}</td><td style="padding:4px 12px">${a.actual !== undefined ? escapeHtml(String(a.actual)) : ''}</td><td style="padding:4px 12px;color:${aColor}">${a.error ? escapeHtml(a.error) : ''}</td></tr>`
    }).join('')

    return `
      <div style="margin-bottom:16px;border:1px solid #e8e8ed;border-radius:8px;overflow:hidden">
        <div style="display:flex;align-items:center;padding:12px 16px;background:${statusBg};gap:12px">
          <span style="font-weight:600;color:${statusColor};min-width:60px">${escapeHtml(r.method)}</span>
          <span style="flex:1;font-family:monospace;font-size:13px">${escapeHtml(r.url)}</span>
          <span style="font-size:13px;color:#888">${r.duration}ms</span>
          <span style="padding:2px 8px;border-radius:4px;background:${statusColor};color:white;font-size:12px;font-weight:600">${r.status ?? '-'} ${statusText}</span>
        </div>
        ${r.assertions.length > 0 ? `<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#fafafa;border-top:1px solid #e8e8ed"><th style="padding:6px 12px;text-align:left">Assertion</th><th style="padding:6px 12px;text-align:left">Actual</th><th style="padding:6px 12px;text-align:left">Error</th></tr></thead><tbody>${assertionRows}</tbody></table>` : ''}
        ${r.error ? `<div style="padding:8px 16px;color:#cc2200;font-size:13px;border-top:1px solid #e8e8ed">${escapeHtml(r.error)}</div>` : ''}
      </div>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Apinizer API Tester - Collection Run Report</title>
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
    <h1 style="margin:0;font-size:20px;color:#2D5FA0">Apinizer API Tester</h1>
    <h2 style="margin:8px 0 0;font-size:16px;font-weight:500">Collection Run Report</h2>
    <p style="margin:8px 0 0;font-size:13px;color:#888">Generated: ${new Date().toISOString()}</p>
    <div class="stats">
      <div class="stat"><div class="stat-value" style="color:#1a7a4a">${endpointsPassed}</div><div class="stat-label">Passed</div></div>
      <div class="stat"><div class="stat-value" style="color:#cc2200">${endpointsFailed}</div><div class="stat-label">Failed</div></div>
      <div class="stat"><div class="stat-value">${results.length}</div><div class="stat-label">Total</div></div>
      <div class="stat"><div class="stat-value" style="color:#0066cc">${totalDuration}ms</div><div class="stat-label">Duration</div></div>
      <div class="stat"><div class="stat-value" style="color:#1a7a4a">${totalPassed}</div><div class="stat-label">Assertions Passed</div></div>
      <div class="stat"><div class="stat-value" style="color:#cc2200">${totalFailed}</div><div class="stat-label">Assertions Failed</div></div>
    </div>
  </div>
  ${rows}
</body>
</html>`
}

// ─── Public API for scheduler ─────────────────────────────────────

export async function executeCollectionForScheduler(options: RunnerExecuteOptions): Promise<RunnerReport> {
  return executeCollection({ ...options, source: 'Scheduler' })
}

// ─── Register Handlers ───────────────────────────────────────────

export function registerRunnerHandlers(): void {
  ipcMain.handle('runner:execute', async (_event, options: RunnerExecuteOptions) => {
    try {
      if (isRunning) {
        return { success: false, error: 'A collection run is already in progress' }
      }
      const report = await executeCollection(options)
      return { success: true, data: report }
    } catch (e) {
      isRunning = false
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('runner:stop', async () => {
    try {
      if (!isRunning) {
        return { success: true, data: false }
      }
      shouldStop = true
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('runner:export', async (_event, options: RunnerExportOptions) => {
    try {
      let content: string
      if (options.format === 'html') {
        content = exportAsHtml(options.results)
      } else {
        content = exportAsJson(options.results)
      }
      return { success: true, data: content }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('runner:history', async (_event, arg: string | { projectId: string; limit?: number; offset?: number; tab?: 'Functional' | 'Scheduled' }) => {
    try {
      const db = getDb()

      // Backward-compatible: accept plain projectId string
      if (typeof arg === 'string') {
        const rows = db.prepare(
          'SELECT * FROM runner_history WHERE project_id = ? ORDER BY started_at DESC LIMIT 100'
        ).all(arg)
        return { success: true, data: rows }
      }

      const { projectId, limit = 20, offset = 0, tab } = arg
      const sourceFilter = tab === 'Scheduled' ? "source = 'Scheduler'" : tab === 'Functional' ? "source != 'Scheduler'" : '1=1'

      const rows = db.prepare(
        `SELECT * FROM runner_history WHERE project_id = ? AND ${sourceFilter} ORDER BY started_at DESC LIMIT ? OFFSET ?`
      ).all(projectId, limit, offset)

      const totalRow = db.prepare(
        `SELECT COUNT(*) as n FROM runner_history WHERE project_id = ? AND ${sourceFilter}`
      ).get(projectId) as { n: number }

      return { success: true, data: { rows, total: totalRow.n } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('runner:historyStats', async (_event, projectId: string) => {
    try {
      const db = getDb()
      const row = db.prepare(
        `SELECT
           COUNT(*) as runs,
           COALESCE(SUM(total_endpoints), 0) as totalEndpoints,
           COALESCE(SUM(passed_endpoints), 0) as passedEndpoints,
           COALESCE(SUM(failed_endpoints), 0) as failedEndpoints
         FROM runner_history WHERE project_id = ?`
      ).get(projectId) as { runs: number; totalEndpoints: number; passedEndpoints: number; failedEndpoints: number }
      return { success: true, data: row }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('runner:deleteHistory', async (_event, ids: string | string[]) => {
    try {
      const db = getDb()
      const idList = Array.isArray(ids) ? ids : [ids]
      const placeholders = idList.map(() => '?').join(',')
      db.prepare(`DELETE FROM runner_history WHERE id IN (${placeholders})`).run(...idList)
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
