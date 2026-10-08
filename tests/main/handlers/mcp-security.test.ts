/**
 * Issue #142 — `mcp:security:*` IPC handlers: envelope shape, request
 * sanitising, progress / finding / done broadcast to every window, cancel,
 * the redacted `done` report, a console log without header values, and the
 * self-contained HTML export (real generator, not mocked).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock } from './helpers'
import type {
  McpSecurityFinding,
  McpSecurityReport,
  McpSecurityScanInput,
} from '../../../src/main/protocols/mcp-security.engine'

const RAW_TOKEN = 'Bearer raw-secret-token-142'
const API_KEY = 'xak-raw-api-key-142'

let consoleEntries: unknown[] = []
let sentEvents: Array<{ channel: string; payload: unknown }> = []

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => {
            if (channel === 'console:log') consoleEntries.push(payload)
            else sentEvents.push({ channel, payload })
          },
        },
      },
    ],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

/** What the handler handed the engine on the last scan. */
let lastInput: McpSecurityScanInput | null = null
let settle: { resolve: (r: McpSecurityReport) => void; reject: (e: Error) => void } | null = null

vi.mock('../../../src/main/protocols/mcp-security.engine', () => ({
  runMcpSecurityScan: vi.fn(
    (input: McpSecurityScanInput) =>
      new Promise<McpSecurityReport>((resolve, reject) => {
        lastInput = input
        settle = { resolve, reject }
      }),
  ),
}))

const { registerMcpSecurityHandlers } = await import('../../../src/main/ipc/mcp-security.handler')
const engine = await import('../../../src/main/protocols/mcp-security.engine')

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

function finding(over: Partial<McpSecurityFinding> = {}): McpSecurityFinding {
  return {
    id: 'cors.cors_wildcard_with_credentials',
    category: 'cors',
    title: 'CORS policy',
    severity: 'high',
    status: 'fail',
    detail: 'Wildcard origin with credentials.',
    recommendation: 'Send no CORS headers.',
    refs: ['https://fetch.spec.whatwg.org/#http-cors-protocol', 'javascript:alert(1)'],
    evidence: {
      request: {
        method: 'OPTIONS',
        url: 'https://srv.test/mcp',
        headers: { authorization: RAW_TOKEN, 'x-api-key': API_KEY, origin: 'https://evil.example' },
      },
      response: {
        status: 204,
        headers: { 'access-control-allow-origin': '*' },
        bodyPreview: '<script>alert(1)</script>',
      },
    },
    ...over,
  }
}

function report(over: Partial<McpSecurityReport> = {}): McpSecurityReport {
  const findings = [
    finding(),
    finding({
      id: 'transport.https',
      category: 'transport',
      title: 'HTTPS',
      severity: 'info',
      status: 'pass',
      detail: 'Reached over HTTPS.',
      evidence: undefined,
      refs: undefined,
      recommendation: undefined,
    }),
  ]
  return {
    id: 'mcp-scan-x',
    startedAt: Date.UTC(2026, 9, 7, 12, 0, 0),
    finishedAt: Date.UTC(2026, 9, 7, 12, 0, 5),
    target: { url: 'https://srv.test/mcp', transport: 'http', host: 'srv.test', scheme: 'https' },
    grade: 'B',
    score: 85,
    categories: [
      { id: 'transport', title: 'Transport security', score: 100, findings: [findings[1]] },
      { id: 'cors', title: 'CORS', score: 85, findings: [findings[0]] },
    ],
    summary: { pass: 1, warn: 0, fail: 1, info: 0, skipped: 0 },
    serverInfo: { name: 'srv', version: '1.0.0', protocolVersion: '2025-11-25', capabilities: {} },
    ...over,
  }
}

beforeEach(() => {
  harness.reset()
  consoleEntries = []
  sentEvents = []
  lastInput = null
  settle = null
  vi.mocked(engine.runMcpSecurityScan).mockClear()
  registerMcpSecurityHandlers()
})

describe('mcp:security:scan', () => {
  it('returns { scanId } at once and hands the engine a sanitised request', async () => {
    const res = (await harness.invoke('mcp:security:scan', {
      url: ' https://srv.test/mcp ',
      transport: 'sse',
      headers: { Authorization: RAW_TOKEN, 'X-API-Key': API_KEY, Bad: 42 },
      oauthSessionId: 'mcp-oauth-7',
      options: { rateLimitProbe: true, toolInvocationProbe: true, timeoutMs: 999_999 },
      junk: 'ignored',
    })) as { success: boolean; data: { scanId: string } }
    expect(res.success).toBe(true)
    expect(res.data.scanId).toMatch(/^mcp-scan-/)
    // The engine starts one macrotask later (the reply must win the race).
    expect(engine.runMcpSecurityScan).not.toHaveBeenCalled()
    await tick()
    expect(lastInput).toMatchObject({
      url: 'https://srv.test/mcp',
      transport: 'sse',
      headers: { Authorization: RAW_TOKEN, 'X-API-Key': API_KEY },
      oauthSessionId: 'mcp-oauth-7',
      options: { rateLimitProbe: true, toolInvocationProbe: true, timeoutMs: 60_000 },
      scanId: res.data.scanId,
    })
    expect(lastInput?.headers).not.toHaveProperty('Bad')
    expect(lastInput?.signal?.aborted).toBe(false)
  })

  it('defaults: http transport, probe off, no timeout override', async () => {
    await harness.invoke('mcp:security:scan', { url: 'http://127.0.0.1:1/mcp', options: {} })
    await tick()
    expect(lastInput?.transport).toBe('http')
    expect(lastInput?.options).toEqual({ rateLimitProbe: false, toolInvocationProbe: false })
    expect(lastInput?.oauthSessionId).toBeUndefined()
  })

  it('error envelope for a missing / invalid / non-http url', async () => {
    expect(await harness.invoke('mcp:security:scan', {})).toMatchObject({
      success: false,
      error: expect.stringMatching(/URL is required/),
    })
    expect(await harness.invoke('mcp:security:scan', null)).toMatchObject({ success: false })
    expect(await harness.invoke('mcp:security:scan', { url: 'not a url' })).toMatchObject({
      success: false,
      error: expect.stringMatching(/Invalid MCP server URL/),
    })
    expect(await harness.invoke('mcp:security:scan', { url: 'ftp://x/y' })).toMatchObject({
      success: false,
      error: expect.stringMatching(/http\(s\)/),
    })
    await tick()
    expect(engine.runMcpSecurityScan).not.toHaveBeenCalled()
  })

  it('broadcasts progress, findings and a redacted done report; logs without header values', async () => {
    const res = (await harness.invoke('mcp:security:scan', {
      url: 'https://srv.test/mcp',
      headers: { Authorization: RAW_TOKEN, 'X-API-Key': API_KEY },
      options: { rateLimitProbe: false },
    })) as { data: { scanId: string } }
    const scanId = res.data.scanId
    await tick()
    lastInput?.onProgress?.({ done: 1, total: 29, current: 'HTTPS' })
    lastInput?.onFinding?.(finding({ status: 'pass', evidence: undefined }))
    settle?.resolve(report())
    await tick()

    expect(sentEvents.map((e) => e.channel)).toEqual([
      'mcp:security:progress',
      'mcp:security:finding',
      'mcp:security:done',
    ])
    expect(sentEvents[0].payload).toEqual({ scanId, done: 1, total: 29, current: 'HTTPS' })
    expect(sentEvents[1].payload).toMatchObject({ scanId, finding: { status: 'pass' } })
    const done = sentEvents[2].payload as { scanId: string; report: McpSecurityReport }
    expect(done.scanId).toBe(scanId)
    expect(done.report.grade).toBe('B')
    const evidence = done.report.categories[1].findings[0].evidence
    expect(evidence?.request?.headers.authorization).toBe('Bearer ••••')
    expect(evidence?.request?.headers['x-api-key']).toBe('••••')
    expect(JSON.stringify(sentEvents)).not.toContain('raw-secret-token-142')
    expect(JSON.stringify(sentEvents)).not.toContain(API_KEY)

    const log = JSON.stringify(consoleEntries)
    expect(log).toContain('MCP security scan started')
    expect(log).toContain('grade B')
    expect(log).not.toContain('raw-secret-token-142')
    expect(log).not.toContain(API_KEY)
  })

  it('a credential in the URL query never reaches the console log', async () => {
    await harness.invoke('mcp:security:scan', {
      url: 'https://srv.test/mcp?api_key=url-secret-142',
    })
    await tick()
    settle?.resolve(report())
    await tick()
    const log = JSON.stringify(consoleEntries)
    expect(log).toContain('srv.test/mcp')
    expect(log).not.toContain('url-secret-142')
  })

  it('an engine failure ends with done { scanId, error }', async () => {
    const res = (await harness.invoke('mcp:security:scan', { url: 'http://srv.test/mcp' })) as {
      data: { scanId: string }
    }
    await tick()
    settle?.reject(new Error('boom'))
    await tick()
    expect(sentEvents).toEqual([
      { channel: 'mcp:security:done', payload: { scanId: res.data.scanId, error: 'boom' } },
    ])
  })
})

describe('mcp:security:cancel', () => {
  it('aborts the running scan and reports whether one was found', async () => {
    const res = (await harness.invoke('mcp:security:scan', { url: 'http://srv.test/mcp' })) as {
      data: { scanId: string }
    }
    await tick()
    expect(await harness.invoke('mcp:security:cancel', res.data.scanId)).toEqual({
      success: true,
      data: { cancelled: true },
    })
    expect(lastInput?.signal?.aborted).toBe(true)
    expect(await harness.invoke('mcp:security:cancel', 'other')).toEqual({
      success: true,
      data: { cancelled: false },
    })
    expect(await harness.invoke('mcp:security:cancel', 42)).toMatchObject({ success: false })
    // Once finished the scan is forgotten.
    settle?.resolve(report({ cancelled: true, truncated: true }))
    await tick()
    expect(await harness.invoke('mcp:security:cancel', res.data.scanId)).toEqual({
      success: true,
      data: { cancelled: false },
    })
  })
})

describe('mcp:security:exportHtml', () => {
  it('renders grade, every finding title, the disclaimer and the timestamp — no credentials', async () => {
    const r = report()
    const res = (await harness.invoke('mcp:security:exportHtml', r)) as {
      success: boolean
      data: { html: string }
    }
    expect(res.success).toBe(true)
    const html = res.data.html
    expect(html).toMatch(/^<!DOCTYPE html>/)
    expect(html).toContain('data-role="grade"')
    expect(html).toMatch(/data-role="grade"[^>]*>B</)
    expect(html).toContain('85/100')
    for (const f of r.categories.flatMap((c) => c.findings)) expect(html).toContain(f.title)
    expect(html).toContain('Scan only servers you are authorized to test.')
    expect(html).toContain(
      'Active probes (a ~30-request rate-limit burst, and calls without arguments to argument-free tools annotated read-only, or unannotated tools whose name does not look like a write',
    )
    expect(html).toContain('2026-10-07T12:00:00.000Z')
    expect(html).not.toContain('raw-secret-token-142')
    expect(html).not.toContain(API_KEY)
    expect(html).toContain('authorization: Bearer ••••')
    // Attacker-influenced text is escaped; only http(s) refs become links.
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('href="https://fetch.spec.whatwg.org/#http-cors-protocol"')
    expect(html).not.toContain('javascript:alert')
  })

  it('error envelope for something that is not a report', async () => {
    expect(await harness.invoke('mcp:security:exportHtml', { nope: true })).toMatchObject({
      success: false,
      error: expect.stringMatching(/Not a security scan report/),
    })
    expect(await harness.invoke('mcp:security:exportHtml', null)).toMatchObject({ success: false })
  })
})
