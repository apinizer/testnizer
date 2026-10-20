/**
 * "Open in SSE tab" buttons of an SSE mock server (issue #221, design Ek D
 * §D.3.3–D.3.4):
 *
 *  - `MockSseHeaderButton` — in the editor header, where the Mock MCP header
 *    has "Open in MCP tab" (same `GhostButton` + `ExternalLink`). Stopped →
 *    "Start & open in SSE tab": starts first, opens only on success. Targets
 *    the first exact-path GET / ANY endpoint; none → disabled with the reason.
 *  - `MockEndpointOpenInSse` — per endpoint in the URL bar, next to (and
 *    styled like) its Copy / cURL / Open buttons: carries the endpoint's
 *    method (ANY → GET); exact paths only.
 */
import { ExternalLink } from 'lucide-react'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import type { MockEndpoint, MockServer } from '../../types'
import { GhostButton } from '../mock-mcp/ui'
import {
  mockEndpointUrl,
  openMockInSseTab,
  sseMethodFor,
  startAndOpenMockInSseTab,
  streamTargetEndpoint,
} from './mock-open-in-tab'

const EMPTY_ENDPOINTS: readonly MockEndpoint[] = []

export function MockSseHeaderButton({ server, status }: { server: MockServer; status: string }) {
  const { t } = useTranslation()
  const endpoints = useMockStore((s) => s.endpointsByServer[server.id]) ?? EMPTY_ENDPOINTS
  const startServer = useMockStore((s) => s.startServer)
  const target = streamTargetEndpoint(endpoints)
  const running = status === 'running'
  const label = running ? t('mock.openInSse') : t('mock.startAndOpenInSse')
  const reason = target ? null : t('mock.noStreamEndpoint')

  const open = (): void => {
    if (!target) return
    void startAndOpenMockInSseTab({
      name: server.name,
      url: mockEndpointUrl(server, target.path),
      method: sseMethodFor(target.method) ?? 'GET',
      running,
      start: () => startServer(server.id),
    })
  }

  return (
    <GhostButton
      data-testid="mock-open-in-sse"
      onClick={open}
      disabled={!target || status === 'starting'}
      title={reason ?? label}
      aria-label={reason ? `${label}. ${reason}` : label}
    >
      <ExternalLink size={12} />
      {label}
    </GhostButton>
  )
}

export function MockEndpointOpenInSse({
  server,
  endpoint,
}: {
  server: MockServer
  endpoint: MockEndpoint
}) {
  const { t } = useTranslation()
  const method = sseMethodFor(endpoint.method)
  const exact = endpoint.pathMode === 'exact'
  const can = exact && method !== null
  const reason = !exact ? t('mock.openHintPath') : method === null ? t('mock.sseHintMethod') : null

  return (
    <button
      data-testid="mock-endpoint-open-in-sse"
      onClick={() =>
        method &&
        openMockInSseTab({
          name: server.name,
          url: mockEndpointUrl(server, endpoint.path),
          method,
        })
      }
      disabled={!can}
      className="rounded border px-2 py-0.5 text-[11px]"
      // Same look as the URL bar's Open button (MockServerEditor.tsx FullUrlBar).
      style={{
        borderColor: 'var(--border)',
        color: can ? 'var(--accentText)' : 'var(--hint)',
        background: 'var(--white)',
        opacity: can ? 1 : 0.5,
        cursor: can ? 'pointer' : 'not-allowed',
      }}
      title={reason ?? t('mock.openInSse')}
    >
      ↗ {t('mock.openInSse')}
    </button>
  )
}
