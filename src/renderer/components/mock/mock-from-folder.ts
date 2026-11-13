/**
 * "Create mock server from this folder / request" (the APIs tree menu): one
 * server, one endpoint per request. A request's saved examples become its
 * responses; one without examples answers an empty 200, because an endpoint with
 * no response answers 501 until someone configures it.
 *
 * The stored URL of a request is rarely a path (`requestUrlToMockPath`): this is
 * the seam between the importers and the mock, so its test feeds it what the
 * OpenAPI importer really writes.
 */
import { importedMockText } from '../../../shared/mock-imported-text'
import { requestUrlToMockPath } from '../../../shared/mock-path'
import { isHttpMockableProtocol } from '../../../shared/request-protocols'
import { t } from '../../lib/i18n'
import type { SavedResponse, SavedResponseOwnerType } from '../../types'
import type { MockImportResult } from './mock-import-file'

type IpcRow<T> = { success: boolean; data?: T; error?: string }

export interface MockResponseFromExample {
  name: string
  statusCode: number
  headers: Array<{ name: string; value: string }>
  bodyType: 'json' | 'xml' | 'html' | 'text'
  body: string
}

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
      delete(id: string): Promise<unknown>
    }
    endpoint: {
      create(input: {
        serverId: string
        method: string
        path: string
        pathMode: string
      }): Promise<IpcRow<{ id: string }>>
    }
    response: {
      create(
        input: MockResponseFromExample & { endpointId: string; order: number },
      ): Promise<IpcRow<unknown>>
    }
  }
  endpoint: {
    get(id: string): Promise<
      IpcRow<{
        name?: string
        path?: string
        method?: string
        protocol?: string | null
        request_schema?: string | null
      }>
    >
  }
  savedRequest: {
    get(
      id: string,
    ): Promise<IpcRow<{ name?: string; url?: string; method?: string; protocol?: string | null }>>
  }
  savedResponse: {
    list(ownerType: SavedResponseOwnerType, ownerId: string): Promise<IpcRow<SavedResponse[]>>
  }
}

interface RequestTarget {
  name: string
  url: string
  method: string
  protocol: string | null | undefined
  ownerType: SavedResponseOwnerType
}

/** The URL the editor shows. `path` is what an importer kept for the tree; old rows say `/pets/*`. */
function endpointUrl(row: { path?: string; request_schema?: string | null }): string {
  try {
    const url = (JSON.parse(row.request_schema ?? '{}') as { url?: unknown } | null)?.url
    if (typeof url === 'string' && url) return url
  } catch {
    /* A broken schema still has a path. */
  }
  return row.path ?? ''
}

/** Endpoint rows hold the URL in `request_schema`, saved requests in `url`. */
async function readRequestTarget(
  api: MockFromFolderApi,
  id: string,
): Promise<RequestTarget | null> {
  const ep = await api.endpoint.get(id)
  if (ep?.success && ep.data) {
    return {
      name: ep.data.name || ep.data.path || id,
      url: endpointUrl(ep.data),
      method: ep.data.method || 'GET',
      protocol: ep.data.protocol,
      ownerType: 'endpoint',
    }
  }
  const saved = await api.savedRequest.get(id)
  if (saved?.success && saved.data) {
    return {
      name: saved.data.name || saved.data.url || id,
      url: saved.data.url ?? '',
      method: saved.data.method || 'GET',
      protocol: saved.data.protocol,
      ownerType: 'saved_request',
    }
  }
  return null
}

/** They describe the original bytes on the wire, not the text the mock will send. */
const NOT_REPLAYED_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
])

function bodyTypeOf(contentType: string): MockResponseFromExample['bodyType'] {
  if (/json/i.test(contentType)) return 'json'
  if (/xml/i.test(contentType)) return 'xml'
  if (/html/i.test(contentType)) return 'html'
  return contentType ? 'text' : 'json'
}

/**
 * Null when the example cannot be replayed: a mock body is text, this one is binary.
 * An imported example is somebody else's text: it cannot read project variables.
 */
export function exampleToMockResponse(row: SavedResponse): MockResponseFromExample | null {
  let saved: {
    status?: number
    headers?: Record<string, string>
    body?: string
    bodyEncoding?: string
  }
  try {
    saved = JSON.parse(row.response_json) ?? {}
  } catch {
    saved = {}
  }
  if (saved.bodyEncoding === 'base64') return null
  const headers = Object.entries(saved.headers ?? {})
    .filter(([name]) => !NOT_REPLAYED_HEADERS.has(name.toLowerCase()))
    .map(([name, value]) => ({ name, value: importedMockText(String(value)) }))
  const contentType =
    headers.find((header) => header.name.toLowerCase() === 'content-type')?.value ?? ''
  return {
    name: row.name,
    statusCode: row.status_code ?? saved.status ?? 200,
    headers,
    bodyType: bodyTypeOf(contentType),
    body: importedMockText(saved.body ?? ''),
  }
}

const holdsEscapedText = (response: MockResponseFromExample): boolean =>
  [response.body, ...response.headers.map((header) => header.value)].some((text) =>
    text.includes('\\{{'),
  )

async function responsesFor(
  api: MockFromFolderApi,
  id: string,
  target: RequestTarget,
  warnings: string[],
): Promise<MockResponseFromExample[]> {
  const listed = await api.savedResponse.list(target.ownerType, id)
  // Newest first from the repository; a request answers with its first example.
  const rows = [...(listed?.data ?? [])].sort((a, b) => a.created_at - b.created_at)
  const out: MockResponseFromExample[] = []
  for (const row of rows) {
    const response = exampleToMockResponse(row)
    if (response) out.push(response)
    else {
      warnings.push(t('mock.fromFolderBinaryExample', { example: row.name, name: target.name }))
    }
  }
  if (out.some(holdsEscapedText)) {
    warnings.push(t('mock.fromFolderLiteralVariables', { name: target.name }))
  }
  if (out.length > 0) return out
  return [{ name: 'default', statusCode: 200, headers: [], bodyType: 'json', body: '' }]
}

/**
 * Creates the server, its endpoints and their responses. Nothing created, no
 * server left. Only an HTTP-family request becomes an endpoint; the others are
 * named in the warnings, so a folder's WebSocket request does not just vanish.
 */
export async function createMockFromRequests(
  api: MockFromFolderApi,
  o: { projectId: string; name: string; ids: readonly string[] },
): Promise<MockImportResult> {
  const result: MockImportResult = {
    ok: true,
    endpointsCreated: 0,
    responsesCreated: 0,
    warnings: [],
  }
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
  if (!server?.success || !server.data) return { ...result, ok: false, error: server?.error }
  const serverId = server.data.id

  try {
    const bound = new Map<string, string>()
    for (const id of o.ids) await addRequest(api, serverId, id, result, bound)
  } catch (e) {
    await api.mock.server.delete(serverId).catch(() => undefined)
    return { ...result, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (result.endpointsCreated > 0) return result

  await api.mock.server.delete(serverId).catch(() => undefined)
  return { ...result, ok: false, error: result.warnings[0] ?? t('mock.fromFolderNoRequests') }
}

async function addRequest(
  api: MockFromFolderApi,
  serverId: string,
  id: string,
  result: MockImportResult,
  bound: Map<string, string>,
): Promise<void> {
  const target = await readRequestTarget(api, id)
  if (!target) {
    result.warnings.push(t('mock.fromFolderUnreadable'))
    return
  }
  if (!isHttpMockableProtocol(target.protocol)) {
    result.warnings.push(
      t('mock.fromFolderOtherProtocol', { name: target.name, protocol: String(target.protocol) }),
    )
    return
  }
  const mockPath = requestUrlToMockPath(target.url)
  if (!mockPath) {
    result.warnings.push(t('mock.fromFolderSkipped', { name: target.name }))
    return
  }
  // Only the first of two rows on one method + path could ever answer: SOAP
  // operations of one service, GraphQL queries, the repeats of a HAR.
  const slot = `${target.method.toUpperCase()} ${mockPath.path}`
  const taken = bound.get(slot)
  if (taken !== undefined) {
    result.warnings.push(t('mock.fromFolderDuplicate', { name: target.name, first: taken, slot }))
    return
  }
  bound.set(slot, target.name)
  const endpoint = await api.mock.endpoint.create({
    serverId,
    method: target.method,
    path: mockPath.path,
    pathMode: mockPath.mode,
  })
  if (!endpoint?.success || !endpoint.data) {
    result.warnings.push(
      t('mock.fromFolderEndpointFailed', { name: target.name, error: endpoint?.error ?? '' }),
    )
    return
  }
  result.endpointsCreated += 1

  const responses = await responsesFor(api, id, target, result.warnings)
  for (const [order, response] of responses.entries()) {
    const created = await api.mock.response.create({
      ...response,
      endpointId: endpoint.data.id,
      order,
    })
    if (created?.success) result.responsesCreated += 1
    else {
      result.warnings.push(
        t('mock.fromFolderResponseFailed', { name: target.name, error: created?.error ?? '' }),
      )
    }
  }
}
