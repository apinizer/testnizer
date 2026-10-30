/**
 * "Open in request tab" — per endpoint in the URL bar of an HTTP-table mock
 * server, next to (and styled like) Copy / cURL / "Open in SSE tab". Replaces
 * the old "Open" button, which handed a GET to the system browser: the tab is
 * an ordinary HTTP request (any method, headers, body, auth) the user can Send
 * and Save. Stopped server → "Start & open in request tab": starts first and
 * opens only on success (`startThenOpen`, as the SSE sibling).
 *
 * Exact paths open and send at once; `:param` paths open with their path
 * variable rows to fill in and do not send (a literal `:id` would not match),
 * nor does an endpoint with an SSE reply (its stream may never end — "Open in
 * SSE tab" is the client for that).
 * Wildcard / regex paths have no single URL → disabled with the reason.
 */
import { useTranslation } from '../../lib/i18n'
import type { MockEndpoint, MockServer } from '../../types'
import type { MockLlmProvider } from '../../../shared/mock-stream'
import { useStartThenOpen } from './use-start-then-open'
import { mockRequestShape } from './mock-curl'
import { mockEndpointUrl, startAndOpenMockInHttpTab } from './mock-open-in-tab'

export function MockEndpointOpenInHttp({
  server,
  endpoint,
  status,
  llm,
  streams,
}: {
  server: MockServer
  endpoint: MockEndpoint
  status: string
  /** The endpoint has an `sse` reply → open without sending. */
  streams: boolean
  /** Provider of the endpoint's `llm` reply — picks the chat body, as cURL does. */
  llm: MockLlmProvider | null
}) {
  const { t } = useTranslation()
  const { label, starting, gate } = useStartThenOpen(server, status, {
    open: 'mock.openInHttp',
    startAndOpen: 'mock.startAndOpenInHttp',
  })
  const pathOk = endpoint.pathMode === 'exact' || endpoint.pathMode === 'param'
  const can = pathOk && !starting
  const reason = pathOk ? null : t('mock.httpHintPath')

  function open(): void {
    const shape = mockRequestShape(endpoint, llm)
    void startAndOpenMockInHttpTab({
      serverId: server.id,
      name: server.name,
      url: mockEndpointUrl(server, endpoint.path),
      method: shape.method,
      path: endpoint.path,
      headers: shape.headers,
      body: shape.body,
      send: endpoint.pathMode === 'exact' && !streams,
      ...gate,
    })
  }

  return (
    <button
      data-testid="mock-endpoint-open-in-http"
      onClick={open}
      disabled={!can}
      className="whitespace-nowrap rounded border px-2 py-0.5 text-[11px]"
      // Same look as the URL bar's "Open in SSE tab" (MockOpenInSse.tsx).
      style={{
        borderColor: 'var(--border)',
        color: can ? 'var(--accent-text)' : 'var(--hint)',
        background: 'var(--white)',
        opacity: can ? 1 : 0.5,
        cursor: can ? 'pointer' : 'not-allowed',
      }}
      title={reason ?? label}
    >
      ↗ {label}
    </button>
  )
}
