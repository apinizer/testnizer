/**
 * A pre-request script must not stop `{{variables}}` in headers from resolving.
 *
 * `pm.request.headers` is deliberately populated with the user's TYPED values,
 * before resolution, so a script can read what was written rather than what it
 * expands to. The send path then folded that collection back over the resolved
 * headers — unconditionally, because the script API returns the collection
 * whether or not the script touched it. So the moment ANY pre-request script
 * existed, at project, folder or request level, every header shipped raw:
 *
 *     Authorization: Bearer {{token}}      →  sent literally
 *     X-Req-Id: {{$randomInt}}             →  sent as the text {{$randomInt}}
 *
 * Found while chasing an unrelated e2e failure: a spec pressed Save in project
 * settings, which persists a DEFAULT project pre-request script (a comment), and
 * three files later a header stopped resolving. Every user who opens project
 * settings and saves gets that script.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'

let sent: { headers?: { key: string; value: string }[] } | null = null

function installMockApi() {
  const api = {
    request: {
      send: vi.fn(async (payload: { headers?: { key: string; value: string }[] }) => {
        sent = payload
        return {
          success: true,
          data: {
            requestId: 'r1',
            protocol: 'http',
            status: 200,
            statusText: 'OK',
            headers: {},
            body: '{}',
            timing: { total: 1 },
          },
        }
      }),
      cancel: vi.fn(),
    },
    settings: { get: vi.fn(async () => ({ success: true, data: {} })) },
  }
  ;(globalThis as unknown as { window: { api: typeof api } }).window = { api }
}

/** The header value that actually went on the wire. */
const sentHeader = (key: string): string | undefined =>
  sent?.headers?.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value

beforeEach(() => {
  sent = null
  installMockApi()
  useResponseStore.setState({ byTab: {}, activeTabId: null, response: null, isLoading: false })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    environments: [
      {
        id: 'env1',
        project_id: 'p1',
        name: 'E',
        is_active: true,
        variables: [{ id: 'v1', key: 'token', value: 'secret-abc', initialValue: 'secret-abc', enabled: true }],
      },
    ] as never,
    globalVariables: [],
    activeEnvironmentId: 'env1',
    currentProjectId: 'p1',
  })
  useRequestStore.setState({
    ...useRequestStore.getState(),
    method: 'GET',
    url: 'https://example.test/echo',
    params: [],
    headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
    body: { type: 'none' },
    auth: { type: 'none' },
    preScript: '',
    postScript: '',
    assertions: [],
    _tabStates: new Map(),
    _currentTabId: null,
    _inflightByTab: {},
  })
})

describe('headers resolve whether or not a pre-request script runs', () => {
  it('resolves an env variable with no script (the path that always worked)', async () => {
    await useRequestStore.getState().sendRequest()
    expect(sentHeader('Authorization')).toBe('Bearer secret-abc')
  })

  it('still resolves it when a pre-request script exists but touches nothing', async () => {
    // A comment is exactly what "Save" writes into project settings.
    useRequestStore.setState({ preScript: '// Runs before every request\n' })

    await useRequestStore.getState().sendRequest()

    // The bug: this was the literal string `Bearer {{token}}`.
    expect(sentHeader('Authorization')).toBe('Bearer secret-abc')
  })

  it('resolves a dynamic value under a pre-request script', async () => {
    useRequestStore.setState({
      preScript: '// no-op\n',
      headers: [{ id: 'h1', key: 'X-Req-Id', value: 'hdr-{{$randomInt}}', enabled: true }] as never,
    })

    await useRequestStore.getState().sendRequest()

    expect(sentHeader('X-Req-Id')).toMatch(/^hdr-\d+$/)
  })

  it('keeps a header the script added, resolved', async () => {
    useRequestStore.setState({
      preScript: `pm.request.headers.upsert({ key: 'X-From-Script', value: 'Bearer {{token}}' })`,
    })

    await useRequestStore.getState().sendRequest()

    // A script-supplied value goes through the same resolution as the URL,
    // query params and body.
    expect(sentHeader('X-From-Script')).toBe('Bearer secret-abc')
    // …and the user's own header is not lost by the fold.
    expect(sentHeader('Authorization')).toBe('Bearer secret-abc')
  })

  it('lets the script read the RAW value, which is why the fold exists', async () => {
    useRequestStore.setState({
      preScript: `
        const raw = pm.request.headers.get('Authorization')
        pm.request.headers.upsert({ key: 'X-Seen', value: raw })
      `,
    })

    await useRequestStore.getState().sendRequest()

    // The script sees the typed text; resolution happens after it runs. That
    // contract is deliberate — the fix must not "fix" it by resolving earlier.
    expect(sentHeader('X-Seen')).toBe('Bearer secret-abc')
  })
})
