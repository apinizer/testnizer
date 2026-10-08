import { Settings2 } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { STANDARD_HTTP_HEADERS } from '../../../lib/http-headers'
import { useTranslation } from '../../../lib/i18n'
import McpKvSection from './McpKvSection'

/**
 * "Custom Headers" block (issue #137) — sends `Authorization: Bearer …` /
 * API-gateway `X-…` headers on the Streamable HTTP / SSE handshake. Hidden
 * for stdio, which has no HTTP layer.
 */
export default function McpHeadersSection() {
  const { t } = useTranslation()
  const transport = useMcpStore((s) => s.transport)
  const customHeaders = useMcpStore((s) => s.customHeaders)
  const addHeader = useMcpStore((s) => s.addHeader)
  const updateHeader = useMcpStore((s) => s.updateHeader)
  const removeHeader = useMcpStore((s) => s.removeHeader)

  if (transport === 'stdio') return null

  return (
    <McpKvSection
      testIdPrefix="mcp-headers"
      title={t('mcp.headers.title')}
      icon={<Settings2 size={14} />}
      rows={customHeaders}
      onUpdate={updateHeader}
      onRemove={removeHeader}
      onAdd={addHeader}
      addLabel={t('mcp.headers.add')}
      keyAutocompleteEntries={STANDARD_HTTP_HEADERS}
    />
  )
}
