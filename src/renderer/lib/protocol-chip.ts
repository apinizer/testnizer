/**
 * Protocol chip data for tree rows and tabs (issue #173). Non-HTTP requests
 * are stored with a placeholder method (`TreeView` creates an MCP row with
 * `method: 'GET'`), so showing that method told the user something false.
 * HTTP and SOAP keep their real method badge — no chip for them.
 *
 * Colours are globals.css tokens (light + dark themes), never hex.
 */
export interface ProtocolChipInfo {
  label: string
  /** Tailwind text-colour class over a globals.css token. */
  color: string
  /** Full protocol name for the tooltip. */
  name: string
}

const CHIPS: Record<string, ProtocolChipInfo> = {
  mcp: { label: 'MCP', color: 'text-[var(--mb-head-fg)]', name: 'MCP' },
  websocket: { label: 'WS', color: 'text-[var(--mb-options-fg)]', name: 'WebSocket' },
  sse: { label: 'SSE', color: 'text-[var(--orange)]', name: 'Server-Sent Events' },
  socketio: { label: 'SIO', color: 'text-[var(--mb-query-fg)]', name: 'Socket.IO' },
  graphql: { label: 'GQL', color: 'text-[var(--mb-put-fg)]', name: 'GraphQL' },
  grpc: { label: 'gRPC', color: 'text-[var(--green)]', name: 'gRPC' },
}

export function protocolChip(protocol: string | undefined | null): ProtocolChipInfo | null {
  return (protocol && CHIPS[protocol]) || null
}

/** The chip text for a protocol, or null when the row/tab keeps its method badge. */
export function protocolChipLabel(protocol: string | undefined | null): string | null {
  return protocolChip(protocol)?.label ?? null
}

/**
 * The tab strip's chip, unless the tab title already says the same thing: a
 * tab opened from the welcome page is titled with the protocol's name, so an
 * MCP tab read "MCP MCP" (gRPC and SSE the same). Case-insensitive, trimmed.
 */
export function tabProtocolChip(
  protocol: string | undefined | null,
  title: string | undefined | null,
): ProtocolChipInfo | null {
  const chip = protocolChip(protocol)
  if (!chip) return null
  const name = (title ?? '').trim().toLowerCase()
  return name === chip.label.toLowerCase() ? null : chip
}
