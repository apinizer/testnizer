/**
 * Mock importers — turn OpenAPI specs and Postman collections into
 * mock endpoints + responses persisted via the repo layer.
 *
 * Both importers are intentionally tolerant: they skip malformed entries and
 * return per-item warnings rather than aborting on the first error.
 *
 * OpenAPI: walks `paths.<path>.<method>.responses[*]` and uses `examples` /
 * `example` / schema-derived sample values as response bodies. An endpoint binds
 * the server's path plus its own: the spec appends one to the other, so the real
 * API answers at `/v1/pets` and the stand-in does too.
 *
 * Postman v1, v2.x and v3 collections (JSON or YAML) reach one walker as v2: it
 * goes through `item[]` recursively, takes each request's method+url, and uses
 * saved `response[]` arrays as mock responses (falling back to a default 200 with
 * empty body when none are provided).
 */

import { InputDocumentError } from '../../shared/bounded-document'
import { importedMockText } from '../../shared/mock-imported-text'
import { requestUrlToMockPath, templatedPathToMockPath } from '../../shared/mock-path'
import {
  openApiProblem,
  openApiProblemMessage,
  openApiServersProblem,
} from '../../shared/openapi-detect'
import { getDb } from '../db/database'
import {
  createMockEndpoint as repoCreateEndpoint,
  createMockResponse as repoCreateResponse,
  getMockServer,
} from '../db/mock.repo'
import {
  boundedJson,
  dereferenceLocalRefs,
  newJsonBudget,
  type JsonBudget,
} from '../import/openapi-refs'
import { detectPostman } from '../import/postman/detect'
import { convertV1Collection } from '../import/postman/v1'
import { convertV3Collection } from '../import/postman/v3/to-v2'
import { importErrorText, parseJsonOrYamlBounded } from '../import/safe-input'

export interface ImportResult {
  ok: boolean
  endpointsCreated: number
  responsesCreated: number
  warnings: string[]
  error?: string
}

interface OpenApiServer {
  url?: string
  variables?: Record<string, { default?: unknown }>
}
interface OpenApiOperation {
  summary?: string
  description?: string
  /** Swagger 2.0: what the operation returns; overrides the document's list. */
  produces?: string[]
  responses?: Record<string, OpenApiResponse>
  servers?: OpenApiServer[]
}
interface OpenApiResponse {
  description?: string
  content?: Record<string, OpenApiMediaType>
  /** Swagger 2.0 keeps these on the response itself, not under `content`. */
  schema?: unknown
  examples?: Record<string, unknown>
}
interface OpenApiMediaType {
  example?: unknown
  examples?: Record<string, { value?: unknown; summary?: string }>
  schema?: unknown
}
type OpenApiPathItem = Record<string, OpenApiOperation> & { servers?: OpenApiServer[] }
type OpenApiDoc = {
  produces?: string[]
  /** Swagger 2.0's prefix; OpenAPI 3 keeps it in the server URL. */
  basePath?: string
  servers?: OpenApiServer[]
  paths?: Record<string, OpenApiPathItem>
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

/**
 * Response text from the file, unable to read project variables
 * (`src/shared/mock-imported-text.ts`). `report` names what changed, once.
 */
function importedTextGuard(): {
  text: (value: string) => string
  report: (warnings: string[]) => void
} {
  let escaped = 0
  return {
    text(value) {
      const out = importedMockText(value)
      if (out !== value) escaped++
      return out
    },
    report(warnings) {
      if (escaped === 0) return
      warnings.push(
        `${escaped} imported response value(s) hold {{…}} text that is sent as written, not read from project variables. To use a variable, remove the backslash in the mock editor.`,
      )
    },
  }
}

/** A file claiming more than this is refused: aliases can multiply a small file's requests. */
const MAX_ENDPOINTS = 20_000

function endpointSlot(created: number): void {
  if (created >= MAX_ENDPOINTS) {
    throw new InputDocumentError(`This file holds more than ${MAX_ENDPOINTS} requests.`)
  }
}

export async function importOpenApi(serverId: string, sourceText: string): Promise<ImportResult> {
  const warnings: string[] = []
  const failed = (error: string): ImportResult => ({
    ok: false,
    endpointsCreated: 0,
    responsesCreated: 0,
    warnings,
    error,
  })
  let parsed: unknown
  try {
    parsed = parseJsonOrYamlBounded(sourceText, 'OpenAPI spec')
  } catch (e) {
    return failed('Could not parse spec: ' + (e instanceof Error ? e.message : String(e)))
  }

  // The file's format is fatal; a broken reference inside a real spec is a warning.
  const problem = openApiProblem(parsed)
  if (problem) return failed(openApiProblemMessage(problem))

  const doc: OpenApiDoc = await dereferenceLocalRefs(parsed as OpenApiDoc, warnings)
  if (!doc.paths) return failed('Spec has no `paths` section.')
  const paths = doc.paths

  const serversProblem = openApiServersProblem(doc)
  if (serversProblem) warnings.push(serversProblem)
  const servers = Array.isArray(doc.servers) ? doc.servers : []
  const prefixes = new Set(servers.map(serverPrefix))
  if (prefixes.size > 1) {
    const used = serverPrefix(servers[0]) || '/'
    warnings.push(`The spec's servers have different paths; the first one (${used}) was used.`)
  }
  const ownBasePath = getMockServer(serverId)?.base_path ?? ''
  const budget = newJsonBudget()
  const imported = importedTextGuard()

  let endpointsCreated = 0
  let responsesCreated = 0
  try {
    getDb().transaction(() => {
      for (const [rawPath, pathItem] of Object.entries(paths)) {
        if (!isPlainObject(pathItem)) {
          warnings.push(`Skipped "${rawPath}": it is not a path definition.`)
          continue
        }
        for (const [methodLower, op] of Object.entries(pathItem)) {
          if (!HTTP_METHODS.has(methodLower)) continue
          const method = methodLower.toUpperCase()
          if (!isPlainObject(op)) {
            warnings.push(`Skipped ${method} ${rawPath}: it is not an operation.`)
            continue
          }
          endpointSlot(endpointsCreated)
          const opt = op as OpenApiOperation
          const prefix = withoutBasePath(operationPrefix(doc, pathItem, opt), ownBasePath)
          const { path, mode } = templatedPathToMockPath(joinPrefix(prefix, rawPath))
          const ep = repoCreateEndpoint({
            serverId,
            method,
            path,
            pathMode: mode,
            description: textOf(opt.summary) || textOf(opt.description),
            priority: 0,
            enabled: true,
          })
          endpointsCreated++

          const responses = isPlainObject(opt.responses) ? opt.responses : {}
          const responseEntries = Object.entries(responses)
          if (responseEntries.length === 0) {
            // Default 200 placeholder
            repoCreateResponse({
              endpointId: ep.id,
              name: 'default',
              statusCode: 200,
              headers: [],
              bodyType: 'json',
              body: '',
              delayMs: 0,
              condition: { type: 'always' },
              order: 0,
              enabled: true,
            })
            responsesCreated++
            continue
          }

          let order = 0
          for (const [statusKey, responseDef] of responseEntries) {
            const status = parseStatusKey(statusKey)
            const contentEntries = Object.entries(
              responseMedia(responseDef, opt.produces ?? doc.produces),
            )
            if (contentEntries.length === 0) {
              repoCreateResponse({
                endpointId: ep.id,
                name: textOf(responseDef?.description) || statusKey,
                statusCode: status,
                headers: [],
                bodyType: 'json',
                body: '',
                delayMs: 0,
                condition: { type: 'always' },
                order: order++,
                enabled: true,
              })
              responsesCreated++
              continue
            }
            for (const [contentType, media] of contentEntries) {
              const bodyType = mediaTypeToBodyType(contentType)
              const body = imported.text(sampleFromMedia(media, budget))
              repoCreateResponse({
                endpointId: ep.id,
                name: `${statusKey} ${contentType}`,
                statusCode: status,
                headers: [{ name: 'Content-Type', value: contentType }],
                bodyType,
                body,
                delayMs: 0,
                condition: { type: 'always' },
                order: order++,
                enabled: true,
              })
              responsesCreated++
            }
          }
        }
      }
    })()
  } catch (e) {
    return failed(importErrorText(e))
  }
  if (budget.trimmed > 0) {
    warnings.push(`${budget.trimmed} response example(s) were too large and were cut short.`)
  }
  imported.report(warnings)

  return {
    ok: true,
    endpointsCreated,
    responsesCreated,
    warnings,
  }
}

/** The path a server URL puts before every endpoint, without its trailing slash. */
function serverPrefix(server: OpenApiServer | undefined): string {
  if (typeof server?.url !== 'string') return ''
  const url = server.url.replace(/\{([^}]+)\}/g, (whole, name: string) => {
    const value = server.variables?.[name]?.default
    return value === undefined ? whole : String(value)
  })
  return (requestUrlToMockPath(url)?.path ?? '').replace(/\/+$/, '')
}

/** The nearest `servers` wins: operation, then path item, then document (spec order). */
function operationPrefix(doc: OpenApiDoc, pathItem: OpenApiPathItem, op: OpenApiOperation): string {
  const servers = [op.servers, pathItem.servers, doc.servers].find(
    (list) => Array.isArray(list) && list.length > 0,
  )
  if (servers) return serverPrefix(servers[0])
  return textOf(doc.basePath).replace(/\/+$/, '')
}

/** A mock with its own base path already strips it from every request. */
function withoutBasePath(prefix: string, basePath: string): string {
  const base = `/${basePath.replace(/^\/+|\/+$/g, '')}`
  if (base === '/') return prefix
  if (prefix === base) return ''
  return prefix.startsWith(`${base}/`) ? prefix.slice(base.length) : prefix
}

function joinPrefix(prefix: string, path: string): string {
  if (!prefix) return path
  return path === '/' ? prefix : `${prefix}${path}`
}

/** The response's bodies by media type, for OpenAPI 3 (`content`) and Swagger 2.0 alike. */
function responseMedia(
  response: OpenApiResponse | null | undefined,
  produces: string[] | undefined,
): Record<string, OpenApiMediaType> {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return {}
  if (isPlainObject(response.content)) return response.content as Record<string, OpenApiMediaType>
  const media: Record<string, OpenApiMediaType> = {}
  const examples = isPlainObject(response.examples) ? response.examples : {}
  for (const [type, example] of Object.entries(examples)) {
    media[type] = { example }
  }
  if (Object.keys(media).length > 0 || !response.schema) return media
  return { [produces?.[0] ?? 'application/json']: { schema: response.schema } }
}

function parseStatusKey(key: string): number {
  if (key === 'default') return 200
  const n = Number(key)
  if (Number.isFinite(n) && n >= 100 && n < 600) return n
  return 200
}

function mediaTypeToBodyType(ct: string): 'json' | 'xml' | 'text' | 'html' {
  if (/json/i.test(ct)) return 'json'
  if (/xml/i.test(ct)) return 'xml'
  if (/html/i.test(ct)) return 'html'
  return 'text'
}

function sampleFromMedia(media: OpenApiMediaType, budget: JsonBudget): string {
  if (!isPlainObject(media)) return ''
  if (media.example !== undefined) return boundedJson(media.example, budget, 2)
  if (isPlainObject(media.examples)) {
    const first = Object.values(media.examples)[0]
    if (isPlainObject(first) && first.value !== undefined) {
      return boundedJson(first.value, budget, 2)
    }
  }
  if (media.schema) return boundedJson(sampleFromSchema(media.schema), budget, 2)
  return ''
}

/** Enough for any sample a person reads; stops linked schemas from multiplying. */
const SAMPLE_NODE_LIMIT = 2000

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

const textOf = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Generate a tiny sample value from a JSON Schema. Best-effort, draft-07-ish.
 * Dereferencing turns a self-referencing schema into a cycle: a schema already on
 * the way down samples as null, or a tree type would overflow the stack mid-import.
 *
 * A declared type alone only says what shape a value has: `oneOf` and `allOf` can
 * narrow it, so their samples come before the type's placeholder.
 */
function sampleFromSchema(
  schema: unknown,
  walk = { path: new Set<object>(), left: SAMPLE_NODE_LIMIT },
): unknown {
  if (!schema || typeof schema !== 'object') return null
  if (walk.path.has(schema) || walk.left <= 0) return null
  walk.left -= 1
  const s = schema as Record<string, unknown>
  if (s.example !== undefined) return s.example
  if (s.const !== undefined) return s.const
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0]

  // OpenAPI 3.1 writes a nullable type as `['string', 'null']`.
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type
  if (type === 'string' && typeof s.default === 'string') return s.default
  if ((type === 'integer' || type === 'number') && typeof s.default === 'number') return s.default
  if (type === 'boolean' && typeof s.default === 'boolean') return s.default
  walk.path.add(schema)
  try {
    const composed = composedSamples(s, walk)
    return mergeSamples([...composed, ownSample(s, type, walk)])
  } finally {
    walk.path.delete(schema)
  }
}

/** The value the schema's own type and properties stand for, with no composition. */
function ownSample(
  s: Record<string, unknown>,
  type: unknown,
  walk: { path: Set<object>; left: number },
): unknown {
  if (type === 'string') return 'string'
  if (type === 'integer' || type === 'number') return 0
  if (type === 'boolean') return true
  if (type === 'array') return [sampleFromSchema(s.items, walk)]
  return type === 'object' || s.properties ? sampleProperties(s.properties, walk) : null
}

function sampleProperties(
  properties: unknown,
  walk: { path: Set<object>; left: number },
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, sub] of Object.entries((properties ?? {}) as Record<string, unknown>)) {
    out[k] = sampleFromSchema(sub, walk)
  }
  return out
}

/** `allOf` holds at once; of `oneOf` / `anyOf` the first branch with a value stands in. */
function composedSamples(
  s: Record<string, unknown>,
  walk: { path: Set<object>; left: number },
): unknown[] {
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const samples = list(s.allOf).map((part) => sampleFromSchema(part, walk))
  for (const key of ['oneOf', 'anyOf']) {
    for (const branch of list(s[key])) {
      const sample = sampleFromSchema(branch, walk)
      if (sample === null) continue
      samples.push(sample)
      break
    }
  }
  return samples
}

/** Objects merge, later keys winning; otherwise the first value there is. */
function mergeSamples(samples: unknown[]): unknown {
  const values = samples.filter((v) => v !== null)
  if (values.length === 0) return null
  if (!values.every(isPlainObject)) return values[0]
  return Object.assign({}, ...values)
}

// ─── Postman ────────────────────────────────────────────────

interface PostmanItem {
  name?: string
  request?:
    | string
    | {
        method?: string
        url?:
          | string
          | { raw?: string; path?: string[] | string; query?: { key: string; value: string }[] }
        description?: string | { content?: string }
      }
  item?: PostmanItem[]
  response?: PostmanResponse[]
}
interface PostmanResponse {
  name?: string
  status?: string
  code?: number
  header?: { key: string; value: string }[] | { key: string; value: string }
  body?: string
  _postman_previewlanguage?: string
}
interface PostmanCollection {
  info?: { name?: string; schema?: string }
  item?: PostmanItem[]
}

/**
 * Any Postman collection file as the v2 shape the walker reads. The converters'
 * own notes about auth and scripts are dropped: a mock uses neither, so they would
 * only bury what the mock did lose. A request the conversion skipped is kept, by name.
 */
function readPostmanCollection(
  sourceText: string,
  warnings: string[],
): { collection: PostmanCollection } | { error: string } {
  const { doc, detection } = detectPostman(sourceText)
  const notes: string[] = []
  switch (detection?.kind) {
    case 'v1-collection':
      return { collection: convertV1Collection(doc, notes) as unknown as PostmanCollection }
    case 'v3-collection': {
      const { collection, skippedItems } = convertV3Collection(
        doc as Record<string, unknown>,
        notes,
      )
      warnings.push(...skippedItems)
      return { collection: collection as unknown as PostmanCollection }
    }
    case 'v2-collection':
    case undefined:
      return Array.isArray((doc as PostmanCollection | null)?.item)
        ? { collection: doc as PostmanCollection }
        : { error: 'Collection has no `item` array (is this a Postman collection?).' }
    default:
      return { error: 'This Postman file is not a collection.' }
  }
}

export function importPostman(serverId: string, sourceText: string): ImportResult {
  const warnings: string[] = []
  const failed = (error: string): ImportResult => ({
    ok: false,
    endpointsCreated: 0,
    responsesCreated: 0,
    warnings,
    error,
  })
  let read: ReturnType<typeof readPostmanCollection>
  try {
    read = readPostmanCollection(sourceText, warnings)
  } catch (e) {
    return failed('Could not read the collection: ' + importErrorText(e))
  }
  if ('error' in read) return failed(read.error)
  const parsed = read.collection
  const imported = importedTextGuard()

  let endpointsCreated = 0
  let responsesCreated = 0

  function createResponses(endpointId: string, resps: unknown[]): void {
    let order = 0
    for (const r of resps) {
      if (!isPlainObject(r)) continue
      const res = r as PostmanResponse
      const status = typeof res.code === 'number' ? res.code : Number(res.status) || 200
      const headersArr: { name: string; value: string }[] = []
      const headers = Array.isArray(res.header) ? res.header : res.header ? [res.header] : []
      for (const h of headers) {
        if (isPlainObject(h)) {
          headersArr.push({ name: textOf(h.key), value: imported.text(textOf(h.value)) })
        }
      }
      const lang = textOf(res._postman_previewlanguage).toLowerCase()
      const bodyType =
        lang === 'xml' ? 'xml' : lang === 'html' ? 'html' : lang === 'text' ? 'text' : 'json'
      repoCreateResponse({
        endpointId,
        name: textOf(res.name) || `Response ${order + 1}`,
        statusCode: status,
        headers: headersArr,
        bodyType,
        body: imported.text(textOf(res.body)),
        delayMs: 0,
        condition: { type: 'always' },
        order: order++,
        enabled: true,
      })
      responsesCreated++
    }
  }

  function walk(items: PostmanItem[]): void {
    for (const it of items) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) {
        warnings.push('Skipped an entry that is not a request or a folder.')
        continue
      }
      if (it.item) {
        if (Array.isArray(it.item)) walk(it.item)
        else
          warnings.push(`Skipped "${textOf(it.name) || '?'}": its folder contents are unreadable.`)
        continue
      }
      const req = it.request
      if (!req) {
        warnings.push(`Skipped "${textOf(it.name) || '?'}" — not an HTTP request.`)
        continue
      }
      const method = textOf(typeof req === 'string' ? 'GET' : req.method) || 'GET'
      const path = postmanUrlToPath(typeof req === 'string' ? req : req.url)
      if (!path) {
        warnings.push(`Skipped "${textOf(it.name) || '?'}" — could not parse URL.`)
        continue
      }
      const description =
        typeof req === 'string'
          ? ''
          : typeof req.description === 'string'
            ? req.description
            : textOf(req.description?.content)
      const name = textOf(it.name)

      endpointSlot(endpointsCreated)
      const { path: pathOut, mode } = templatedPathToMockPath(path)
      const ep = repoCreateEndpoint({
        serverId,
        method: method.toUpperCase(),
        path: pathOut,
        pathMode: mode,
        description: name ? `${name}${description ? ' — ' + description : ''}` : description,
        priority: 0,
        enabled: true,
      })
      endpointsCreated++

      const resps = Array.isArray(it.response) ? it.response : []
      if (resps.length === 0) {
        repoCreateResponse({
          endpointId: ep.id,
          name: 'default',
          statusCode: 200,
          headers: [],
          bodyType: 'json',
          body: '',
          delayMs: 0,
          condition: { type: 'always' },
          order: 0,
          enabled: true,
        })
        responsesCreated++
        continue
      }
      createResponses(ep.id, resps)
    }
  }

  try {
    getDb().transaction(() => walk(parsed.item ?? []))()
  } catch (e) {
    return failed(importErrorText(e))
  }
  imported.report(warnings)

  return {
    ok: true,
    endpointsCreated,
    responsesCreated,
    warnings,
  }
}

function postmanUrlToPath(
  url: PostmanItem['request'] extends infer T
    ? T extends { url?: infer U }
      ? U
      : string | undefined
    : never,
): string | null {
  if (!url) return null
  if (typeof url === 'string') {
    return requestUrlToMockPath(url)?.path ?? null
  }
  if (typeof url !== 'object') return null
  if (Array.isArray(url.path)) {
    return '/' + url.path.join('/')
  }
  if (typeof url.path === 'string') {
    return url.path.startsWith('/') ? url.path : `/${url.path}`
  }
  if (typeof url.raw === 'string') {
    return requestUrlToMockPath(url.raw)?.path ?? null
  }
  return null
}
