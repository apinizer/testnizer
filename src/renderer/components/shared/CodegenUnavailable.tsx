import { CodeXml } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { protocolChip } from '../../lib/protocol-chip'
import EmptyState from './EmptyState'

/**
 * Generate Code on a tab whose request is not plain HTTP — WebSocket,
 * Socket.IO, MCP, gRPC, SSE, AI Chat, tools (issue #280). Says so instead of
 * showing a stale HTTP request.
 */
export default function CodegenUnavailable({ protocol }: { protocol: string }) {
  const { t } = useTranslation()
  // A request protocol is named; a tool / runner / mock tab is just "this tab".
  const name = protocolChip(protocol)?.name
  return (
    <div data-testid="codegen-unavailable" data-protocol={protocol} className="flex flex-1">
      <EmptyState
        icon={CodeXml}
        size="sm"
        title={
          name
            ? t('codeGen.unavailableTitle').replace('{protocol}', name)
            : t('codeGen.unavailableTab')
        }
        description={t('codeGen.unavailableHint')}
      />
    </div>
  )
}
