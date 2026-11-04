/**
 * "Create mock server from this folder / request" (the APIs tree menu): one
 * server, one endpoint per request, method + path only. Responses are configured
 * on the mock.
 *
 * The stored URL of a request is rarely a path (`requestUrlToMockPath`): this is
 * the seam between the importers and the mock, so its test feeds it what the
 * OpenAPI importer really writes.
 */
import { requestUrlToMockPath } from '../../../shared/mock-path'

type IpcRow<T> = { success: boolean; data?: T }

/** The slice of `window.api` this flow uses. */
export interface MockFromFolderApi {
  mock: {
    server: {
      list(projectId: string): Promise<IpcRow<Array<{ port: number }>>>
      create(input: {
        projectId: string
        name: string
        host: string
        port: number
      }): Promise<IpcRow<{ id: string }>>
    }
    endpoint: {
      create(input: {
        serverId: string
        method: string
        path: string
        pathMode: string
      }): Promise<unknown>
    }
  }
  endpoint: { get(id: string): Promise<IpcRow<{ path?: string; method?: string }>> }
  savedRequest: { get(id: string): Promise<IpcRow<{ url?: string; method?: string }>> }
}

/** Endpoint rows hold the URL in `path`, saved requests in `url`. */
async function readRequestTarget(
  api: MockFromFolderApi,
  id: string,
): Promise<{ url: string; method: string } | null> {
  const ep = await api.endpoint.get(id)
  if (ep?.success && ep.data) return { url: ep.data.path ?? '', method: ep.data.method || 'GET' }
  const saved = await api.savedRequest.get(id)
  if (saved?.success && saved.data) {
    return { url: saved.data.url ?? '', method: saved.data.method || 'GET' }
  }
  return null
}

/** Creates the server and its endpoints; false when the server could not be created. */
export async function createMockFromRequests(
  api: MockFromFolderApi,
  o: { projectId: string; name: string; ids: readonly string[] },
): Promise<boolean> {
  // The next free port above 8080 (project-scoped): mock ports bind 127.0.0.1.
  const listed = await api.mock.server.list(o.projectId)
  const usedPorts = new Set((listed?.data ?? []).map((s) => s.port))
  let port = 8080
  while (usedPorts.has(port) && port < 65535) port++

  const server = await api.mock.server.create({
    projectId: o.projectId,
    name: o.name,
    host: '127.0.0.1',
    port,
  })
  if (!server?.success || !server.data) return false

  for (const id of o.ids) {
    const target = await readRequestTarget(api, id)
    const bound = target && requestUrlToMockPath(target.url)
    if (!target || !bound) continue
    await api.mock.endpoint.create({
      serverId: server.data.id,
      method: target.method,
      path: bound.path,
      pathMode: bound.mode,
    })
  }
  return true
}
