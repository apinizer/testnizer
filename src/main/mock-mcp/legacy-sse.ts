/**
 * Legacy HTTP+SSE transport of a Mock MCP server (`legacySse`): the frozen
 * v1 `SSEServerTransport` from `@modelcontextprotocol/server-legacy/sse`,
 * mounted at `GET <path>/sse` + `POST <path>/messages?sessionId=…` and
 * connected to the same per-definition v2 `Server` the Streamable HTTP
 * endpoint builds (always the 2025 era). Unlike `<path>`, these are real
 * sessions: they receive `list_changed` on hot reload / `notify`.
 *
 * Each session's transport is instrumented after `connect()`:
 *   - the server latency delays every incoming JSON-RPC request;
 *   - the session's protocol pin (`?rev=` on the `/sse` URL, else the
 *     server's pin) rejects an `initialize` for any other version, and the
 *     unusable session is dropped;
 *   - requests are paired with their responses by id for the log.
 */

import type http from 'node:http'
import { SSEServerTransport } from '@modelcontextprotocol/server-legacy/sse'
import {
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type MessageExtraInfo,
  type Server,
} from '@modelcontextprotocol/server'
import { subPath } from './config'
import { initializePinError, safeStringify, truncate } from './jsonrpc'
import type { LogDraft } from './handler'
import type { MockMcpNotifyKind, MockMcpServerDef } from './types'

export interface LegacySseHooks {
  getDef(): MockMcpServerDef
  /** A fresh 2025-era server for one session. */
  buildServer(): Server
  log(entry: LogDraft): void
  /** False once the owning server is stopping (late timers must not dispatch). */
  isLive(): boolean
}

interface Session {
  transport: SSEServerTransport
  server: Server
}

interface PendingRequest {
  ts: number
  method: string
  toolName?: string
  request: string
}

export class LegacySseSessions {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly hooks: LegacySseHooks) {}

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** `GET <path>/sse`: open a session (writes the `endpoint` event). */
  async open(res: http.ServerResponse, pin: string | null): Promise<void> {
    const transport = new SSEServerTransport(subPath(this.hooks.getDef().path, '/messages'), res)
    const server = this.hooks.buildServer()
    const session: Session = { transport, server }
    this.sessions.set(transport.sessionId, session)
    await server.connect(transport)
    this.instrument(session, pin)
  }

  /** `POST <path>/messages`: false when the session is unknown (caller answers 404). */
  async message(
    sessionId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: unknown,
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    await session.transport.handlePostMessage(req, res, body)
    return true
  }

  notify(kind: MockMcpNotifyKind): void {
    for (const { server } of this.sessions.values()) {
      const send =
        kind === 'tools'
          ? server.sendToolListChanged()
          : kind === 'resources'
            ? server.sendResourceListChanged()
            : server.sendPromptListChanged()
      void send.catch(() => {})
    }
  }

  async closeAll(): Promise<void> {
    const all = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(all.map((s) => this.closeSession(s)))
  }

  private async closeSession(s: Session): Promise<void> {
    try {
      await s.transport.close()
    } catch {
      /* already closed */
    }
    try {
      await s.server.close()
    } catch {
      /* already closed */
    }
  }

  private drop(session: Session): void {
    for (const [sid, s] of this.sessions) if (s === session) this.sessions.delete(sid)
    void this.closeSession(session)
  }

  /** Must run AFTER `server.connect()` (which installs the handlers wrapped here). */
  private instrument(session: Session, pin: string | null): void {
    const t = session.transport
    const dispatch = t.onmessage
    const sendRaw = t.send.bind(t)
    const closeRaw = t.onclose
    const pending = new Map<string | number, PendingRequest>()

    const finish = (
      id: string | number,
      out: { ok: boolean; errorCode?: number; response: string },
    ): void => {
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      this.hooks.log({
        ts: p.ts,
        method: p.method,
        ...(p.toolName ? { toolName: p.toolName } : {}),
        durationMs: Date.now() - p.ts,
        ok: out.ok,
        ...(out.errorCode !== undefined ? { errorCode: out.errorCode } : {}),
        sessionId: t.sessionId,
        transport: 'sse',
        era: 'legacy',
        request: p.request,
        response: truncate(out.response),
      })
    }

    t.onmessage = <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo): void => {
      if (isJSONRPCRequest(message)) {
        const toolName =
          message.method === 'tools/call' && typeof message.params?.name === 'string'
            ? message.params.name
            : undefined
        pending.set(message.id, {
          ts: Date.now(),
          method: message.method,
          ...(toolName ? { toolName } : {}),
          request: truncate(safeStringify(message)),
        })
        const pinError = pin ? initializePinError(message, pin) : null
        if (pinError) {
          // Answer it ourselves; a rejected initialize leaves an unusable session.
          void t.send(pinError).finally(() => setTimeout(() => this.drop(session), 0))
          return
        }
        const latency = this.hooks.getDef().latencyMs
        if (latency > 0) {
          setTimeout(() => {
            if (this.hooks.isLive()) dispatch?.(message, extra)
          }, latency)
          return
        }
      } else if (
        isJSONRPCNotification(message) &&
        message.method === 'notifications/cancelled' &&
        (typeof message.params?.requestId === 'string' ||
          typeof message.params?.requestId === 'number')
      ) {
        const reason = message.params.reason
        finish(message.params.requestId, {
          ok: false,
          response: `(no response — cancelled by the client${typeof reason === 'string' ? `: ${reason}` : ''})`,
        })
      }
      dispatch?.(message, extra)
    }

    t.send = async (message, options): Promise<void> => {
      if (isJSONRPCResultResponse(message)) {
        finish(message.id, { ok: true, response: safeStringify(message) })
      } else if (
        isJSONRPCErrorResponse(message) &&
        (typeof message.id === 'string' || typeof message.id === 'number')
      ) {
        finish(message.id, {
          ok: false,
          errorCode: message.error.code,
          response: safeStringify(message),
        })
      }
      await sendRaw(message, options)
    }

    t.onclose = (): void => {
      closeRaw?.()
      for (const id of [...pending.keys()]) {
        finish(id, { ok: false, response: '(no response — session closed)' })
      }
      for (const [sid, s] of this.sessions) if (s === session) this.sessions.delete(sid)
    }
  }
}
