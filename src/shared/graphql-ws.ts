/**
 * GraphQL subscriptions over WebSocket — what main and the renderer must agree
 * on. Pure TS, compiled into both bundles: the wire names, URL mapping, the
 * `connection_init` reader, the event shape and the wording of a failure.
 *
 * Wire protocols:
 *  - `graphql-transport-ws`: enisdenjo/graphql-ws PROTOCOL.md. Close codes 4406
 *    and 4500 are not in that document; they come from the library's
 *    `CloseCode` enum (`graphql-ws/lib/common.js`).
 *  - `graphql-ws`: apollographql/subscriptions-transport-ws PROTOCOL.md, with the
 *    literal names from its `message-types.ts` and `protocol.ts`.
 *
 * English wording lives here so main can write Console and History text. The
 * renderer's EN dictionary holds the same strings under the same keys (pinned by
 * `tests/renderer/graphql-subscription-text.test.ts`) and TR its translation.
 * `gqlWsFailureDetail` and `gqlWsCloseText` take the lookup, so both sides
 * compose a sentence the same way.
 */
import { fillTemplate } from './fill-template'

export const GRAPHQL_TRANSPORT_WS = 'graphql-transport-ws'
export const GRAPHQL_WS_LEGACY = 'graphql-ws'
export type GraphqlWsProtocol = typeof GRAPHQL_TRANSPORT_WS | typeof GRAPHQL_WS_LEGACY

/** Kept events per tab: the Console's rolling buffer size. Oldest go first. */
export const GQL_MAX_SUBSCRIPTION_EVENTS = 1000

/**
 * `http://` → `ws://`, `https://` → `wss://`, `ws(s)://` unchanged. No scheme
 * reads as `ws://`, as Introspect reads it as `http://`. Any other scheme is left
 * alone and fails in the engine with the library's own message.
 */
export function toGraphqlWsUrl(raw: string): string {
  const url = raw.trim()
  if (/^https:\/\//i.test(url)) return `wss://${url.slice('https://'.length)}`
  if (/^http:\/\//i.test(url)) return `ws://${url.slice('http://'.length)}`
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url
  return url ? `ws://${url}` : url
}

/**
 * The `connection_init` field, `{{var}}` already resolved. The protocol's payload
 * is an object. Empty means no payload. Anything else is an error rather than an
 * empty init, which would come back from the server as a confusing 4401 or 4403.
 */
export function parseConnectionInit(
  text: string | null | undefined,
): { ok: true; value?: Record<string, unknown> } | { ok: false } {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { ok: true }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> }
    }
  } catch {
    /* reported below */
  }
  return { ok: false }
}

// ─── Events main sends to the renderer ───────────────────────────────────────

export type GqlWsEvent = { connectionId: string; timestamp: number } & (
  | { type: 'data'; data: string }
  /** A server error frame, or (`fatal: false`) a frame this client cannot read. */
  | { type: 'error'; message: string; data?: string; fatal: boolean }
  /** Final. `complete`: the server finished. `error`: it ended the operation. `close`: socket gone. */
  | { type: 'ended'; reason: 'complete' | 'error' | 'close'; code?: number; closeReason?: string }
)

// ─── Failures before the subscription started ────────────────────────────────

export type GqlWsFailureReason = 'noSubprotocol' | 'noAck' | 'initRejected' | 'closed'

export interface GqlWsFailure {
  reason: GqlWsFailureReason
  /** `closed`: the close code. */
  closeCode?: number
  /** Text the server sent, credentials removed. */
  serverText?: string
  /** `noAck`: how long the engine waited. */
  ackTimeoutSeconds?: number
}

const CLOSE_CODES = [4400, 4401, 4403, 4406, 4408, 4409, 4429, 4500] as const

export const GQL_WS_TEXT_EN: Record<string, string> = {
  'graphql.sub.close.4400': 'Invalid message: the server could not read a message it received',
  'graphql.sub.close.4401':
    'Unauthorized: the server received the subscription before connection_ack, or refused the credentials',
  'graphql.sub.close.4403':
    'Forbidden: the server rejected the connection. Check the headers and the connection_init payload',
  'graphql.sub.close.4406':
    'Subprotocol not acceptable: the server does not accept this WebSocket subprotocol',
  'graphql.sub.close.4408':
    'Connection initialisation timeout: the server did not receive connection_init in time',
  'graphql.sub.close.4409':
    'Subscriber already exists: the server already runs an operation with this id',
  'graphql.sub.close.4429':
    'Too many initialisation requests: the server received more than one connection_init',
  'graphql.sub.close.4500': 'Internal server error',
  'graphql.sub.failure.noSubprotocol':
    'The server did not choose a GraphQL subprotocol (it was offered graphql-transport-ws and graphql-ws)',
  'graphql.sub.failure.noAck':
    'The WebSocket opened but the server sent no connection_ack within {seconds} s',
  'graphql.sub.failure.initRejected': 'The server refused connection_init',
  'graphql.sub.failure.closed': 'The server closed the connection before connection_ack',
  'graphql.sub.hint.noSubprotocol': 'Check that the URL is the GraphQL WebSocket endpoint',
  'graphql.sub.hint.noAck':
    'Check the connection_init payload and the credentials the server expects',
  'graphql.sub.hint.initRejected':
    'Check the connection_init payload and the credentials the server expects',
  'graphql.sub.hint.closed': 'Check the headers, the connection_init payload and the server logs',
}

export function gqlWsTextEn(key: string): string {
  return GQL_WS_TEXT_EN[key] ?? key
}

/** `4401: Unauthorized: …` for a known code, `1006`, or `1011: the server's reason`. */
export function gqlWsCloseText(
  code: number | undefined,
  reason: string | undefined,
  text: (key: string) => string,
): string {
  const known = (CLOSE_CODES as readonly number[]).includes(code ?? -1)
  const detail = known ? text(`graphql.sub.close.${code}`) : (reason ?? '').trim()
  return [code, detail].filter((part) => part !== undefined && part !== '').join(': ')
}

/** The sentence that names what went wrong, in the lookup's language. */
export function gqlWsFailureDetail(failure: GqlWsFailure, text: (key: string) => string): string {
  const what = fillTemplate(text(`graphql.sub.failure.${failure.reason}`), {
    seconds: String(failure.ackTimeoutSeconds ?? ''),
  })
  if (failure.reason === 'closed') {
    return `${what} (${gqlWsCloseText(failure.closeCode, failure.serverText, text)})`
  }
  return failure.serverText ? `${what}: ${failure.serverText}` : what
}

export function gqlWsHintKey(reason: GqlWsFailureReason): string {
  return `graphql.sub.hint.${reason}`
}
