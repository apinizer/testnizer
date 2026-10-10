import MethodBadge from './MethodBadge'
import ProtocolChip from './ProtocolChip'
import { protocolChipLabel } from '../../lib/protocol-chip'

/**
 * The badge in front of a listed request (issue #173): the protocol chip
 * (MCP, WS, SSE, SIO, GQL, gRPC) for a non-HTTP request — its stored method is
 * a placeholder (`GET`) or a verb like `CALL_TOOL` — and the method badge for
 * HTTP / SOAP. The tree row and the tab strip apply the same rule; every other
 * list (History, Tests panel, Runner, Add endpoints, examples, the welcome
 * page) renders this so none shows a misleading GET.
 */
export default function RequestBadge({
  protocol,
  method,
  small = false,
}: {
  protocol: string | null | undefined
  method: string | null | undefined
  small?: boolean
}) {
  if (protocolChipLabel(protocol)) return <ProtocolChip protocol={protocol} />
  return <MethodBadge method={method || 'GET'} small={small} />
}
