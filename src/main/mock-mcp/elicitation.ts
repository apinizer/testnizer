/**
 * Multi-round-trip elicitation ("MRTR", protocol revision 2026-07-28) for
 * Mock MCP tools that carry an `elicit` config (issue #152).
 *
 * Flow on a 2026-07-28 request:
 *   1. a `tools/call` without an answer for `elicit.key` is answered
 *      `input_required` with ONE embedded `elicitation/create` (form mode,
 *      the authored restricted schema) and a `requestState` minted by an
 *      HMAC codec (`createRequestStateCodec`, one random key per running
 *      server, 1 h TTL — the server's `requestState.verify` hook checks it
 *      before the handler runs again);
 *   2. the client retries the call with `inputResponses[key]`; accepted
 *      content that passes the schema (same ajv engine as `tools/call`, via
 *      `fromJsonSchema`) is handed back as `input` for the response template
 *      (`{{input.<field>}}`); a decline / cancel answers a plain text
 *      result; invalid or missing content re-asks.
 *
 * 2025-era requests get a text result explaining that the scenario needs
 * 2026-07-28: the mock deliberately never pushes a server-initiated
 * `elicitation/create` (stateless legacy POSTs have nowhere to receive the
 * answer), so the SDK's legacy shim is never engaged.
 */

import { randomBytes } from 'node:crypto'
import {
  acceptedContent,
  createRequestStateCodec,
  fromJsonSchema,
  inputRequired,
  inputResponse,
  ProtocolError,
  ProtocolErrorCode,
  type CallToolResult,
  type ElicitRequestFormParams,
  type InputRequiredResult,
  type JsonSchemaType,
  type RequestStateCodec,
  type ServerContext,
} from '@modelcontextprotocol/server'
import { mockJsonSchemaValidator } from './args-validator'
import type { MockMcpElicit, MockMcpEra } from './types'

/** What the minted `requestState` carries (signed, readable by the client). */
export interface ElicitState {
  tool: string
  key: string
}

export type ElicitationCodec = RequestStateCodec<ElicitState>

const REQUEST_STATE_TTL_SECONDS = 60 * 60

/** One codec per running server: a fresh random 256-bit HMAC key. */
export function createElicitationCodec(): ElicitationCodec {
  return createRequestStateCodec<ElicitState>({
    key: new Uint8Array(randomBytes(32)),
    ttlSeconds: REQUEST_STATE_TTL_SECONDS,
  })
}

export type ElicitOutcome =
  /** Answer the call with this result (input_required, decline note, legacy note). */
  | { kind: 'answer'; result: CallToolResult | InputRequiredResult }
  /** The accepted, schema-valid input — render the tool's response with it. */
  | { kind: 'input'; input: Record<string, unknown> }

function text(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }] }
}

export function legacyElicitationNote(toolName: string): string {
  return (
    `Tool "${toolName}" asks the client for input (elicitation), which this mock serves only on ` +
    'MCP protocol revision 2026-07-28 (an input_required result answered by a retry). ' +
    'This request was made with a 2025-era client; connect with a 2026-07-28 client to run the scenario.'
  )
}

export async function resolveElicitation(
  toolName: string,
  elicit: MockMcpElicit,
  era: MockMcpEra,
  ctx: ServerContext,
  codec: ElicitationCodec,
): Promise<ElicitOutcome> {
  if (era === 'legacy') return { kind: 'answer', result: text(legacyElicitationNote(toolName)) }

  // Already verified by the server's `requestState.verify` hook (codec.verify);
  // here only the binding to THIS tool's question is checked.
  const state = ctx.mcpReq.requestState<ElicitState>()
  if (
    state !== undefined &&
    (typeof state !== 'object' || state.tool !== toolName || state.key !== elicit.key)
  ) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      `requestState was not issued for the "${elicit.key}" question of tool "${toolName}"`,
    )
  }

  const responses = ctx.mcpReq.inputResponses
  const view = inputResponse(responses, elicit.key)
  if (view.kind === 'elicit' && view.action !== 'accept') {
    const verb = view.action === 'decline' ? 'declined' : 'cancelled'
    return { kind: 'answer', result: text(`The client ${verb} the "${elicit.key}" request.`) }
  }
  if (view.kind === 'elicit') {
    const schema = fromJsonSchema(elicit.schema as JsonSchemaType, mockJsonSchemaValidator)
    const content = acceptedContent(responses, elicit.key, schema)
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      return { kind: 'input', input: content as Record<string, unknown> }
    }
  }

  // Missing, of another kind, or accepted content that fails the schema → ask (again).
  return {
    kind: 'answer',
    result: inputRequired({
      inputRequests: {
        [elicit.key]: inputRequired.elicit({
          message: elicit.message,
          requestedSchema: elicit.schema as ElicitRequestFormParams['requestedSchema'],
        }),
      },
      requestState: await codec.mint({ tool: toolName, key: elicit.key }),
    }),
  }
}
