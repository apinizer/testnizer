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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createMockFromRequests,
  exampleToMockResponse,
} from '../../src/renderer/components/mock/mock-from-folder'
import { mockEndpointUrl } from '../../src/renderer/components/mock/mock-open-in-tab'
import { setLocale } from '../../src/renderer/lib/i18n'
import { bracesToPathVariables } from '../../src/shared/path-variables'
import type { SavedResponse } from '../../src/renderer/types'

type Row = { name?: string; path?: string; url?: string; method?: string }
type Example = Partial<SavedResponse> & { body?: string; headers?: Record<string, string> }

function savedExample({ body, headers, ...row }: Example, extra: object = {}): SavedResponse {
  return {
    name: 'example',
    status_code: 200,
    response_json: JSON.stringify({ body, headers, ...extra }),
    ...row,
  } as SavedResponse
}

function bridge(
  endpoints: Record<string, Row>,
  saved: Record<string, Row> = {},
  ports: number[] = [],
  examples: Record<string, SavedResponse[]> = {},
) {
  const created: Array<{ serverId: string; method: string; path: string; pathMode: string }> = []
  const responses: Array<Record<string, unknown>> = []
  const serverCreate = vi.fn(
    (input: { port: number; name: string; projectId: string; host: string }) =>
      Promise.resolve({ success: true, data: { id: 'srv-1', ...input } }) as Promise<{
        success: boolean
        data?: { id: string }
        error?: string
      }>,
  )
  const serverDelete = vi.fn((_id: string) => Promise.resolve({ success: true }))
  const endpointCreate = vi.fn((input: (typeof created)[number]) => {
    created.push(input)
    return Promise.resolve({
      success: true,
      data: { ...input, id: `ep-${created.length}` },
    }) as Promise<{ success: boolean; data?: { id: string }; error?: string }>
  })
  const responseCreate = vi.fn((input: Record<string, unknown>) => {
    responses.push(input)
    return Promise.resolve({ success: true, data: input }) as Promise<{
      success: boolean
      error?: string
    }>
  })
  const savedList = vi.fn((ownerType: string, id: string) =>
    Promise.resolve({ success: true, data: examples[`${ownerType}:${id}`] ?? [] }),
  )
  const api = {
    mock: {
      server: {
        list: () => Promise.resolve({ success: true, data: ports.map((port) => ({ port })) }),
        create: serverCreate,
        delete: serverDelete,
      },
      endpoint: { create: endpointCreate },
      response: { create: responseCreate },
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
    savedResponse: { list: savedList },
  }
  return { api, created, responses, serverCreate, serverDelete, endpointCreate, responseCreate }
}

beforeEach(() => setLocale('en'))

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

  it('the same endpoint as the current importer writes it, with `:petId`', async () => {
    const importerPath = `https://petstore.swagger.io/v2${bracesToPathVariables('/pet/{petId}/uploadImage', [])}`
    expect(importerPath).toBe('https://petstore.swagger.io/v2/pet/:petId/uploadImage')
    const { api, created } = bridge({ e1: { method: 'POST', path: importerPath } })

    await createMockFromRequests(api as never, { projectId: 'p', name: 'pet', ids: ['e1'] })

    expect(created).toEqual([
      { serverId: 'srv-1', method: 'POST', path: '/v2/pet/:petId/uploadImage', pathMode: 'param' },
    ])
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

  it('an endpoint with no examples answers an empty 200, not a 501', async () => {
    const { api, responses } = bridge({ a: { path: '/a' } })

    const r = await createMockFromRequests(api as never, { projectId: 'p', name: 'x', ids: ['a'] })

    expect(responses).toEqual([
      {
        endpointId: 'ep-1',
        name: 'default',
        statusCode: 200,
        headers: [],
        bodyType: 'json',
        body: '',
        order: 0,
      },
    ])
    expect(r).toEqual({ ok: true, endpointsCreated: 1, responsesCreated: 1, warnings: [] })
  })

  it("replays a request's saved examples, in order", async () => {
    const { api, responses } = bridge({ a: { path: '/a' } }, {}, [], {
      'endpoint:a': [
        savedExample({
          name: 'Found',
          status_code: 201,
          body: '<a/>',
          headers: { 'Content-Type': 'text/xml', 'X-A': '1' },
        }),
        savedExample({ name: 'Gone', status_code: 404, body: '{}' }),
      ],
    })

    await createMockFromRequests(api as never, { projectId: 'p', name: 'x', ids: ['a'] })

    expect(responses).toEqual([
      {
        endpointId: 'ep-1',
        name: 'Found',
        statusCode: 201,
        headers: [
          { name: 'Content-Type', value: 'text/xml' },
          { name: 'X-A', value: '1' },
        ],
        bodyType: 'xml',
        body: '<a/>',
        order: 0,
      },
      expect.objectContaining({ name: 'Gone', statusCode: 404, body: '{}', order: 1 }),
    ])
  })

  it("a saved request's examples are read under its own owner type", async () => {
    const { api, responses } = bridge({}, { s: { url: '/s' } }, [], {
      'saved_request:s': [savedExample({ name: 'Mine', body: 'hi' })],
    })

    await createMockFromRequests(api as never, { projectId: 'p', name: 'x', ids: ['s'] })

    expect(responses[0]).toMatchObject({ name: 'Mine', body: 'hi' })
  })

  it('does not replay headers about the original bytes: a gzip header on plain text breaks clients', () => {
    const response = exampleToMockResponse(
      savedExample({
        body: '{}',
        headers: {
          'content-encoding': 'gzip',
          'Content-Length': '999',
          'Transfer-Encoding': 'chunked',
          'Content-Type': 'application/json',
        },
      }),
    )
    expect(response?.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }])
  })

  it('names a binary example it had to leave out; the endpoint still answers', async () => {
    const { api, responses } = bridge({ a: { name: 'Logo', path: '/logo' } }, {}, [], {
      'endpoint:a': [savedExample({ name: 'png', body: 'AAAA' }, { bodyEncoding: 'base64' })],
    })

    const r = await createMockFromRequests(api as never, { projectId: 'p', name: 'x', ids: ['a'] })

    expect(r.warnings).toEqual(['Example "png" of "Logo" has a binary body and was skipped.'])
    expect(responses.map((o) => o.name)).toEqual(['default'])
  })

  it('an unreadable example does not stop the import', () => {
    const response = exampleToMockResponse({
      name: 'x',
      status_code: 500,
      response_json: '{ nope',
    } as SavedResponse)
    expect(response).toMatchObject({ statusCode: 500, body: '' })
  })

  it('names what it skipped', async () => {
    const { api } = bridge({ a: { name: 'No URL', path: '' }, b: { path: '/b' } })

    const r = await createMockFromRequests(api as never, {
      projectId: 'p',
      name: 'x',
      ids: ['a', 'b', 'gone'],
    })

    expect(r.ok).toBe(true)
    expect(r.endpointsCreated).toBe(1)
    expect(r.warnings).toEqual([
      '"No URL" was skipped: it has no URL a mock can bind.',
      'A request could not be read and was skipped.',
    ])
  })

  it('a refused server is reported with its reason', async () => {
    const { api, serverCreate, endpointCreate } = bridge({ a: { path: '/a' } })
    serverCreate.mockResolvedValueOnce({ success: false, error: 'port in use' })

    const r = await createMockFromRequests(api as never, { projectId: 'p', name: 'x', ids: ['a'] })

    expect(r).toMatchObject({ ok: false, error: 'port in use' })
    expect(endpointCreate).not.toHaveBeenCalled()
  })

  it('a refused endpoint is named and the rest still arrive', async () => {
    const { api, endpointCreate } = bridge({
      a: { name: 'A', path: '/a' },
      b: { name: 'B', path: '/b' },
    })
    endpointCreate.mockResolvedValueOnce({ success: false, error: 'duplicate' })

    const r = await createMockFromRequests(api as never, {
      projectId: 'p',
      name: 'x',
      ids: ['a', 'b'],
    })

    expect(r).toMatchObject({ ok: true, endpointsCreated: 1, responsesCreated: 1 })
    expect(r.warnings).toEqual(['"A" could not be added: duplicate'])
  })

  it('a refused response is named', async () => {
    const { api, responseCreate } = bridge({ a: { name: 'A', path: '/a' } })
    responseCreate.mockResolvedValueOnce({ success: false, error: 'bad body' })

    const r = await createMockFromRequests(api as never, { projectId: 'p', name: 'x', ids: ['a'] })

    expect(r).toMatchObject({ ok: true, endpointsCreated: 1, responsesCreated: 0 })
    expect(r.warnings).toEqual(['A response of "A" could not be added: bad body'])
  })

  it('nothing to mock leaves no empty server behind', async () => {
    const { api, serverDelete } = bridge({ a: { name: 'A', path: '' } })

    const r = await createMockFromRequests(api as never, { projectId: 'p', name: 'x', ids: ['a'] })

    expect(r).toMatchObject({ ok: false, endpointsCreated: 0 })
    expect(r.error).toContain('"A"')
    expect(serverDelete).toHaveBeenCalledWith('srv-1')
  })

  it('a crash half way leaves no half-built server behind', async () => {
    const { api, serverDelete, responseCreate } = bridge({ a: { path: '/a' } })
    responseCreate.mockRejectedValueOnce(new Error('ipc died'))

    const r = await createMockFromRequests(api as never, { projectId: 'p', name: 'x', ids: ['a'] })

    expect(r).toMatchObject({ ok: false, error: 'ipc died' })
    expect(serverDelete).toHaveBeenCalledWith('srv-1')
  })
})
