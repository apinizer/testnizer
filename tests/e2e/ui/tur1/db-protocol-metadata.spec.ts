/**
 * MST-255 — Protocol metadata persist (8 protocols)
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { createSavedRequestIpc } from '../../helpers/ui/db-flow'
import { getActiveProjectId, getSavedRequest } from '../../helpers/ui/assert-ipc'
import { getTestServerUrls } from '../../helpers/test-servers'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

const PROTOCOLS = [
  { protocol: 'http', url: 'http://127.0.0.1/get', meta: { kind: 'http' } },
  { protocol: 'soap', url: 'http://127.0.0.1/post', meta: { wsdlUrl: 'http://127.0.0.1/wsdl' } },
  { protocol: 'websocket', url: 'ws://127.0.0.1/ws', meta: { subprotocol: 'json' } },
  { protocol: 'sse', url: 'http://127.0.0.1/sse', meta: { lastEventId: '0' } },
  { protocol: 'graphql', url: 'http://127.0.0.1/graphql', meta: { operationName: 'Q' } },
  { protocol: 'grpc', url: 'localhost:50051', meta: { service: 'Echo', method: 'Unary' } },
  { protocol: 'socketio', url: 'http://127.0.0.1:3000', meta: { namespace: '/e2e' } },
  { protocol: 'mcp', url: 'http://127.0.0.1/mcp', meta: { transport: 'http' } },
] as const

uiTest.describe('Tur1 — DB protocol metadata [MST-255]', () => {
  uiTest('MST-255 each protocol stores metadata JSON in saved_requests', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const servers = getTestServerUrls()

    for (const p of PROTOCOLS) {
      const url =
        p.protocol === 'websocket'
          ? servers.ws
          : p.protocol === 'sse'
            ? servers.sse
            : p.protocol === 'graphql'
              ? servers.graphql
              : p.protocol === 'grpc'
                ? servers.grpc
                : p.protocol === 'socketio'
                  ? servers.socketio
                  : p.protocol === 'mcp'
                    ? servers.mcp
                    : p.url

      const id = await createSavedRequestIpc(window, {
        projectId,
        name: `${p.protocol} ${uid()}`,
        protocol: p.protocol,
        url,
        metadata: JSON.stringify(p.meta),
      })
      const row = (await getSavedRequest(window, id)) as { protocol: string; metadata: string }
      expect(row.protocol).toBe(p.protocol)
      const meta = JSON.parse(row.metadata) as Record<string, unknown>
      expect(Object.keys(meta).length).toBeGreaterThan(0)
    }
  })
})
