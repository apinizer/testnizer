import { protocolChip } from '../../lib/protocol-chip'

/**
 * Short protocol chip (MCP, WS, SSE, SIO, GQL, gRPC) shown on tree rows and
 * tabs in place of a non-HTTP request's placeholder method (issue #173).
 * Renders nothing for HTTP / SOAP — they keep their method badge.
 */
export default function ProtocolChip({ protocol }: { protocol: string | undefined | null }) {
  const chip = protocolChip(protocol)
  if (!chip) return null
  return (
    <span
      data-testid="protocol-chip"
      data-protocol={protocol ?? undefined}
      title={chip.name}
      className={`inline-block shrink-0 whitespace-nowrap font-mono text-[11px] font-bold tracking-[0.03em] ${chip.color}`}
    >
      {chip.label}
    </span>
  )
}
