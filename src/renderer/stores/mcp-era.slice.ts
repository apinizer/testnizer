/**
 * MCP protocol eras on the client tab (issue #152): the per-tab `protocol`
 * choice, what the connection negotiated (era, `server/discover` descriptor,
 * `subscriptions/listen` state) and the 2026-07-28 multi-round-trip
 * `tools/call` paused on `input_required`. Pure patch builders — the store
 * owns routing (by tab / connection id) and the IPC calls.
 */
import type {
  McpConnectResult,
  McpInputRequiredMarker,
  McpPendingInput,
  McpProtocolChoice,
  McpProtocolEra,
  McpSubscriptionStateEvent,
  McpSubscriptionView,
} from '../types/mcp'
import { DEFAULT_MCP_PROTOCOL, subscriptionFromConnect } from '../lib/mcp-protocol'

export interface McpEraTabState {
  /** `protocol` connect option. Persisted and part of the Ctrl+S snapshot. */
  protocol: McpProtocolChoice
  /** Negotiated era of the live connection. */
  era: McpProtocolEra | null
  /** The `server/discover` result (modern era only). */
  discover: Record<string, unknown> | null
  /** `subscriptions/listen` state (modern era with `listChanged` capabilities only). */
  subscription: McpSubscriptionView | null
  /** A `tools/call` waiting for the user's answers to its input requests. */
  pendingInput: McpPendingInput | null
}

/** Connection-scoped part — reset on disconnect / close. */
export function eraIdle(): Omit<McpEraTabState, 'protocol'> {
  return { era: null, discover: null, subscription: null, pendingInput: null }
}

export function eraDefaults(): McpEraTabState {
  return { protocol: DEFAULT_MCP_PROTOCOL, ...eraIdle() }
}

/** What the connect result says about the negotiated era. */
export function eraFromConnect(d: McpConnectResult): Omit<McpEraTabState, 'protocol'> {
  return {
    era: d.era ?? null,
    discover: d.discover ?? null,
    subscription: subscriptionFromConnect(d.subscription),
    pendingInput: null,
  }
}

/** `mcp:subscriptionState` → the tab's subscription view. */
export function subscriptionEventPatch(
  evt: McpSubscriptionStateEvent,
): Pick<McpEraTabState, 'subscription'> {
  if (evt.state === 'open') {
    return {
      subscription: {
        state: 'open',
        ...(evt.honoredFilter ? { honoredFilter: evt.honoredFilter } : {}),
      },
    }
  }
  return { subscription: { state: 'closed', ...(evt.reason ? { reason: evt.reason } : {}) } }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** The `__mcp` input-required marker of a tool result, or null for a complete result. */
export function inputRequiredOf(result: unknown): McpInputRequiredMarker | null {
  if (!isRecord(result) || !isRecord(result.__mcp)) return null
  const m = result.__mcp
  if (m.kind !== 'input_required') return null
  return {
    kind: 'input_required',
    inputRequests: isRecord(m.inputRequests) ? m.inputRequests : {},
    ...(typeof m.requestState === 'string' ? { requestState: m.requestState } : {}),
  }
}

/**
 * A finished `tools/call` / `respondInput` leg → the tool pane's state: a
 * complete result ends the loop, `input_required` (re)opens the input card
 * for the next round with the SAME arguments.
 */
export function toolLegPatch(
  res: { success: boolean; data?: unknown; error?: string },
  call: { toolName: string; args: Record<string, unknown>; round: number },
): {
  result: unknown
  resultError: string | null
  isInvoking: false
  pendingInput: McpPendingInput | null
} {
  if (!res.success) {
    return {
      result: null,
      resultError: res.error ?? 'Tool call failed',
      isInvoking: false,
      pendingInput: null,
    }
  }
  const marker = inputRequiredOf(res.data)
  if (marker) {
    return {
      result: null,
      resultError: null,
      isInvoking: false,
      pendingInput: {
        toolName: call.toolName,
        args: call.args,
        inputRequests: marker.inputRequests,
        ...(marker.requestState !== undefined ? { requestState: marker.requestState } : {}),
        round: call.round,
      },
    }
  }
  return { result: res.data, resultError: null, isInvoking: false, pendingInput: null }
}
