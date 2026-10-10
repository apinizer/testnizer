/**
 * Issue #180 — `aichat:*` tool IPC: an untrusted stdio server is never spawned
 * by Send and Send never records trust; "Trust and connect"
 * (`aichat:resolveStdioTrust`) records it for the command MAIN holds; the
 * approval card's answer (`aichat:approveTool`) reaches the loop; Stop
 * (`aichat:cancel`) aborts a running tool call.
 */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock } from './helpers'

const harness = setupHandlerHarness()

const wire = vi.hoisted(() => ({
  sent: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
}))

vi.mock('electron', () => {
  const win = {
    id: 1,
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: Record<string, unknown>) => {
        wire.sent.push({ channel, payload })
      },
    },
  }
  return {
    ...makeElectronMock(),
    BrowserWindow: {
      getFocusedWindow: () => null,
      getAllWindows: () => [],
      fromWebContents: () => win,
      fromId: () => win,
    },
  }
})

vi.mock('../../../src/main/lib/console-logger', () => ({
  logRequestResponse: () => {},
  logEvent: () => {},
}))

const { registerAiChatHandlers, setAiLoopDepsForTests, isFullMainFrameNavigation } =
  await import('../../../src/main/ipc/ai-chat.handler')
const { setStdioTrustStoreForTests, STDIO_TRUST_STORE_KEY, stdioTrustKey, isStdioServerTrusted } =
  await import('../../../src/main/lib/mcp-stdio-trust')

function memoryStore(): {
  data: Record<string, unknown>
  get(k: string): unknown
  set(k: string, v: unknown): void
} {
  const data: Record<string, unknown> = {}
  return { data, get: (k) => data[k], set: (k, v) => void (data[k] = v) }
}

const until = async (pred: () => boolean, ms = 2000): Promise<void> => {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const events = (kind: string): Array<Record<string, unknown>> =>
  wire.sent
    .filter((e) => e.channel === 'aichat:event' && e.payload.kind === kind)
    .map((e) => e.payload)

const stdioServer = {
  id: 'local',
  name: 'Local',
  connect: {
    transport: 'stdio',
    url: 'node server.js',
    command: 'node',
    args: ['server.js'],
    env: { MODE: 'x' },
    protocol: 'auto',
  },
  disabledTools: [],
}
const httpServer = {
  id: 'w',
  name: 'Weather',
  connect: { transport: 'http', url: 'http://127.0.0.1:1/mcp', protocol: 'auto' },
  disabledTools: [],
}

let store: ReturnType<typeof memoryStore>
let openSession: ReturnType<typeof vi.fn>
let callTool: ReturnType<typeof vi.fn>
let round = 0

beforeEach(() => {
  harness.reset()
  registerAiChatHandlers()
  wire.sent.length = 0
  store = memoryStore()
  setStdioTrustStoreForTests(store)
  round = 0
  openSession = vi.fn(async () => ({
    connectionId: 'c',
    tools: [{ name: 'get', inputSchema: { type: 'object' } }],
  }))
  callTool = vi.fn(async () => ({ result: { content: [{ type: 'text', text: 'ok' }] } }))
  setAiLoopDepsForTests({
    openSession,
    callTool,
    closeSession: vi.fn(async () => {}),
    streamRound: async function* () {
      round++
      if (round === 1) {
        yield {
          type: 'end' as const,
          toolCalls: [{ id: 'call1', name: 'Weather__get', argsJson: '{}' }],
          usage: null,
          stopReason: 'tool_calls',
          firstContentAt: null,
          status: 200,
        }
        return
      }
      yield { type: 'text' as const, delta: 'final' }
      yield {
        type: 'end' as const,
        toolCalls: [],
        usage: null,
        stopReason: 'stop',
        firstContentAt: null,
        status: 200,
      }
    },
  })
})

afterEach(() => {
  setAiLoopDepsForTests(null)
  setStdioTrustStoreForTests(undefined)
})

const send = async (servers: unknown[], extra: Record<string, unknown> = {}): Promise<string> => {
  const res = (await harness.invoke('aichat:send', {
    provider: 'openai',
    model: 'm',
    prompt: 'go',
    history: [],
    tools: { projectId: 'p1', servers, autoApprove: false, allowedTools: [], ...extra },
  })) as { success: boolean; data: { messageId: string } }
  expect(res.success).toBe(true)
  return res.data.messageId
}

describe('untrusted stdio server', () => {
  it('Send does not spawn it and does not record trust; Skip continues without it', async () => {
    const id = await send([stdioServer])
    await until(() =>
      events('part').some((e) => (e.part as { kind?: string }).kind === 'stdio-untrusted'),
    )
    expect(openSession).not.toHaveBeenCalled()
    expect(store.data[STDIO_TRUST_STORE_KEY]).toBeUndefined()

    await harness.invoke('aichat:resolveStdioTrust', id, 'local', 'skip')
    await until(() => wire.sent.some((e) => e.channel === 'aichat:done'))
    expect(openSession).not.toHaveBeenCalled()
    expect(store.data[STDIO_TRUST_STORE_KEY]).toBeUndefined()
  })

  it('"Trust and connect" records trust (main-held command) and then connects', async () => {
    const id = await send([stdioServer])
    await until(() => events('part').length > 0)
    const res = (await harness.invoke('aichat:resolveStdioTrust', id, 'local', 'trust')) as {
      data: { applied: boolean }
    }
    expect(res.data.applied).toBe(true)
    await until(() => openSession.mock.calls.length === 1)
    expect(Object.keys(store.data[STDIO_TRUST_STORE_KEY] as object)).toHaveLength(1)
  })
})

describe('approval over IPC', () => {
  it('deny reaches the loop: the tool is not called, the model gets the denial', async () => {
    const id = await send([httpServer])
    await until(() =>
      events('part').some((e) => (e.part as { status?: string }).status === 'pending-approval'),
    )
    await harness.invoke('aichat:approveTool', id, 'call1', 'deny')
    await until(() => wire.sent.some((e) => e.channel === 'aichat:done'))
    expect(callTool).not.toHaveBeenCalled()
    const result = events('part').find((e) => (e.part as { type: string }).type === 'tool_result')
    expect(result?.part).toMatchObject({
      callId: 'call1',
      isError: true,
      content: 'The user denied this tool call.',
    })
  })

  it('an unknown decision string is treated as deny', async () => {
    const id = await send([httpServer])
    await until(() =>
      events('part').some((e) => (e.part as { status?: string }).status === 'pending-approval'),
    )
    await harness.invoke('aichat:approveTool', id, 'call1', 'yes-please')
    await until(() => wire.sent.some((e) => e.channel === 'aichat:done'))
    expect(callTool).not.toHaveBeenCalled()
  })

  it('Stop while the tool runs aborts it', async () => {
    let aborted = false
    callTool.mockImplementation(
      (_c: string, _n: string, _a: unknown, o: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          o.signal.addEventListener('abort', () => {
            aborted = true
            resolve({ cancelled: true, error: 'cancelled' })
          })
        }),
    )
    const id = await send([httpServer], { autoApprove: true })
    await until(() => callTool.mock.calls.length === 1)
    const res = (await harness.invoke('aichat:cancel', id)) as { data: { cancelled: boolean } }
    expect(res.data.cancelled).toBe(true)
    await until(() => wire.sent.some((e) => e.channel === 'aichat:cancelled'))
    expect(aborted).toBe(true)
  })
})

describe('no servers', () => {
  it('a Send without tools never opens a session (MST-153)', async () => {
    const res = (await harness.invoke('aichat:send', {
      provider: 'openai',
      model: 'm',
      prompt: 'hi',
      history: [],
    })) as { success: boolean }
    expect(res.success).toBe(true)
    await until(() => wire.sent.some((e) => e.channel === 'aichat:done'))
    expect(openSession).not.toHaveBeenCalled()
  })
})

describe('aichat:listServerTools (Tools tab "Load tools")', () => {
  it('an untrusted stdio server is not spawned: masked command line + env card, trust untouched', async () => {
    const secretServer = {
      ...stdioServer,
      connect: {
        ...stdioServer.connect,
        args: ['server.js', '--token', 'SECRET-TOK'],
        env: { API_KEY: 'v-SECRET', NODE_OPTIONS: '--require ./evil.js', MODE: 'x' },
      },
    }
    const res = (await harness.invoke('aichat:listServerTools', secretServer, {
      projectId: 'p1',
    })) as {
      success: boolean
      data: {
        untrusted?: {
          commandLine: string
          envNames: string[]
          env: Array<Record<string, unknown>>
          trustToken: string
        }
      }
    }
    expect(res.success).toBe(true)
    const card = res.data.untrusted!
    expect(card.commandLine).toBe('node server.js --token ***')
    expect(card.envNames).toEqual(['API_KEY', 'NODE_OPTIONS', 'MODE'])
    // Trust covers the values: shown, except a credential-named one; danger flagged.
    expect(card.env).toEqual([
      { name: 'API_KEY', value: '••••••', masked: true },
      { name: 'NODE_OPTIONS', value: '--require ./evil.js', dangerous: true },
      { name: 'MODE', value: 'x' },
    ])
    expect(JSON.stringify(card)).not.toContain('v-SECRET')
    expect(typeof card.trustToken).toBe('string')
    expect(openSession).not.toHaveBeenCalled()
    expect(store.data[STDIO_TRUST_STORE_KEY]).toBeUndefined()
  })

  it('a renderer "trust: true" flag no longer records trust (only the card token does)', async () => {
    const res = (await harness.invoke('aichat:listServerTools', stdioServer, {
      projectId: 'p1',
      trust: true,
    })) as { data: { untrusted?: unknown; tools?: unknown } }
    expect(res.data.untrusted).toBeDefined()
    expect(res.data.tools).toBeUndefined()
    expect(store.data[STDIO_TRUST_STORE_KEY]).toBeUndefined()
    expect(openSession).not.toHaveBeenCalled()
  })

  it('"Trust and connect" trusts and connects EXACTLY the subject the card showed, once', async () => {
    const shown = (await harness.invoke('aichat:listServerTools', stdioServer, {
      projectId: 'p1',
    })) as { data: { untrusted: { trustToken: string } } }
    const token = shown.data.untrusted.trustToken

    // The user edits the row (or switches environment) before clicking: the
    // config rebuilt now would be a different command — it must not be trusted.
    const edited = {
      ...stdioServer,
      connect: { ...stdioServer.connect, env: { MODE: 'x', NODE_OPTIONS: '--require evil' } },
    }
    const res = (await harness.invoke('aichat:trustServerTools', token)) as {
      success: boolean
      data: { tools?: Array<{ name: string }> }
    }
    expect(res.success).toBe(true)
    expect(res.data.tools).toEqual([{ name: 'get' }])
    const keys = Object.keys(store.data[STDIO_TRUST_STORE_KEY] as object)
    expect(keys).toEqual([
      stdioTrustKey({
        projectId: 'p1',
        command: 'node',
        args: ['server.js'],
        url: 'node server.js',
        env: { MODE: 'x' },
      }),
    ])
    expect(await isStdioServerTrusted({ projectId: 'p1', ...edited.connect })).toBe(false)
    // The connection is the shown one, not anything the renderer sends now.
    expect(openSession).toHaveBeenCalledTimes(1)
    expect((openSession.mock.calls[0] as unknown[])[0]).toMatchObject({ env: { MODE: 'x' } })

    // One-time: a second click with the same token does nothing.
    const again = (await harness.invoke('aichat:trustServerTools', token)) as {
      success: boolean
      error: string
    }
    expect(again.success).toBe(false)
    expect(again.error).toMatch(/Load tools again/)
    expect(openSession).toHaveBeenCalledTimes(1)
  })

  it('an unknown or forged token trusts nothing', async () => {
    const res = (await harness.invoke('aichat:trustServerTools', 'forged')) as {
      success: boolean
    }
    expect(res.success).toBe(false)
    expect(store.data[STDIO_TRUST_STORE_KEY]).toBeUndefined()
    expect(openSession).not.toHaveBeenCalled()
  })

  it('an OAuth server is refused with a clear message; nothing connects', async () => {
    const res = (await harness.invoke(
      'aichat:listServerTools',
      { ...httpServer, oauth: true },
      {},
    )) as {
      success: boolean
      error: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/OAuth 2\.1/)
    expect(openSession).not.toHaveBeenCalled()
  })
})

describe('connect-phase bound (Run parity)', () => {
  it('never below the shared default; 0 = none', async () => {
    const { connectTimeoutOf } = await import('../../../src/main/ipc/ai-chat.handler')
    expect(connectTimeoutOf(5_000)).toBe(120_000)
    expect(connectTimeoutOf(300_000)).toBe(300_000)
    expect(connectTimeoutOf(undefined)).toBe(120_000)
    expect(connectTimeoutOf(0)).toBe(0)
  })
})

// ─── Owning renderer lifecycle (issue #180) ──────────────────────────────────

describe('the renderer that started a Send reloads / crashes / closes', () => {
  /** A fake `webContents`: an EventEmitter with an id (Electron emits on it). */
  const makeSender = (id: number) => Object.assign(new EventEmitter(), { id, send: () => {} })

  const sendFrom = async (sender: EventEmitter & { id: number }, autoApprove = false) => {
    const fn = harness.handlers.get('aichat:send')!
    const res = (await fn(
      { sender },
      {
        provider: 'openai',
        model: 'm',
        prompt: 'go',
        history: [],
        tools: { projectId: 'p1', servers: [httpServer], autoApprove, allowedTools: [] },
      },
    )) as { data: { messageId: string } }
    return res.data.messageId
  }

  const pendingApproval = () =>
    until(() =>
      events('part').some((e) => (e.part as { status?: string }).status === 'pending-approval'),
    )

  it.each([
    ['destroyed', []],
    ['render-process-gone', [{}, { reason: 'crashed' }]],
    ['did-start-navigation', [{ isMainFrame: true, isSameDocument: false, url: 'app://x' }]],
  ])(
    '%s: the pending approval settles as cancelled, nothing runs, the session closes',
    async (ev, args) => {
      const closeSession = vi.fn(async () => {})
      setAiLoopDepsForTests({
        ...({} as object),
        openSession,
        callTool,
        closeSession,
        streamRound: async function* () {
          yield {
            type: 'end' as const,
            toolCalls: [{ id: 'call1', name: 'Weather__get', argsJson: '{}' }],
            usage: null,
            stopReason: 'tool_calls',
            firstContentAt: null,
            status: 200,
          }
        },
      })
      // Electron never reuses a webContents id — a fresh one per case.
      const sender = makeSender(100 + Math.floor(Math.random() * 1e6))
      const id = await sendFrom(sender)
      await pendingApproval()

      sender.emit(ev, ...(args as unknown[]))

      await until(() => closeSession.mock.calls.length === 1)
      expect(callTool).not.toHaveBeenCalled()
      // The stream is gone: a late answer applies to nothing, Stop finds nothing.
      const late = (await harness.invoke('aichat:approveTool', id, 'call1', 'once')) as {
        data: { applied: boolean }
      }
      expect(late.data.applied).toBe(false)
      const stop = (await harness.invoke('aichat:cancel', id)) as { data: { cancelled: boolean } }
      expect(stop.data.cancelled).toBe(false)
    },
  )

  it('an in-page navigation or a sub-frame does not end the stream; another renderer is untouched', async () => {
    const sender = makeSender(42)
    const other = makeSender(43)
    const id = await sendFrom(sender)
    await pendingApproval()
    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    sender.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    other.emit('destroyed')
    const res = (await harness.invoke('aichat:approveTool', id, 'call1', 'once')) as {
      data: { applied: boolean }
    }
    expect(res.data.applied).toBe(true)
    await until(() => wire.sent.some((e) => e.channel === 'aichat:done'))
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('a pending stdio trust question settles as not trusted (nothing spawned, nothing recorded)', async () => {
    const sender = makeSender(44)
    const fn = harness.handlers.get('aichat:send')!
    await fn(
      { sender },
      {
        provider: 'openai',
        model: 'm',
        prompt: 'go',
        history: [],
        tools: { projectId: 'p1', servers: [stdioServer], autoApprove: false, allowedTools: [] },
      },
    )
    await until(() =>
      events('part').some((e) => (e.part as { kind?: string }).kind === 'stdio-untrusted'),
    )
    sender.emit('destroyed')
    await until(() => wire.sent.some((e) => e.channel === 'aichat:cancelled'))
    expect(openSession).not.toHaveBeenCalled()
    expect(store.data[STDIO_TRUST_STORE_KEY]).toBeUndefined()
  })

  it('isFullMainFrameNavigation reads both the details object and the positional args', () => {
    expect(isFullMainFrameNavigation({ isMainFrame: true, isSameDocument: false })).toBe(true)
    expect(isFullMainFrameNavigation({ isMainFrame: true, isSameDocument: true })).toBe(false)
    expect(isFullMainFrameNavigation({ isMainFrame: false, isSameDocument: false })).toBe(false)
    expect(isFullMainFrameNavigation(undefined, false, true)).toBe(true)
    expect(isFullMainFrameNavigation(undefined, true, true)).toBe(false)
  })
})

// ─── Provider error text is scrubbed (issue #180) ────────────────────────────

describe('aichat:error never carries the key or a credential header back', () => {
  it('the provider message echoing the key / header is scrubbed (event + call metrics)', async () => {
    setAiLoopDepsForTests({
      streamRound: async function* () {
        yield* []
        throw Object.assign(
          new Error(
            'HTTP 401: invalid key sk-LIVE-abcdef123456 (header X-Gateway-Key=gw-SECRET-998877)',
          ),
          { status: 401 },
        )
      },
    })
    await harness.invoke('aichat:send', {
      provider: 'openai',
      model: 'm',
      prompt: 'hi',
      history: [],
      apiKey: 'sk-LIVE-abcdef123456',
      headers: { 'X-Gateway-Key': 'gw-SECRET-998877', 'X-Tenant': 'acme' },
    })
    await until(() => wire.sent.some((e) => e.channel === 'aichat:error'))
    const err = wire.sent.find((e) => e.channel === 'aichat:error')!.payload
    const text = JSON.stringify(err) + JSON.stringify(events('call'))
    expect(text).not.toContain('sk-LIVE-abcdef123456')
    expect(text).not.toContain('gw-SECRET-998877')
    expect(String(err.error)).toMatch(/HTTP 401: invalid key/)
  })
})
