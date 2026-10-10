/**
 * Issue #141 — `mcp:oauth:*` IPC handlers: envelope shape, option
 * sanitising, step / done broadcast to every window, http(s)-only browser
 * opening, and that nothing secret reaches the console log.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock } from './helpers'
import type {
  McpOAuthDone,
  McpOAuthHooks,
  McpOAuthStartOptions,
} from '../../../src/main/protocols/mcp-oauth.engine'

let consoleEntries: unknown[] = []
let sentEvents: Array<{ channel: string; payload: unknown }> = []

const harness = setupHandlerHarness()
const openExternal = vi.fn(async (_url: string) => undefined)
vi.mock('electron', () => ({
  ...makeElectronMock(),
  shell: { openExternal: (url: string) => openExternal(url) },
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

/** What the handler handed the engine on the last start. */
let lastStart: { options: McpOAuthStartOptions; hooks: McpOAuthHooks } | null = null
let resolveFinished: ((done: McpOAuthDone) => void) | null = null
let startThrows: string | null = null

vi.mock('../../../src/main/protocols/mcp-oauth.engine', () => ({
  mcpOAuthStart: vi.fn((options: McpOAuthStartOptions, hooks: McpOAuthHooks) => {
    if (startThrows) throw new Error(startThrows)
    lastStart = { options, hooks }
    const finished = new Promise<McpOAuthDone>((resolve) => {
      resolveFinished = resolve
    })
    return { oauthSessionId: 'mcp-oauth-1', finished }
  }),
  mcpOAuthCancel: vi.fn((id: string) => id === 'mcp-oauth-1'),
  mcpOAuthForget: vi.fn((id: string) => id === 'mcp-oauth-1'),
}))

const { registerMcpOAuthHandlers } = await import('../../../src/main/ipc/mcp-oauth.handler')
const engine = await import('../../../src/main/protocols/mcp-oauth.engine')

beforeEach(() => {
  harness.reset()
  consoleEntries = []
  sentEvents = []
  lastStart = null
  resolveFinished = null
  startThrows = null
  openExternal.mockClear()
  vi.mocked(engine.mcpOAuthStart).mockClear()
  registerMcpOAuthHandlers()
})

describe('mcp:oauth:start', () => {
  it('returns { oauthSessionId } at once and passes sanitised options', async () => {
    const res = await harness.invoke('mcp:oauth:start', {
      url: ' http://srv.local/mcp ',
      transport: 'sse',
      headers: { 'X-A': '1', Bad: 42 },
      clientId: 'cid',
      clientSecret: 'shh-secret-141',
      scope: '',
      callbackPort: 33418,
      junk: 'ignored',
    })
    expect(res).toEqual({ success: true, data: { oauthSessionId: 'mcp-oauth-1' } })
    expect(lastStart?.options).toEqual({
      url: 'http://srv.local/mcp',
      transport: 'sse',
      headers: { 'X-A': '1' },
      clientId: 'cid',
      clientSecret: 'shh-secret-141',
      callbackPort: 33418,
    })
    expect(JSON.stringify(consoleEntries)).not.toContain('shh-secret-141')
  })

  it('issue #170: the plain-HTTP authorization server opt-in passes only for a literal true', async () => {
    await harness.invoke('mcp:oauth:start', {
      url: 'http://srv.local/mcp',
      allowHttpAuthServer: true,
    })
    expect(lastStart?.options.allowHttpAuthServer).toBe(true)
    for (const value of ['true', 1, {}, false, undefined]) {
      await harness.invoke('mcp:oauth:start', {
        url: 'http://srv.local/mcp',
        allowHttpAuthServer: value,
      })
      expect(lastStart?.options).not.toHaveProperty('allowHttpAuthServer')
    }
  })

  it('error envelope for a missing url or an engine refusal', async () => {
    expect(await harness.invoke('mcp:oauth:start', {})).toMatchObject({
      success: false,
      error: expect.stringMatching(/URL is required/),
    })
    expect(await harness.invoke('mcp:oauth:start', null)).toMatchObject({ success: false })
    startThrows = 'OAuth applies to http(s) MCP servers only'
    expect(await harness.invoke('mcp:oauth:start', { url: 'ftp://x' })).toEqual({
      success: false,
      error: 'OAuth applies to http(s) MCP servers only',
    })
  })

  it('broadcasts step and done events to every window', async () => {
    await harness.invoke('mcp:oauth:start', { url: 'http://srv.local/mcp' })
    const step = {
      id: 'probe',
      index: 1,
      title: 'Unauthenticated probe',
      status: 'passed',
    } as const
    lastStart?.hooks.onStep?.('mcp-oauth-1', step)
    const done: McpOAuthDone = { oauthSessionId: 'mcp-oauth-1', ok: true, noAuthRequired: true }
    lastStart?.hooks.onDone?.(done)
    resolveFinished?.(done)
    await new Promise((r) => setTimeout(r, 0))
    expect(sentEvents).toEqual([
      { channel: 'mcp:oauth:step', payload: { oauthSessionId: 'mcp-oauth-1', step } },
      { channel: 'mcp:oauth:done', payload: done },
    ])
    expect(JSON.stringify(consoleEntries)).toContain('does not require authorization')
  })

  it('opens only http(s) authorization URLs in the system browser', async () => {
    await harness.invoke('mcp:oauth:start', { url: 'http://srv.local/mcp' })
    await lastStart?.hooks.openUrl('https://as.example/authorize?x=1')
    expect(openExternal).toHaveBeenCalledWith('https://as.example/authorize?x=1')
    await expect(Promise.resolve(lastStart?.hooks.openUrl('file:///etc/passwd'))).rejects.toThrow(
      /non-http/,
    )
    expect(openExternal).toHaveBeenCalledTimes(1)
  })
})

describe('mcp:oauth:cancel / forget', () => {
  it('cancel reports whether a flow was running', async () => {
    expect(await harness.invoke('mcp:oauth:cancel', 'mcp-oauth-1')).toEqual({
      success: true,
      data: { cancelled: true },
    })
    expect(await harness.invoke('mcp:oauth:cancel', 'other')).toEqual({
      success: true,
      data: { cancelled: false },
    })
    expect(await harness.invoke('mcp:oauth:cancel', 42)).toMatchObject({ success: false })
  })

  it('forget reports whether anything was dropped', async () => {
    expect(await harness.invoke('mcp:oauth:forget', 'mcp-oauth-1')).toEqual({
      success: true,
      data: { forgotten: true },
    })
    expect(await harness.invoke('mcp:oauth:forget', undefined)).toMatchObject({ success: false })
  })
})
