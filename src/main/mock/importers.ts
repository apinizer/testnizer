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

import OpenAPIParser from '@readme/openapi-parser'
import yaml from 'js-yaml'
import { requestUrlToMockPath, templatedPathToMockPath } from '../../shared/mock-path'
import {
  createMockEndpoint as repoCreateEndpoint,
  createMockResponse as repoCreateResponse,
  getMockServer,
} from '../db/mock.repo'
import { detectPostman } from '../import/postman/detect'
import { convertV1Collection } from '../import/postman/v1'
import { assertBounded } from '../import/postman/v3/safe-parse'
import { convertV3Collection } from '../import/postman/v3/to-v2'

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

export async function importOpenApi(serverId: string, sourceText: string): Promise<ImportResult> {
  const warnings: string[] = []
  let parsed: unknown
  try {
    // Try JSON first, then YAML.
    try {
      parsed = JSON.parse(sourceText)
    } catch {
      parsed = yaml.load(sourceText)
    }
  } catch (e) {
    return {
      ok: false,
      endpointsCreated: 0,
      responsesCreated: 0,
      warnings,
      error: 'Could not parse spec: ' + (e instanceof Error ? e.message : String(e)),
    }
  }

  let doc: OpenApiDoc
  try {
    // Dereference $refs so nested schemas/examples are inlined.
    // Internal refs only. A spec is untrusted input and main has the disk and the
    // network: left to its defaults the parser reads `$ref: /any/file` and fetches
    // `$ref: http://…` the moment the file is imported.
    doc = (await OpenAPIParser.dereference(
      parsed as never,
      {
        resolve: { external: false },
      } as never,
    )) as unknown as OpenApiDoc
  } catch (e) {
    warnings.push(
      'Could not fully dereference spec; using raw document. ' +
        (e instanceof Error ? e.message : String(e)),
    )
    doc = parsed as OpenApiDoc
  }

  const external = externalRefCount(parsed)
  if (external > 0) {
    warnings.push(`${external} reference(s) to other files or URLs were not followed.`)
  }

  let endpointsCreated = 0
  let responsesCreated = 0
  if (!doc?.paths) {
    return {
      ok: false,
      endpointsCreated,
      responsesCreated,
      warnings,
      error: 'Spec has no `paths` section.',
    }
  }

  const prefixes = new Set((doc.servers ?? []).map(serverPrefix))
  if (prefixes.size > 1) {
    const used = serverPrefix(doc.servers?.[0]) || '/'
    warnings.push(`The spec's servers have different paths; the first one (${used}) was used.`)
  }
  const ownBasePath = getMockServer(serverId)?.base_path ?? ''

  for (const [rawPath, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const [methodLower, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(methodLower)) continue
      const method = methodLower.toUpperCase()
      const opt = op as OpenApiOperation
      const prefix = withoutBasePath(operationPrefix(doc, pathItem, opt), ownBasePath)
      const { path, mode } = templatedPathToMockPath(joinPrefix(prefix, rawPath))
      const ep = repoCreateEndpoint({
        serverId,
        method,
        path,
        pathMode: mode,
        description: opt.summary || opt.description || '',
        priority: 0,
        enabled: true,
      })
      endpointsCreated++

      const responses = opt.responses ?? {}
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
            name: responseDef?.description ?? statusKey,
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
          const body = sampleFromMedia(media)
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
  const servers = [op.servers, pathItem.servers, doc.servers].find((list) => list?.length)
  if (servers) return serverPrefix(servers[0])
  return (doc.basePath ?? '').replace(/\/+$/, '')
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

/** `$ref`s leaving the document. A YAML alias can make the tree cyclic, hence `seen`. */
function externalRefCount(node: unknown, seen = new WeakSet<object>()): number {
  if (!node || typeof node !== 'object' || seen.has(node)) return 0
  seen.add(node)
  let count = 0
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) count += 1
    else count += externalRefCount(value, seen)
  }
  return count
}

/** The response's bodies by media type, for OpenAPI 3 (`content`) and Swagger 2.0 alike. */
function responseMedia(
  response: OpenApiResponse | null | undefined,
  produces: string[] | undefined,
): Record<string, OpenApiMediaType> {
  if (!response) return {}
  if (response.content) return response.content
  const media: Record<string, OpenApiMediaType> = {}
  for (const [type, example] of Object.entries(response.examples ?? {})) {
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

function sampleFromMedia(media: OpenApiMediaType): string {
  if (media.example !== undefined) return JSON.stringify(media.example, null, 2)
  if (media.examples) {
    const first = Object.values(media.examples)[0]
    if (first && first.value !== undefined) return JSON.stringify(first.value, null, 2)
  }
  if (media.schema) return JSON.stringify(sampleFromSchema(media.schema), null, 2)
  return ''
}

/** Enough for any sample a person reads; stops linked schemas from multiplying. */
const SAMPLE_NODE_LIMIT = 2000

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Generate a tiny sample value from a JSON Schema. Best-effort, draft-07-ish.
 * Dereferencing turns a self-referencing schema into a cycle: a schema already on
 * the way down samples as null, or a tree type would overflow the stack mid-import.
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
  if (type === 'string') return typeof s.default === 'string' ? s.default : 'string'
  if (type === 'integer' || type === 'number') return typeof s.default === 'number' ? s.default : 0
  if (type === 'boolean') return typeof s.default === 'boolean' ? s.default : true
  walk.path.add(schema)
  try {
    if (type === 'array') return [sampleFromSchema(s.items, walk)]
    const own: unknown =
      type === 'object' || s.properties ? sampleProperties(s.properties, walk) : null
    return mergeSamples([...composedSamples(s, walk), own])
  } finally {
    walk.path.delete(schema)
  }
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
 * own notes (auth, scripts) are dropped: a mock uses neither, so they would only
 * bury what the mock did lose.
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
      assertBounded(doc, 'Postman v3 collection')
      const { collection, skipped } = convertV3Collection(doc as Record<string, unknown>, notes)
      if (skipped > 0) warnings.push(`${skipped} request(s) of an unsupported kind were skipped.`)
      return { collection: collection as unknown as PostmanCollection }
    }
    case 'v2-collection':
    case undefined:
      return (doc as PostmanCollection | null)?.item
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
    return failed('Could not read the collection: ' + (e instanceof Error ? e.message : String(e)))
  }
  if ('error' in read) return failed(read.error)
  const parsed = read.collection

  let endpointsCreated = 0
  let responsesCreated = 0

  function walk(items: PostmanItem[]): void {
    for (const it of items) {
      if (it.item) {
        walk(it.item)
        continue
      }
      const req = it.request
      if (!req) {
        warnings.push(`Skipped "${it.name ?? '?'}" — not an HTTP request.`)
        continue
      }
      const method = (typeof req === 'string' ? 'GET' : req.method) ?? 'GET'
      const path = postmanUrlToPath(typeof req === 'string' ? req : req.url)
      if (!path) {
        warnings.push(`Skipped "${it.name ?? '?'}" — could not parse URL.`)
        continue
      }
      const description =
        typeof req === 'string'
          ? ''
          : typeof req.description === 'string'
            ? req.description
            : (req.description?.content ?? '')

      const { path: pathOut, mode } = templatedPathToMockPath(path)
      const ep = repoCreateEndpoint({
        serverId,
        method: method.toUpperCase(),
        path: pathOut,
        pathMode: mode,
        description: it.name ? `${it.name}${description ? ' — ' + description : ''}` : description,
        priority: 0,
        enabled: true,
      })
      endpointsCreated++

      const resps = it.response ?? []
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
      let order = 0
      for (const r of resps) {
        const status = typeof r.code === 'number' ? r.code : Number(r.status) || 200
        const headersArr: { name: string; value: string }[] = []
        if (Array.isArray(r.header)) {
          for (const h of r.header) headersArr.push({ name: h.key, value: h.value })
        } else if (r.header && typeof r.header === 'object') {
          headersArr.push({ name: r.header.key, value: r.header.value })
        }
        const lang = (r._postman_previewlanguage ?? '').toLowerCase()
        const bodyType =
          lang === 'xml' ? 'xml' : lang === 'html' ? 'html' : lang === 'text' ? 'text' : 'json'
        repoCreateResponse({
          endpointId: ep.id,
          name: r.name ?? `Response ${order + 1}`,
          statusCode: status,
          headers: headersArr,
          bodyType,
          body: r.body ?? '',
          delayMs: 0,
          condition: { type: 'always' },
          order: order++,
          enabled: true,
        })
        responsesCreated++
      }
    }
  }

  walk(parsed.item ?? [])

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
