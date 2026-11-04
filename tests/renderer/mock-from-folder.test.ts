/**
 * APIs → Import OpenAPI → folder → "Create mock server from this folder" →
 * "Open in request tab".
 *
 * Each step had its tests, none fed the next one's real output: the mock tests
 * build endpoints by hand with a clean `/orders`, the tree test replaces this
 * flow with a vi.fn(). The rows below are what the OpenAPI importer writes
 * (`import-export.handler.ts`: `endpoints.path` = server + path), so the chain
 * is pinned at both seams.
 */
import { describe, it, expect, vi } from 'vitest'
import { createMockFromRequests } from '../../src/renderer/components/mock/mock-from-folder'
import { mockEndpointUrl } from '../../src/renderer/components/mock/mock-open-in-tab'

type Row = { path?: string; url?: string; method?: string }

function bridge(
  endpoints: Record<string, Row>,
  saved: Record<string, Row> = {},
  ports: number[] = [],
) {
  const created: Array<{ serverId: string; method: string; path: string; pathMode: string }> = []
  const serverCreate = vi.fn(
    (input: { port: number; name: string; projectId: string; host: string }) =>
      Promise.resolve({ success: true, data: { id: 'srv-1', ...input } }),
  )
  const api = {
    mock: {
      server: {
        list: () => Promise.resolve({ success: true, data: ports.map((port) => ({ port })) }),
        create: serverCreate,
      },
      endpoint: {
        create: (input: (typeof created)[number]) => {
          created.push(input)
          return Promise.resolve({ success: true, data: input })
        },
      },
    },
    endpoint: {
      get: (id: string) =>
        Promise.resolve(
          endpoints[id]
            ? { success: true, data: endpoints[id] }
            : { success: false, error: 'nope' },
        ),
    },
    savedRequest: {
      get: (id: string) =>
        Promise.resolve(
          saved[id] ? { success: true, data: saved[id] } : { success: false, error: 'nope' },
        ),
    },
  }
  return { api, created, serverCreate }
}

describe('create mock server from a folder', () => {
  it('an imported OpenAPI endpoint binds its path, and opens on the mock — the reported URL', async () => {
    const { api, created } = bridge({
      e1: {
        method: 'POST',
        path: 'https://petstore.swagger.io/v2/pet/{petId}/uploadImage',
      },
    })

    await createMockFromRequests(api as never, { projectId: 'p', name: 'pet', ids: ['e1'] })

    expect(created).toEqual([
      { serverId: 'srv-1', method: 'POST', path: '/v2/pet/:petId/uploadImage', pathMode: 'param' },
    ])
    expect(mockEndpointUrl({ host: '127.0.0.1', port: 8080, basePath: '' }, created[0].path)).toBe(
      'http://127.0.0.1:8080/v2/pet/:petId/uploadImage',
    )
  })

  it('a saved request with a {{baseUrl}} URL binds the same way', async () => {
    const { api, created } = bridge(
      {},
      { s1: { method: 'GET', url: '{{baseUrl}}/pet/{{id}}?x=1' } },
    )

    await createMockFromRequests(api as never, { projectId: 'p', name: 'pet', ids: ['s1'] })

    expect(created[0]).toMatchObject({ path: '/pet/:id', pathMode: 'param', method: 'GET' })
  })

  it('a request with no usable URL is skipped and the rest still arrive', async () => {
    const { api, created } = bridge({ a: { path: '' }, b: { method: 'GET', path: '/b' } })

    await createMockFromRequests(api as never, {
      projectId: 'p',
      name: 'x',
      ids: ['a', 'b', 'gone'],
    })

    expect(created.map((c) => c.path)).toEqual(['/b'])
  })

  it('takes the next free port above 8080', async () => {
    const { api, serverCreate } = bridge({ a: { path: '/a' } }, {}, [8080, 8081])

    await createMockFromRequests(api as never, { projectId: 'p', name: 'x', ids: ['a'] })

    expect(serverCreate.mock.calls[0][0]).toMatchObject({ port: 8082, host: '127.0.0.1' })
  })
})
