import { useMcpStore } from '../../../stores/mcp.store'
import { STANDARD_HTTP_HEADERS } from '../../../lib/http-headers'
import { useTranslation } from '../../../lib/i18n'
import McpKvSection from './McpKvSection'

/**
 * Headers panel of the MCP config tab strip (issue #137) — API-gateway
 * `X-…` headers (or a raw `Authorization`) sent on the Streamable HTTP / SSE
 * handshake and every request after it. The tab is hidden for stdio, which
 * has no HTTP layer.
 */
export default function McpHeadersSection() {
  const { t } = useTranslation()
  const customHeaders = useMcpStore((s) => s.customHeaders)
  const addHeader = useMcpStore((s) => s.addHeader)
  const updateHeader = useMcpStore((s) => s.updateHeader)
  const removeHeader = useMcpStore((s) => s.removeHeader)

  return (
    <McpKvSection
      testIdPrefix="mcp-headers"
      rows={customHeaders}
      onUpdate={updateHeader}
      onRemove={removeHeader}
      onAdd={addHeader}
      addLabel={t('mcp.headers.add')}
      keyAutocompleteEntries={STANDARD_HTTP_HEADERS}
    />
  )
}
