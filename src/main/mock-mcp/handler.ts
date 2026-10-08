/**
 * The `<path>` endpoint of a running Mock MCP server, served by the v2 SDK
 * for BOTH protocol eras (issue #152):
 *
 *   - 2026-07-28 ("modern") requests — per-request `_meta` envelope, no
 *     `initialize` — go through `createMcpHandler`'s modern path;
 *   - 2024/2025 ("legacy") requests — the `initialize` handshake and its
 *     follow-ups — go through the SDK's stateless legacy fallback
 *     (`legacy: 'stateless'`): a fresh server per POST, no `Mcp-Session-Id`,
 *     legacy GET / DELETE answered 405. A sessionful legacy adapter would mean
 *     re-implementing the session map next to the SDK (route with
 *     `isLegacyRequest` to a `NodeStreamableHTTPServerTransport`), so it is
 *     not done: 2025 clients work, but get no server notifications
 *     (`legacyNotifications: false` on the state).
 *
 * Two handlers share one change-event bus: `stateless` (both eras) and
 * `strict` (`legacy: 'reject'` → the SDK's -32022 for legacy requests), so a
 * per-request `?rev=2026-07-28` or `legacyMode: 'reject'` can pick the strict
 * one while `notify.*` reaches `subscriptions/listen` streams of either.
 * A 2025-era pin is enforced here, before the SDK: a modern request gets
 * -32022 naming the pin (a negotiating client then falls back to
 * `initialize`), a legacy `initialize` for another version gets -32602.
 *
 * Logging: the fetch face handed to `toNodeHandler` is wrapped; every
 * JSON-RPC request of the POST is paired with its response (JSON body or the
 * `data:` frames of an SSE body, read from a clone) and logged with era,
 * `Mcp-Method` header and `inputRequired`. A `notifications/cancelled` POST
 * (2025 clients) or an aborted exchange (2026 clients, HTTP 499) closes the
 * pending line as cancelled. Cancellation is correlated by JSON-RPC id only —
 * two clients cancelling the same id at once may close each other's line.
 */

import type http from 'node:http'
import {
  createMcpHandler,
  InMemoryServerEventBus,
  UnsupportedProtocolVersionError,
  type McpHttpHandler,
  type Server,
} from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { isModernVersion } from './config'
import {
  callsOf,
  cancelledIdsOf,
  initializePinError,
  MAX_LOG_TEXT,
  messagesOf,
  outcomeOf,
  parseResponseMessages,
  safeStringify,
  truncate,
  type InboundEra,
  type JsonRpcCall,
} from './jsonrpc'
import type { MockMcpEra, MockMcpLogEntry, MockMcpNotifyKind, MockMcpServerDef } from './types'

export type LogDraft = Omit<MockMcpLogEntry, 'id' | 'serverId'>

export interface EndpointHooks {
  getDef(): MockMcpServerDef
  buildServer(era: MockMcpEra): Server
  log(entry: LogDraft): void
}

export interface ServeInput {
  /** Parsed POST body (`undefined` for GET / DELETE / an empty body). */
  body: unknown
  inbound: InboundEra
  /** Effective pin: `?rev=` or the server's `protocolPin`. */
  pin: string | null
  /** Arrival time, so `durationMs` includes the injected latency. */
  ts: number
  mcpMethod?: string
}

interface Finish {
  ok: boolean
  response: string
  errorCode?: number
  httpStatus?: number
  inputRequired?: boolean
}

export class McpEndpoint {
  private readonly bus = new InMemoryServerEventBus()
  private readonly stateless: McpHttpHandler
  private readonly strict: McpHttpHandler
  /** Pending log lines by JSON-RPC id, closed by `notifications/cancelled`. */
  private readonly cancelWaiters = new Map<string | number, Set<() => void>>()

  constructor(private readonly hooks: EndpointHooks) {
    const factory = ({ era }: { era: MockMcpEra }): Server => hooks.buildServer(era)
    const quiet = (): void => {}
    this.stateless = createMcpHandler(factory, {
      legacy: 'stateless',
      bus: this.bus,
      onerror: quiet,
    })
    this.strict = createMcpHandler(factory, { legacy: 'reject', bus: this.bus, onerror: quiet })
  }

  /** Announce a list change to every open 2026-07-28 `subscriptions/listen` stream. */
  notify(kind: MockMcpNotifyKind): void {
    const n = this.stateless.notify // the bus is shared, one publish reaches both handlers
    if (kind === 'tools') n.toolsChanged()
    else if (kind === 'resources') n.resourcesChanged()
    else n.promptsChanged()
  }

  async close(): Promise<void> {
    await Promise.all([this.stateless.close(), this.strict.close()])
    // Pending lines close themselves once their (now closed) bodies end.
    this.cancelWaiters.clear()
  }

  async serve(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    input: ServeInput,
  ): Promise<void> {
    for (const id of cancelledIdsOf(input.body)) {
      for (const w of [...(this.cancelWaiters.get(id) ?? [])]) w()
    }
    const calls = callsOf(input.body)

    const gate = this.pinGate(input)
    if (gate) {
      res.writeHead(gate.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(gate.payload))
      const outcome = outcomeOf(gate.payload)
      for (const c of calls) {
        this.write(c, input, {
          ok: false,
          response: safeStringify(gate.payload),
          ...(outcome?.errorCode !== undefined ? { errorCode: outcome.errorCode } : {}),
          ...(gate.status >= 400 ? { httpStatus: gate.status } : {}),
        })
      }
      return
    }

    const def = this.hooks.getDef()
    const handler =
      isModernVersion(input.pin) || def.legacyMode === 'reject' ? this.strict : this.stateless
    const node = toNodeHandler({
      fetch: async (request, options) => {
        const response = await handler.fetch(request, options)
        if (calls.length > 0) void this.record(response.clone(), calls, input)
        return response
      },
    })
    await node(req, res, input.body)
  }

  /** A 2025-era pin, enforced before the SDK sees the request. */
  private pinGate(input: ServeInput): { status: number; payload: unknown } | null {
    const pin = input.pin
    if (!pin || isModernVersion(pin)) return null
    if (input.inbound.modernRoute) {
      const [first] = messagesOf(input.body)
      const id =
        first && typeof first === 'object' && 'id' in first ? (first as { id: unknown }).id : null
      const err = new UnsupportedProtocolVersionError({
        supported: [pin],
        requested: input.inbound.requestedVersion ?? 'unknown',
      })
      return {
        status: 400,
        payload: {
          jsonrpc: '2.0',
          id: typeof id === 'string' || typeof id === 'number' ? id : null,
          error: { code: err.code, message: err.message, data: err.data },
        },
      }
    }
    if (input.inbound.era !== 'legacy') return null
    for (const m of messagesOf(input.body)) {
      const error = initializePinError(m, pin)
      if (error) return { status: 200, payload: error }
    }
    return null
  }

  /** Pair each request with its response (or its fate) and log it once. */
  private async record(response: Response, calls: JsonRpcCall[], input: ServeInput): Promise<void> {
    const open = new Map(calls.map((c) => [c.id, c]))
    const waiters = new Map<string | number, () => void>()
    const finish = (c: JsonRpcCall, out: Finish): void => {
      if (!open.delete(c.id)) return
      const waiter = waiters.get(c.id)
      const set = this.cancelWaiters.get(c.id)
      if (waiter && set) {
        set.delete(waiter)
        if (set.size === 0) this.cancelWaiters.delete(c.id)
      }
      this.write(c, input, out)
    }
    for (const c of calls) {
      const waiter = (): void =>
        finish(c, { ok: false, response: '(no response — cancelled by the client)' })
      waiters.set(c.id, waiter)
      const set = this.cancelWaiters.get(c.id) ?? new Set()
      set.add(waiter)
      this.cancelWaiters.set(c.id, set)
    }
    const httpStatus = response.ok ? {} : { httpStatus: response.status }

    if (response.status === 499) {
      // The modern leg's answer to a client that went away mid-exchange.
      for (const c of [...open.values()]) {
        finish(c, { ok: false, response: '(no response — cancelled by the client)' })
      }
      return
    }

    const settle = (m: unknown): void => {
      const outcome = outcomeOf(m)
      const c = outcome ? open.get(outcome.id) : undefined
      if (!outcome || !c) return
      finish(c, {
        ok: outcome.ok && response.ok,
        response: outcome.text,
        ...(outcome.errorCode !== undefined ? { errorCode: outcome.errorCode } : {}),
        ...(outcome.inputRequired ? { inputRequired: true } : {}),
        ...httpStatus,
      })
    }

    // Read the clone incrementally: SSE frames settle their request as they
    // arrive (accurate durations), and a long-lived stream (a 2026
    // `subscriptions/listen`, a hanging call) never accumulates more than the
    // log keeps. Our tee branch is cancelled once nothing is pending — the
    // client's branch is unaffected.
    const sse = (response.headers.get('content-type') ?? '').includes('text/event-stream')
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let head = '' // first MAX_LOG_TEXT chars, for the fallback log text / JSON bodies
    let json = '' // a JSON body is finite: keep it whole
    let partial = '' // the unfinished SSE line
    try {
      while (reader && open.size > 0) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        if (head.length < MAX_LOG_TEXT) head += chunk.slice(0, MAX_LOG_TEXT - head.length)
        if (!sse) {
          json += chunk
          continue
        }
        const lines = (partial + chunk).split(/\r?\n/)
        partial = lines.pop() ?? ''
        for (const m of parseResponseMessages(lines.join('\n'), 'text/event-stream')) settle(m)
      }
      if (!sse) for (const m of parseResponseMessages(json, 'application/json')) settle(m)
    } catch {
      /* the exchange was torn down mid-stream */
    } finally {
      void reader?.cancel().catch(() => {})
    }
    for (const c of [...open.values()]) {
      finish(c, { ok: false, response: head || '(no response — connection closed)', ...httpStatus })
    }
  }

  private write(c: JsonRpcCall, input: ServeInput, out: Finish): void {
    const era = input.inbound.era
    this.hooks.log({
      ts: input.ts,
      method: c.method,
      ...(c.toolName ? { toolName: c.toolName } : {}),
      durationMs: Date.now() - input.ts,
      ok: out.ok,
      ...(out.errorCode !== undefined ? { errorCode: out.errorCode } : {}),
      ...(out.httpStatus !== undefined ? { httpStatus: out.httpStatus } : {}),
      transport: era === 'modern' ? 'streamable-http' : 'stateless',
      era,
      ...(input.mcpMethod ? { mcpMethod: input.mcpMethod } : {}),
      ...(out.inputRequired ? { inputRequired: true } : {}),
      request: c.text,
      response: truncate(out.response),
    })
  }
}
