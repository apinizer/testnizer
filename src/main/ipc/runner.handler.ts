// src/main/ipc/runner.handler.ts
// Apinizer API Tester — Collection Runner IPC Handler

import { ipcMain, BrowserWindow } from 'electron'
import { executeHttpRequest, HttpRequestOptions } from '../protocols/http.engine'
import * as endpointRepo from '../db/endpoint.repo'

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
  delay?: number
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

// ─── Runner Execution ────────────────────────────────────────────

async function executeCollection(options: RunnerExecuteOptions): Promise<RunnerReport> {
  isRunning = true
  shouldStop = false

  const startedAt = Date.now()
  const results: EndpointRunResult[] = []
  const total = options.endpointIds.length

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
      const response = await executeHttpRequest(requestOptions)

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
        error: response.error
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

  return {
    projectId: options.projectId,
    startedAt,
    completedAt: Date.now(),
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
    <h1 style="margin:0;font-size:20px;color:#7c73e6">Apinizer API Tester</h1>
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
}
