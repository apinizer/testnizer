import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { getDb } from '../db/database'
import { parseWsdl, parseWsdlFromContent, type WsdlParseResult } from '../protocols/soap.engine'
import { loadProto, type GrpcServiceDescription } from '../protocols/grpc.engine'

interface ImportResult {
  success: boolean
  collectionId?: string
  endpointCount?: number
  folderCount?: number
  /**
   * Newly inserted endpoint IDs in insertion order. Populated by Postman /
   * Insomnia importers so callers (e.g. test suite import) can attach the
   * fresh endpoints to suites without re-querying the DB.
   */
  endpointIds?: string[]
  /** Set when the importer creates an environment row (Postman / Insomnia v4 / v5 environment exports). */
  environmentId?: string
  environmentName?: string
  suggestedEnvVars?: Record<string, string>
  warnings?: string[]
  error?: string
}

interface OpenApiPath {
  [method: string]: {
    summary?: string
    description?: string
    operationId?: string
    tags?: string[]
    parameters?: Array<{
      name: string
      in: string
      required?: boolean
      schema?: { type?: string; default?: string }
      description?: string
    }>
    requestBody?: {
      content?: Record<
        string,
        {
          schema?: Record<string, unknown>
          example?: unknown
          examples?: Record<string, { value?: unknown }>
        }
      >
    }
    responses?: Record<
      string,
      {
        description?: string
        content?: Record<string, { schema?: Record<string, unknown> }>
      }
    >
    security?: Array<Record<string, string[]>>
  }
}

/**
 * Round-trip metadata captured from an imported OpenAPI doc and stashed under
 * `request_schema.openApi`. Lets the exporter rebuild the original spec as
 * faithfully as possible. All fields are optional; older rows without this
 * namespace fall back to sensible defaults during export.
 */
interface OpenApiRoundtripMeta {
  /** First operation tag — exporter emits as `operation.tags[0]`. */
  tags?: string[]
  /** Original `operationId`. Falls back to a slug of the endpoint name. */
  operationId?: string
  /** Security scheme name(s) referenced from operation-level `security[]`. */
  securitySchemeNames?: string[]
  /**
   * Parameter metadata keyed by `${in}:${name}`. Captures `required` and
   * `schema.type` so the exporter doesn't blanket-default every param to
   * `required:false, type:'string'`.
   */
  parameters?: Record<string, { required?: boolean; type?: string }>
  /** Original requestBody content keyed by media type — used to round-trip xml/html. */
  requestBodyContent?: Record<string, string>
  /**
   * Named `examples` keyed by media type → example name → value. OpenAPI lets a
   * requestBody carry multiple named examples; the body editor only surfaces one,
   * so we stash the full set here to round-trip them back to `examples` on export
   * instead of silently dropping all but the first (B-08).
   */
  requestBodyExamples?: Record<string, Record<string, unknown>>
}

interface OpenApiSecurityScheme {
  type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect'
  scheme?: string // for type:'http' — 'basic', 'bearer'
  bearerFormat?: string
  in?: 'header' | 'query' | 'cookie' // for type:'apiKey'
  name?: string // for type:'apiKey'
}

interface OpenApiDoc {
  openapi?: string
  swagger?: string
  info?: { title?: string; description?: string; version?: string }
  servers?: Array<{ url: string; description?: string }>
  host?: string
  basePath?: string
  schemes?: string[]
  paths?: Record<string, OpenApiPath>
  tags?: Array<{ name: string; description?: string }>
  security?: Array<Record<string, string[]>>
  components?: {
    securitySchemes?: Record<string, OpenApiSecurityScheme>
    schemas?: Record<string, JsonSchema>
  }
  // Swagger 2.0 schema definitions
  definitions?: Record<string, JsonSchema>
  // Swagger 2.0 securityDefinitions
  securityDefinitions?: Record<string, OpenApiSecurityScheme & { flow?: string }>
}

type JsonSchema = Record<string, unknown>

/**
 * Produces a sample JSON value from a JSON Schema definition.
 * Used as a fallback when an OpenAPI spec has no inline `example`/`examples`.
 * Keeps generated payloads human-readable instead of dumping raw schema JSON.
 */
function generateJsonExample(
  schema: JsonSchema,
  schemas?: Record<string, JsonSchema> | null,
  _visited: Set<string> = new Set(),
): unknown {
  if (!schema || typeof schema !== 'object') return null

  // $ref resolution
  const ref = schema['$ref'] as string | undefined
  if (ref) {
    const name = ref.replace('#/components/schemas/', '').replace('#/definitions/', '')
    if (_visited.has(name)) return {}
    const resolved = schemas?.[name] as JsonSchema | undefined
    if (resolved) {
      const next = new Set(_visited)
      next.add(name)
      return generateJsonExample(resolved, schemas, next)
    }
    return {}
  }

  // allOf / oneOf / anyOf → use first sub-schema
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const arr = schema[key]
    if (Array.isArray(arr) && arr.length > 0) {
      return generateJsonExample(arr[0] as JsonSchema, schemas, _visited)
    }
  }

  // enum
  const enumVals = schema['enum']
  if (Array.isArray(enumVals) && enumVals.length > 0) return enumVals[0]

  const type = schema['type'] as string | string[] | undefined
  const resolvedType = Array.isArray(type) ? type[0] : type

  if (resolvedType === 'object' || schema['properties']) {
    const props = schema['properties'] as Record<string, JsonSchema> | undefined
    if (!props) return {}
    const out: Record<string, unknown> = {}
    for (const [key, propSchema] of Object.entries(props)) {
      out[key] = generateJsonExample(propSchema, schemas, _visited)
    }
    return out
  }

  if (resolvedType === 'array') {
    const items = schema['items'] as JsonSchema | undefined
    if (items) return [generateJsonExample(items, schemas, _visited)]
    return []
  }

  if (resolvedType === 'string') {
    const format = schema['format'] as string | undefined
    if (format === 'date-time') return new Date().toISOString()
    if (format === 'date') return new Date().toISOString().slice(0, 10)
    if (format === 'uuid') return '00000000-0000-0000-0000-000000000000'
    if (format === 'email') return 'user@example.com'
    if (format === 'uri') return 'https://example.com'
    return ''
  }

  if (resolvedType === 'integer' || resolvedType === 'number') return 0
  if (resolvedType === 'boolean') return false
  if (resolvedType === 'null') return null

  return null
}

export function registerImportExportHandlers(): void {
  // Fetch content from a URL (for importing from URL)
  ipcMain.handle('import:fetchUrl', async (_event, url: string) => {
    try {
      const axios = (await import('axios')).default
      const response = await axios.get(url, { timeout: 30000, responseType: 'text' })
      return { success: true, data: response.data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('import:openFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          // `raml` was missing here even though the importer handles RAML
          // — the OS file dialog greyed out .raml files and forced users
          // to fall back to the URL-import path (v1.4.4 §6.1).
          {
            name: 'API Specs',
            extensions: ['json', 'yaml', 'yml', 'raml', 'wsdl', 'xml', 'proto'],
          },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null }
      }
      const filePath = result.filePaths[0]
      const content = readFileSync(filePath, 'utf-8')
      return { success: true, data: { filePath, content } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'import:openApi',
    async (
      _event,
      payload: {
        projectId: string
        content: string
        format: string
        folderId?: string | null
        sourceUrl?: string
      },
    ) => {
      try {
        const result = await importOpenApi(
          payload.projectId,
          payload.content,
          payload.folderId ?? null,
          payload.sourceUrl,
        )
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('export:openApi', async (_event, projectId: string) => {
    try {
      const data = exportProjectAsOpenApi(projectId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('export:saveFile', async (_event, content: string, defaultName: string) => {
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [
          { name: 'JSON', extensions: ['json'] },
          { name: 'YAML', extensions: ['yaml', 'yml'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      if (result.canceled || !result.filePath) {
        return { success: true, data: null }
      }
      const { writeFileSync } = await import('fs')
      writeFileSync(result.filePath, content, 'utf-8')
      return { success: true, data: result.filePath }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Postman Import ─────────────────────────────────────────
  ipcMain.handle(
    'import:postman',
    async (
      _event,
      payload: {
        projectId: string
        content: string
        folderId?: string | null
      },
    ) => {
      try {
        const result = await importPostman(
          payload.projectId,
          payload.content,
          payload.folderId ?? null,
        )
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Postman Export ─────────────────────────────────────────
  ipcMain.handle('export:postman', async (_event, projectId: string) => {
    try {
      const data = exportAsPostman(projectId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── HAR Import ───────────────────────────────────────────
  ipcMain.handle(
    'import:har',
    async (
      _event,
      payload: {
        projectId: string
        content: string
        folderId?: string | null
      },
    ) => {
      try {
        const result = await importHar(payload.projectId, payload.content, payload.folderId ?? null)
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Environment-only imports (called by EnvironmentModal, not by the
  // APIs Import flow). Keeping these on dedicated channels lets us reject
  // env files coming through the APIs flow without breaking env imports
  // from the Environments modal.
  ipcMain.handle(
    'import:postmanEnvironment',
    async (_event, payload: { projectId: string; content: string }) => {
      try {
        const parsed = JSON.parse(payload.content) as Record<string, unknown>
        if (!parsed || parsed['_postman_variable_scope'] !== 'environment') {
          return {
            success: false,
            error: 'Not a Postman environment export (`_postman_variable_scope` missing).',
          }
        }
        const result = await importPostmanEnvironment(
          payload.projectId,
          parsed as unknown as PostmanEnvironment,
        )
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle(
    'import:insomniaEnvironment',
    async (_event, payload: { projectId: string; content: string }) => {
      try {
        let doc: unknown
        try {
          doc = JSON.parse(payload.content)
        } catch {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const yaml = require('js-yaml') as { load: (s: string) => unknown }
          doc = yaml.load(payload.content)
        }
        if (!isInsomniaV5Environment(doc)) {
          return {
            success: false,
            error:
              'Not an Insomnia environment export (expected `type: environment.insomnia.rest/5.0`).',
          }
        }
        const result = importInsomniaV5Environment(payload.projectId, doc, [])
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Insomnia Import ────────────────────────────────────────
  ipcMain.handle(
    'import:insomnia',
    async (
      _event,
      payload: {
        projectId: string
        content: string
        folderId?: string | null
      },
    ) => {
      try {
        const result = await importInsomnia(
          payload.projectId,
          payload.content,
          payload.folderId ?? null,
        )
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Insomnia Export ────────────────────────────────────────
  ipcMain.handle('export:insomnia', async (_event, projectId: string) => {
    try {
      const data = exportAsInsomnia(projectId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── cURL Import ──────────────────────────────────────────
  ipcMain.handle(
    'import:curl',
    async (
      _event,
      payload: {
        projectId: string
        curlCommand: string
        folderId?: string | null
      },
    ) => {
      try {
        const result = importCurl(payload.projectId, payload.curlCommand, payload.folderId ?? null)
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── cURL Export ──────────────────────────────────────────
  ipcMain.handle('export:curl', async (_event, request: CurlExportRequest) => {
    try {
      const curl = exportAsCurl(request)
      return { success: true, data: curl }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── WSDL Parse for Import (returns parsed services) ─────
  // ─── Proto / gRPC collection import ─────────────────────
  ipcMain.handle(
    'import:proto',
    async (
      _event,
      payload: {
        projectId: string
        protoPath: string
        folderId?: string | null
        serverAddress?: string
      },
    ) => {
      try {
        const result = await importProto(payload)
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('import:wsdl:parse', async (_event, url: string) => {
    try {
      const result = await parseWsdl(url)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('import:wsdl:parseFile', async (_event, content: string) => {
    try {
      const result = await parseWsdlFromContent(content)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── WSDL Import (create folder + endpoints) ─────────────
  ipcMain.handle(
    'import:wsdl',
    async (
      _event,
      payload: {
        projectId: string
        targetFolderId?: string | null
        createNewFolder?: boolean
        newFolderName?: string
        wsdlUrl?: string
        wsdlContent?: string
        parsedWsdl?: WsdlParseResult
      },
    ) => {
      try {
        const result = await importWsdl(payload)
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── SoapUI / ReadyAPI Project Import ───────────────────
  ipcMain.handle(
    'import:soapui',
    async (
      _event,
      payload: {
        projectId: string
        content: string
        folderId?: string | null
      },
    ) => {
      try {
        const result = await importSoapUi(payload)
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── RAML 1.0 Import ────────────────────────────────────
  ipcMain.handle(
    'import:raml',
    async (
      _event,
      payload: {
        projectId: string
        content: string
        folderId?: string | null
      },
    ) => {
      try {
        const result = await importRaml(
          payload.projectId,
          payload.content,
          payload.folderId ?? null,
        )
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )
}

/**
 * Map OpenAPI / Swagger security requirements to the app's AuthConfig shape.
 * Picks the FIRST scheme listed (OpenAPI's `security[]` is an OR-list, so
 * any one works; user can switch later in the UI).
 */
function mapOpenApiSecurityToAuth(
  securityRef: Array<Record<string, string[]>> | undefined,
  schemes: Record<string, OpenApiSecurityScheme> | undefined,
): Record<string, unknown> {
  if (!securityRef || !schemes || securityRef.length === 0) {
    return { type: 'none' }
  }
  // securityRef[0] is the first OR-alternative — keys are scheme names.
  const firstAlt = securityRef[0]
  const schemeName = Object.keys(firstAlt)[0]
  if (!schemeName) return { type: 'none' }
  const scheme = schemes[schemeName]
  if (!scheme) return { type: 'none' }

  if (scheme.type === 'http') {
    if (scheme.scheme === 'bearer') {
      return { type: 'bearer', bearer: { token: '' } }
    }
    if (scheme.scheme === 'basic') {
      return { type: 'basic', basic: { username: '', password: '' } }
    }
  }
  if (scheme.type === 'apiKey') {
    return {
      type: 'apiKey',
      apiKey: {
        key: scheme.name ?? '',
        value: '',
        in: scheme.in === 'query' ? 'query' : 'header',
      },
    }
  }
  if (scheme.type === 'oauth2') {
    return { type: 'oauth2', oauth2: { token: '' } }
  }
  return { type: 'none' }
}

async function importOpenApi(
  projectId: string,
  content: string,
  parentFolderId: string | null = null,
  sourceUrl?: string,
): Promise<ImportResult> {
  const warnings: string[] = []
  let doc: OpenApiDoc

  try {
    // Try JSON first
    doc = JSON.parse(content) as OpenApiDoc
  } catch {
    // Try YAML
    try {
      const yaml = await import('js-yaml')
      doc = yaml.load(content) as OpenApiDoc
    } catch {
      return { success: false, error: 'Failed to parse file as JSON or YAML' }
    }
  }

  // Validate it's an OpenAPI or Swagger doc
  if (!doc.openapi && !doc.swagger) {
    return { success: false, error: 'Not a valid OpenAPI/Swagger document' }
  }

  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0
  const suggestedEnvVars: Record<string, string> = {}

  // Extract base URL
  let baseUrl = ''
  if (doc.servers && doc.servers.length > 0) {
    const serverUrl = doc.servers[0].url
    if (serverUrl.startsWith('http://') || serverUrl.startsWith('https://')) {
      baseUrl = serverUrl
    } else {
      // Relative server URL — resolve from source URL if available
      if (sourceUrl) {
        try {
          const parsed = new URL(sourceUrl)
          baseUrl = `${parsed.protocol}//${parsed.host}${serverUrl}`
        } catch {
          baseUrl = serverUrl
        }
      } else {
        baseUrl = serverUrl
      }
    }
  } else if (doc.host) {
    const scheme = doc.schemes ? doc.schemes[0] : 'https'
    baseUrl = `${scheme}://${doc.host}${doc.basePath || ''}`
  }

  if (baseUrl) {
    suggestedEnvVars['baseUrl'] = baseUrl
  }

  // Create folders from tags
  const tagFolderMap: Record<string, string> = {}
  if (doc.tags) {
    for (const tag of doc.tags) {
      const folderId = randomUUID()
      db.prepare(
        `
        INSERT INTO folders (id, project_id, parent_id, name, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(folderId, projectId, parentFolderId, tag.name, folderCount)
      tagFolderMap[tag.name] = folderId
      folderCount++
    }
  }

  // Import paths
  const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

  if (doc.paths) {
    for (const [path, pathItem] of Object.entries(doc.paths)) {
      for (const method of httpMethods) {
        const operation = pathItem[method]
        if (!operation) continue

        const endpointId = randomUUID()
        const name = operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`

        // Determine folder
        let folderId: string | null = parentFolderId
        if (operation.tags && operation.tags.length > 0) {
          const tagName = operation.tags[0]
          if (tagFolderMap[tagName]) {
            folderId = tagFolderMap[tagName]
          } else {
            // Create folder for this tag
            const newFolderId = randomUUID()
            db.prepare(
              `
              INSERT INTO folders (id, project_id, parent_id, name, sort_order)
              VALUES (?, ?, ?, ?, ?)
            `,
            ).run(newFolderId, projectId, parentFolderId, tagName, folderCount)
            tagFolderMap[tagName] = newFolderId
            folderId = newFolderId
            folderCount++
          }
        }

        // Build full URL
        const fullUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}${path}` : path

        // Convert OpenAPI parameters to app format
        const params: Array<{
          id: string
          key: string
          value: string
          description: string
          enabled: boolean
        }> = []
        const headers: Array<{
          id: string
          key: string
          value: string
          description: string
          enabled: boolean
        }> = []

        // Swagger 2.0: body parameters live inside `parameters[]` with
        // `in: 'body'` or `in: 'formData'`. We collect them here so they
        // can populate the body editor as a usable starter payload (a
        // JSON-schema dump or, for form-data, the form fields).
        let swagger2BodyParam:
          | { name: string; schema?: Record<string, unknown>; description?: string }
          | undefined
        const swagger2FormParams: Array<{ name: string; type?: string; description?: string }> = []

        if (operation.parameters) {
          for (const param of operation.parameters) {
            // Coerce numeric / boolean / null defaults to string. The
            // KeyValuePair `value` field is rendered through string-only
            // APIs (input value, .toLowerCase(), .includes(), .replace()),
            // so passing a raw `1` from `schema.default: 1` crashed the
            // request editor on tab open → white screen for the rest of
            // the session (v1.4.3 user-reported OpenAPI 3 import crash).
            const rawDefault = param.schema?.default
            const value =
              rawDefault === undefined || rawDefault === null
                ? ''
                : typeof rawDefault === 'string'
                  ? rawDefault
                  : typeof rawDefault === 'object'
                    ? JSON.stringify(rawDefault)
                    : String(rawDefault)
            const item = {
              id: randomUUID(),
              key: param.name,
              value,
              description: param.description || '',
              enabled: true,
            }
            if (param.in === 'query') params.push(item)
            else if (param.in === 'header') headers.push(item)
            else if (param.in === 'body') {
              swagger2BodyParam = {
                name: param.name,
                schema: param.schema as Record<string, unknown> | undefined,
                description: param.description,
              }
            } else if (param.in === 'formData') {
              swagger2FormParams.push({
                name: param.name,
                type: (param as { type?: string }).type,
                description: param.description,
              })
            }
            // path params are embedded in URL
          }
        }

        // Convert request body — prefer the operation's `example` /
        // first `examples.*.value` over a JSON-schema dump (which is far
        // less useful as a starter request body).
        let body: { type: string; content?: string; formData?: unknown[] } = { type: 'none' }
        if (operation.requestBody?.content) {
          const contentTypes = Object.keys(operation.requestBody.content)
          const pickExample = (mt: string): string | undefined => {
            const entry = operation.requestBody!.content![mt] as
              | {
                  example?: unknown
                  examples?: Record<string, { value?: unknown }>
                  schema?: Record<string, unknown>
                }
              | undefined
            if (!entry) return undefined
            if (entry.example !== undefined) {
              return typeof entry.example === 'string'
                ? entry.example
                : JSON.stringify(entry.example, null, 2)
            }
            if (entry.examples) {
              const first = Object.values(entry.examples)[0]
              if (first?.value !== undefined) {
                return typeof first.value === 'string'
                  ? first.value
                  : JSON.stringify(first.value, null, 2)
              }
            }
            return entry.schema
              ? JSON.stringify(
                  generateJsonExample(entry.schema, {
                    ...doc.definitions,
                    ...doc.components?.schemas,
                  }),
                  null,
                  2,
                )
              : undefined
          }
          if (contentTypes.some((ct) => ct.includes('json'))) {
            const content = pickExample('application/json') ?? '{}'
            body = { type: 'json', content }
          } else if (contentTypes.some((ct) => ct.includes('xml'))) {
            const xmlMt = contentTypes.find((ct) => ct.includes('xml'))!
            body = { type: 'xml', content: pickExample(xmlMt) ?? '' }
          } else if (contentTypes.some((ct) => ct.includes('form'))) {
            body = { type: 'form-data' }
          }
        } else if (swagger2BodyParam) {
          // Swagger 2.0 JSON body parameter — generate a JSON example from
          // its schema so the user sees a starter payload instead of an
          // empty editor (v1.4.2 #6).
          const example = swagger2BodyParam.schema
            ? generateJsonExample(swagger2BodyParam.schema, {
                ...doc.definitions,
                ...doc.components?.schemas,
              })
            : {}
          body = { type: 'json', content: JSON.stringify(example, null, 2) }
        } else if (swagger2FormParams.length > 0) {
          // Swagger 2.0 formData — populate the form-data list with each
          // form parameter so the body editor opens pre-filled.
          body = {
            type: 'form-data',
            formData: swagger2FormParams.map((p) => ({
              id: randomUUID(),
              key: p.name,
              value: '',
              description: p.description ?? '',
              type: 'text',
              enabled: true,
            })),
          }
        }

        // Resolve auth from operation-level OR doc-level `security[]`
        // pointing into components.securitySchemes / Swagger securityDefinitions.
        const securityRef = operation.security ?? doc.security
        const schemes = doc.components?.securitySchemes ?? doc.securityDefinitions
        const auth = mapOpenApiSecurityToAuth(securityRef, schemes)
        // Capture the scheme names that were actually referenced — exporter
        // uses these to round-trip the operation-level `security[]` block and
        // rebuild `components.securitySchemes` with the original names.
        const securitySchemeNames: string[] = []
        if (securityRef && securityRef.length > 0) {
          for (const alt of securityRef) {
            for (const name of Object.keys(alt)) {
              if (!securitySchemeNames.includes(name)) securitySchemeNames.push(name)
            }
          }
        }

        // Build round-trip metadata for the exporter. Stored under a dedicated
        // `openApi` namespace so other importers (Postman, Insomnia, …) don't
        // bump into it.
        const paramMeta: Record<string, { required?: boolean; type?: string }> = {}
        if (operation.parameters) {
          for (const p of operation.parameters) {
            paramMeta[`${p.in}:${p.name}`] = {
              required: p.required ?? false,
              type: p.schema?.type ?? 'string',
            }
          }
        }
        const requestBodyContent: Record<string, string> = {}
        const requestBodyExamples: Record<string, Record<string, unknown>> = {}
        if (operation.requestBody?.content) {
          for (const [mt, entry] of Object.entries(operation.requestBody.content)) {
            const e = entry as {
              example?: unknown
              examples?: Record<string, { value?: unknown }>
            }
            if (e.example !== undefined) {
              requestBodyContent[mt] =
                typeof e.example === 'string' ? e.example : JSON.stringify(e.example, null, 2)
            } else if (e.examples) {
              // Plural named `examples` — keep EVERY entry so the exporter can
              // round-trip them back to `examples`, and seed requestBodyContent
              // from the first so non-JSON (xml/html) bodies retain a payload (B-08).
              const named: Record<string, unknown> = {}
              for (const [exName, exVal] of Object.entries(e.examples)) {
                if (exVal?.value !== undefined) named[exName] = exVal.value
              }
              if (Object.keys(named).length > 0) {
                requestBodyExamples[mt] = named
                const firstVal = Object.values(named)[0]
                requestBodyContent[mt] =
                  typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal, null, 2)
              }
            }
          }
        }
        const openApiMeta: OpenApiRoundtripMeta = {
          tags: operation.tags && operation.tags.length > 0 ? [...operation.tags] : undefined,
          operationId: operation.operationId,
          securitySchemeNames: securitySchemeNames.length > 0 ? securitySchemeNames : undefined,
          parameters: Object.keys(paramMeta).length > 0 ? paramMeta : undefined,
          requestBodyContent:
            Object.keys(requestBodyContent).length > 0 ? requestBodyContent : undefined,
          requestBodyExamples:
            Object.keys(requestBodyExamples).length > 0 ? requestBodyExamples : undefined,
        }

        // Build request_schema in app's expected format
        const requestSchema = {
          method: method.toUpperCase(),
          url: fullUrl,
          params,
          headers,
          body,
          auth,
          openApi: openApiMeta,
        }

        // Build response schemas
        const responseSchemas = operation.responses ? JSON.stringify(operation.responses) : null

        db.prepare(
          `
          INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          endpointId,
          projectId,
          folderId,
          name,
          operation.description ?? null,
          'http',
          method.toUpperCase(),
          fullUrl,
          'developing',
          JSON.stringify(requestSchema),
          responseSchemas,
          endpointCount,
          now,
          now,
        )
        endpointCount++
      }
    }
  }

  if (endpointCount === 0) {
    warnings.push('No endpoints found in the document')
  }

  return {
    success: true,
    collectionId: projectId,
    endpointCount,
    folderCount,
    suggestedEnvVars,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

/** Slugify an endpoint name into a usable operationId fallback. */
function slugifyOperationId(name: string, method: string, path: string): string {
  const base = (name || `${method} ${path}`).trim()
  const slug = base.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return slug.length > 0 ? slug : `${method.toLowerCase()}_endpoint`
}

/**
 * Map an in-memory AuthConfig back to an OpenAPI `securitySchemes[]` entry.
 * Returns null when the auth type isn't expressible in OpenAPI 3.0.3.
 */
function authToOpenApiScheme(
  auth: { type?: string; apiKey?: { key?: string; in?: string } } | undefined,
): { name: string; scheme: OpenApiSecurityScheme } | null {
  if (!auth || !auth.type || auth.type === 'none') return null
  switch (auth.type) {
    case 'bearer':
      return { name: 'bearerAuth', scheme: { type: 'http', scheme: 'bearer' } }
    case 'basic':
      return { name: 'basicAuth', scheme: { type: 'http', scheme: 'basic' } }
    // Importer emits 'apiKey'; renderer also has 'api-key' — handle both.
    case 'apiKey':
    case 'api-key':
      return {
        name: 'apiKeyAuth',
        scheme: {
          type: 'apiKey',
          in: auth.apiKey?.in === 'query' ? 'query' : 'header',
          name: auth.apiKey?.key || 'X-API-Key',
        },
      }
    case 'oauth2':
      // Minimal placeholder — full flows would require client/token URLs we
      // don't necessarily have. Emit so consumers see auth was required.
      return { name: 'oauth2Auth', scheme: { type: 'oauth2' } }
    default:
      return null
  }
}

function exportProjectAsOpenApi(projectId: string): string {
  const db = getDb()

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | {
        name: string
        description: string | null
      }
    | undefined

  if (!project) {
    throw new Error('Project not found')
  }

  const endpoints = db
    .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as Array<{
    folder_id: string | null
    method: string | null
    path: string
    name: string
    description: string | null
    request_schema: string | null
    response_schemas: string | null
  }>

  // Build folder lookup so operations can carry a `tags: [folderName]` entry
  // that mirrors what the importer does in reverse.
  const folderRows = db
    .prepare('SELECT id, name FROM folders WHERE project_id = ?')
    .all(projectId) as Array<{ id: string; name: string }>
  const folderNameById = new Map<string, string>()
  for (const f of folderRows) folderNameById.set(f.id, f.name)

  // Pull a base server URL from the first endpoint's full URL (renderer stores
  // it in request_schema.url) so the exported spec is browseable.
  let baseServer: string | undefined
  for (const ep of endpoints) {
    if (!ep.request_schema) continue
    try {
      const schema = JSON.parse(ep.request_schema) as { url?: string }
      if (schema.url) {
        try {
          const u = new URL(schema.url.replace(/\{\{[^}]+\}\}/g, 'placeholder'))
          baseServer = `${u.protocol}//${u.host}`
          break
        } catch {
          // Templated url — skip, try next.
        }
      }
    } catch {
      // ignore
    }
  }

  const paths: Record<string, Record<string, unknown>> = {}
  // Accumulate distinct security schemes across all endpoints so we can emit a
  // single `components.securitySchemes` block at the end.
  const securitySchemes: Record<string, OpenApiSecurityScheme> = {}

  // Strip the server prefix off the stored URL so the path keys are valid
  // OpenAPI paths (e.g. /pets/{id}) rather than full URLs.
  function stripServer(rawPath: string): string {
    if (!rawPath) return '/'
    if (rawPath.startsWith('/')) return rawPath
    // Substitute *both* `{{envVar}}` and `{pathParam}` with placeholders so
    // `new URL()` doesn't choke on the braces and so the curly braces don't
    // get percent-encoded inside the resulting pathname.
    const ENV_PH = '__ENV_PLACEHOLDER__'
    const PATH_PH_OPEN = '__PATH_OPEN__'
    const PATH_PH_CLOSE = '__PATH_CLOSE__'
    const pathParams: string[] = []
    const safe = rawPath
      .replace(/\{\{[^}]+\}\}/g, ENV_PH)
      .replace(/\{([^}]+)\}/g, (_match, name: string) => {
        pathParams.push(name)
        return `${PATH_PH_OPEN}${name}${PATH_PH_CLOSE}`
      })
    try {
      const u = new URL(safe)
      const tail = `${u.pathname}${u.search}` || '/'
      // Decode our path-param placeholders back into `{name}` form.
      return tail
        .replace(new RegExp(PATH_PH_OPEN, 'g'), '{')
        .replace(new RegExp(PATH_PH_CLOSE, 'g'), '}')
    } catch {
      // Templated URL or path-only — return as-is so the caller can decide.
      return rawPath
    }
  }

  for (const ep of endpoints) {
    const path = stripServer(ep.path || '/')
    if (!paths[path]) {
      paths[path] = {}
    }
    const method = (ep.method || 'GET').toLowerCase()
    let parsedResponses: unknown = { '200': { description: 'OK' } }
    if (ep.response_schemas) {
      try {
        parsedResponses = JSON.parse(ep.response_schemas)
      } catch {
        // Corrupted row — fall back to a 200 stub so the rest of the export
        // succeeds. Exported spec is still valid OpenAPI.
      }
    }
    const operation: Record<string, unknown> = {
      summary: ep.name,
      description: ep.description || undefined,
      responses: parsedResponses,
    }

    // Tags from the round-trip metadata, falling back to the parent folder
    // name. This keeps imported docs round-trippable even after the user
    // moves an endpoint between folders.
    let openApiMeta: OpenApiRoundtripMeta | undefined
    let storedAuth: UiRequestSchema['auth'] | undefined
    if (ep.request_schema) {
      let schema: UiRequestSchema = {}
      try {
        schema = JSON.parse(ep.request_schema) as UiRequestSchema
      } catch {
        // Skip schema-derived fields for this endpoint; basic operation
        // (summary/responses) still emits.
      }
      openApiMeta = schema.openApi
      storedAuth = schema.auth
      const params: Array<Record<string, unknown>> = []
      const paramMeta = openApiMeta?.parameters ?? {}

      // Path templating from `{vars}` in URL — these are always required by
      // definition. Honour stored type info if present.
      const pathVarRe = /\{([^}]+)\}/g
      let m: RegExpExecArray | null
      while ((m = pathVarRe.exec(path)) !== null) {
        const meta = paramMeta[`path:${m[1]}`]
        params.push({
          name: m[1],
          in: 'path',
          required: true,
          schema: { type: meta?.type ?? 'string' },
        })
      }

      // Query params
      for (const p of schema.params ?? []) {
        if (p.enabled === false) continue
        const meta = paramMeta[`query:${p.key}`]
        params.push({
          name: p.key,
          in: 'query',
          description: p.description,
          required: meta?.required ?? false,
          schema: { type: meta?.type ?? 'string', default: p.value },
        })
      }

      // Headers
      for (const h of schema.headers ?? []) {
        if (h.enabled === false) continue
        // Skip headers OpenAPI doesn't want (Content-Type covered by requestBody)
        if (h.key.toLowerCase() === 'content-type') continue
        const meta = paramMeta[`header:${h.key}`]
        params.push({
          name: h.key,
          in: 'header',
          description: h.description,
          required: meta?.required ?? false,
          schema: { type: meta?.type ?? 'string', default: h.value },
        })
      }

      if (params.length > 0) operation.parameters = params

      // Body → requestBody.content
      const body = schema.body
      if (body && body.type && body.type !== 'none') {
        let mediaType = 'text/plain'
        const example = body.content
        let exampleObj: unknown = example
        switch (body.type) {
          case 'json':
            mediaType = 'application/json'
            try {
              exampleObj = example ? JSON.parse(example) : undefined
            } catch {
              exampleObj = example
            }
            break
          case 'xml':
            mediaType = 'application/xml'
            break
          case 'html':
            mediaType = 'text/html'
            break
          case 'javascript':
            mediaType = 'application/javascript'
            break
          case 'form-data':
            mediaType = 'multipart/form-data'
            break
          case 'urlencoded':
            mediaType = 'application/x-www-form-urlencoded'
            break
          case 'binary':
            mediaType = 'application/octet-stream'
            break
        }
        if (body.type === 'form-data' || body.type === 'urlencoded') {
          const properties: Record<string, unknown> = {}
          const items = body.type === 'form-data' ? (body.formData ?? []) : (body.urlEncoded ?? [])
          for (const kv of items) {
            properties[kv.key] = { type: 'string', example: kv.value }
          }
          operation.requestBody = {
            content: {
              [mediaType]: { schema: { type: 'object', properties } },
            },
          }
        } else if (body.type === 'xml' || body.type === 'html') {
          // For non-JSON text bodies, prefer the original content captured at
          // import time, then any current `body.content`, then a small
          // placeholder so consumers see *some* example payload.
          const original = openApiMeta?.requestBodyContent?.[mediaType]
          const content =
            original ?? (typeof example === 'string' && example.length > 0 ? example : '')
          operation.requestBody = {
            content: {
              [mediaType]: {
                schema: { type: 'string' },
                example:
                  content.length > 0
                    ? content
                    : body.type === 'xml'
                      ? '<!-- payload -->'
                      : '<!-- html payload -->',
              },
            },
          }
        } else if (exampleObj !== undefined) {
          // When the import captured multiple named `examples`, round-trip the
          // whole set — refreshing the first entry from the (possibly edited)
          // body content so user edits aren't lost — instead of collapsing to a
          // single `example` and dropping the rest (B-08).
          const namedExamples = openApiMeta?.requestBodyExamples?.[mediaType]
          if (namedExamples && Object.keys(namedExamples).length > 0) {
            const examples = Object.fromEntries(
              Object.entries(namedExamples).map(([name, value], i) => [
                name,
                { value: i === 0 ? exampleObj : value },
              ]),
            )
            operation.requestBody = { content: { [mediaType]: { examples } } }
          } else {
            operation.requestBody = { content: { [mediaType]: { example: exampleObj } } }
          }
        }
      }
    }

    // Tags — prefer round-trip metadata, fall back to folder name.
    const tagsToEmit =
      openApiMeta?.tags && openApiMeta.tags.length > 0
        ? openApiMeta.tags
        : ep.folder_id && folderNameById.has(ep.folder_id)
          ? [folderNameById.get(ep.folder_id)!]
          : undefined
    if (tagsToEmit) operation.tags = tagsToEmit

    // operationId — round-trip if available, else slug of name.
    operation.operationId =
      openApiMeta?.operationId ?? slugifyOperationId(ep.name, ep.method ?? 'GET', path)

    // Security — prefer the original scheme names from the imported doc; if
    // none are stored but the endpoint has a non-none auth, emit a synthesised
    // entry so the auth survives the round-trip.
    if (openApiMeta?.securitySchemeNames && openApiMeta.securitySchemeNames.length > 0) {
      const opSec: Array<Record<string, string[]>> = []
      const synth = authToOpenApiScheme(
        storedAuth as { type?: string; apiKey?: { key?: string; in?: string } } | undefined,
      )
      for (const name of openApiMeta.securitySchemeNames) {
        opSec.push({ [name]: [] })
        // Re-register the scheme using the live auth shape when available so
        // apiKey header names etc. round-trip. If `authToOpenApiScheme`
        // returns a different default name, prefer the original.
        if (synth && !securitySchemes[name]) {
          securitySchemes[name] = synth.scheme
        } else if (!securitySchemes[name]) {
          securitySchemes[name] = { type: 'http', scheme: 'bearer' }
        }
      }
      operation.security = opSec
    } else {
      const synth = authToOpenApiScheme(
        storedAuth as { type?: string; apiKey?: { key?: string; in?: string } } | undefined,
      )
      if (synth) {
        securitySchemes[synth.name] = synth.scheme
        operation.security = [{ [synth.name]: [] }]
      }
    }

    paths[path][method] = operation
  }

  const doc: Record<string, unknown> = {
    openapi: '3.0.3',
    info: {
      title: project.name,
      description: project.description || '',
      version: '1.0.0',
    },
    paths,
  }
  if (baseServer) doc.servers = [{ url: baseServer }]
  if (Object.keys(securitySchemes).length > 0) {
    doc.components = { securitySchemes }
  }

  return JSON.stringify(doc, null, 2)
}

// ─── Postman Types ──────────────────────────────────────────

interface PostmanCollection {
  info: {
    name: string
    description?: string
    schema: string
    _postman_id?: string
  }
  item: PostmanItem[]
  variable?: PostmanVariable[]
  auth?: PostmanAuth
}

interface PostmanItem {
  name: string
  request?: PostmanRequest
  response?: unknown[]
  item?: PostmanItem[] // folder (item group)
  description?: string
  event?: PostmanEvent[]
  /** Folder-level auth — inherited by descendant requests that don't set
   *  their own (Postman item-groups can carry an `auth` block). */
  auth?: PostmanAuth
  /** Apinizer test-interop extension. Postman v2.1 preserves unknown custom
   *  keys, so Apinizer's extra fidelity (structured assertions, raw-body
   *  sub-type, timeout) rides here and round-trips through Testnizer. */
  'x-apinizer'?: XApinizerExtension
}

interface PostmanEvent {
  listen: 'prerequest' | 'test' | string
  script?: { exec?: string | string[]; type?: string; src?: string }
}

interface PostmanRequest {
  method?: string
  header?: PostmanHeader[]
  url?: PostmanUrl | string
  body?: PostmanBody
  auth?: PostmanAuth
  description?: string
}

interface PostmanHeader {
  key: string
  value: string
  description?: string
  disabled?: boolean
}

interface PostmanUrl {
  raw?: string
  protocol?: string
  host?: string[] | string
  port?: string
  path?: Array<string | { value: string }> | string
  query?: PostmanQuery[]
  variable?: Array<{ key: string; value: string }>
}

interface PostmanQuery {
  key: string
  value: string
  description?: string
  disabled?: boolean
}

interface PostmanBody {
  mode?: string
  raw?: string
  formdata?: PostmanFormData[]
  urlencoded?: PostmanUrlEncoded[]
  file?: { src?: string; content?: string }
  graphql?: { query?: string; variables?: string }
  options?: {
    raw?: { language?: string }
  }
}

interface PostmanFormData {
  key: string
  value?: string
  src?: string | string[]
  description?: string
  disabled?: boolean
  type?: string
}

interface PostmanUrlEncoded {
  key: string
  value: string
  description?: string
  disabled?: boolean
}

// Postman 2.1 stores auth fields as either an array of { key, value } pairs
// (legacy) or as a flat object (modern). Both are accepted on import.
interface PostmanAuth {
  type: string
  basic?:
    | Array<{ key: string; value: string; type?: string }>
    | { username?: string; password?: string }
  bearer?: Array<{ key: string; value: string; type?: string }> | { token?: string }
  apikey?:
    | Array<{ key: string; value: string; type?: string }>
    | { key?: string; value?: string; in?: string }
  digest?: Array<{ key: string; value: string }> | { username?: string; password?: string }
  oauth2?: Array<{ key: string; value: string }> | Record<string, unknown>
  ntlm?:
    | Array<{ key: string; value: string }>
    | { username?: string; password?: string; domain?: string; workstation?: string }
}

interface PostmanVariable {
  key: string
  value: string
  type?: string
}

/**
 * Standalone Postman environment export — a separate file type from collection
 * exports (Postman → Environments → Export). Detected by `_postman_variable_scope`.
 * The `values[]` array uses the same shape as `collection.variable[]` but adds
 * an optional `enabled` flag per entry.
 */
interface PostmanEnvironment {
  id?: string
  name: string
  values?: Array<{
    key: string
    value: string
    type?: string
    /** Postman omits this field on enabled rows; `false` means the variable is muted. */
    enabled?: boolean
  }>
  _postman_variable_scope?: string
  _postman_exported_at?: string
  _postman_exported_using?: string
}

// ─── Postman Import ─────────────────────────────────────────

// ─── Postman / Insomnia script helpers ─────────────────────

/**
 * Insomnia after-response / pre-request scripts are stored VERBATIM — no
 * `insomnia.*`→`pm.*` rewrite.
 *
 * Since v1.4.19 the shared script runtime (`src/shared/script`) provides a
 * native `insomnia` binding (`aliases.ts` → `buildInsomnia`) with the correct
 * Insomnia semantics, notably **numeric `insomnia.response.status`** (Postman's
 * `pm.response.status` is the reason-phrase text) and `insomnia.baseEnvironment`
 * → collection variables. The old blanket rewrite silently flipped
 * `insomnia.response.status` to the reason phrase, so a user guard like
 * `if (status < 200 || status >= 300) throw` fired before the body was read
 * whenever the server sent an empty reason phrase — every body assertion failed
 * while `Status code is 200` still passed (issue #47). It also mangled
 * `insomnia.baseEnvironment` into the non-existent `pm.baseEnvironment`.
 *
 * Keeping the script untouched means Send and Run execute the identical text
 * through the same shared `insomnia` binding — one source, no parity drift.
 */
export function normalizeInsomniaScript(script: string): string {
  return script ?? ''
}

/** Pull pre/post scripts from a Postman item.event[] array. */
export function extractPostmanEventScripts(events: PostmanEvent[] | undefined): {
  preScript?: string
  postScript?: string
} {
  if (!events) return {}
  const out: { preScript?: string; postScript?: string } = {}
  for (const ev of events) {
    const exec = ev.script?.exec
    if (!exec) continue
    const text = Array.isArray(exec) ? exec.join('\n') : exec
    if (ev.listen === 'prerequest') out.preScript = text
    else if (ev.listen === 'test') out.postScript = text
  }
  return out
}

// ─── Postman helpers ────────────────────────────────────────

/** Postman 2.x auth field accessor — handles both array-of-{key,value}
 * and flat-object representations. */
function readAuthField(src: PostmanAuth[keyof PostmanAuth] | undefined, key: string): string {
  if (!src) return ''
  if (Array.isArray(src)) {
    return (src.find((p) => p.key === key)?.value as string) ?? ''
  }
  if (typeof src === 'object') {
    const v = (src as Record<string, unknown>)[key]
    return typeof v === 'string' ? v : ''
  }
  return ''
}

function genKvId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ─── x-apinizer extension (Apinizer ↔ Testnizer test interop, contract v1.0) ──
//
// Postman v2.1 preserves unknown custom keys, so Apinizer ships its extra test
// fidelity under an `x-apinizer` key on each item — and reads it back on the
// return trip. We READ it on import (additive; a collection without the key
// still imports as plain Postman) and WRITE it on export so the round-trip
// through Testnizer is lossless for the four assertion kinds Apinizer can carry
// (STATUS_CODE / BODY / JSONPATH / XPATH). Testnizer-only assertion types stay
// in Testnizer's own `assertions` JSON and are simply omitted from the
// extension (contract §4.1). See md_files/testnizer-interop/00-shared-contract.md.

type XApinizerKind = 'STATUS_CODE' | 'BODY' | 'JSONPATH' | 'XPATH'

interface XApinizerAssertion {
  kind: XApinizerKind
  expected?: string | number
  /** JSONPath / XPath expression — only present for *PATH kinds. */
  path?: string
}

interface XApinizerExtension {
  schemaVersion?: string
  source?: string
  /** Raw-body sub-type Postman can't carry natively: JSON / XML / TEXT / HTML. */
  bodyRowType?: string
  timeoutSeconds?: number
  testType?: string
  apiType?: string
  assertions?: XApinizerAssertion[]
}

/** Minimal Testnizer assertion shape produced/consumed here — mirrors
 *  TestAssertion in renderer types. Kept local to avoid importing renderer
 *  code into the main process (same pattern as runner.handler.ts). */
interface TestAssertionLike {
  id: string
  name: string
  type: string
  enabled: boolean
  expected?: string | number
  jsonPath?: string
  xPath?: string
}

/** Major version of the x-apinizer schema this build understands. A collection
 *  tagged with a newer MAJOR falls back to plain Postman (graceful). */
const X_APINIZER_SCHEMA_MAJOR = 1

/** True when we understand this item's x-apinizer payload. An omitted version is
 *  treated as current; a mismatched MAJOR means ignore-and-fall-back. */
function xApinizerVersionOk(ext: XApinizerExtension | undefined): boolean {
  if (!ext) return false
  const v = ext.schemaVersion
  if (!v) return true
  const major = parseInt(String(v).split('.')[0] ?? '', 10)
  return Number.isFinite(major) && major === X_APINIZER_SCHEMA_MAJOR
}

/** x-apinizer body row-type (JSON/XML/TEXT/HTML) → Testnizer raw sub-type.
 *  Postman keeps the language in `options.raw.language`, but Apinizer's RAW
 *  export often omits it, collapsing every raw body to plain text — this
 *  recovers the json/xml/html distinction. */
function apinizerRowTypeToBodyType(rowType: string | undefined): string | undefined {
  switch ((rowType ?? '').toUpperCase()) {
    case 'JSON':
      return 'json'
    case 'XML':
      return 'xml'
    case 'HTML':
      return 'html'
    case 'TEXT':
      return 'text'
    default:
      return undefined
  }
}

/** Only refine the raw text family — never re-type form-data / urlencoded /
 *  binary / none, which have no row-type. */
function isRawFamilyBodyType(t: string | undefined): boolean {
  return t === 'text' || t === 'json' || t === 'xml' || t === 'html' || t === 'raw'
}

function looksLikeJson(s: string): boolean {
  const t = s.trim()
  if (!t || !/^[[{]/.test(t)) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

function truncateLabel(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

/** x-apinizer.assertions[] → Testnizer TestAssertion[]. Unknown kinds are
 *  skipped with a warning (no silent drop). This is the *primary* assertion
 *  source when present — more reliable than parsing the Postman test script. */
function xApinizerAssertionsToUi(
  assertions: XApinizerAssertion[] | undefined,
  warnings: string[],
): TestAssertionLike[] {
  if (!Array.isArray(assertions)) return []
  const out: TestAssertionLike[] = []
  for (const a of assertions) {
    const expected = a.expected
    switch (a.kind) {
      case 'STATUS_CODE':
        out.push({
          id: genKvId(),
          name: `Status code is ${expected ?? ''}`.trim(),
          type: 'status_equals',
          enabled: true,
          expected,
        })
        break
      case 'BODY': {
        // Apinizer's BODY assertion is a full-body match. Prefer a JSON deep
        // equal when the expected value parses as JSON; otherwise fall back to
        // a substring `contains` (best-effort, per contract §4).
        const raw = typeof expected === 'string' ? expected : JSON.stringify(expected ?? '')
        const isJson = looksLikeJson(raw)
        out.push({
          id: genKvId(),
          name: isJson ? 'Body equals JSON' : `Body contains "${truncateLabel(raw, 32)}"`,
          type: isJson ? 'body_equals_json' : 'body_contains',
          enabled: true,
          expected: raw,
        })
        break
      }
      case 'JSONPATH':
        out.push({
          id: genKvId(),
          name: `JSONPath ${a.path ?? '$'} equals ${expected ?? ''}`.trim(),
          type: 'body_jsonpath',
          enabled: true,
          jsonPath: a.path ?? '$',
          expected,
        })
        break
      case 'XPATH':
        out.push({
          id: genKvId(),
          name: `XPath ${a.path ?? ''} equals ${expected ?? ''}`.trim(),
          type: 'body_xpath',
          enabled: true,
          xPath: a.path ?? '',
          expected,
        })
        break
      default:
        warnings.push(
          `Skipped unknown x-apinizer assertion kind "${String((a as XApinizerAssertion).kind)}"`,
        )
    }
  }
  return out
}

/** Testnizer body sub-type → x-apinizer bodyRowType. Only the raw family maps. */
function bodyTypeToApinizerRowType(bodyType: string | undefined): string | undefined {
  switch ((bodyType ?? '').toLowerCase()) {
    case 'json':
      return 'JSON'
    case 'xml':
      return 'XML'
    case 'html':
      return 'HTML'
    case 'text':
    case 'raw':
      return 'TEXT'
    default:
      return undefined
  }
}

/** Testnizer TestAssertion[] → x-apinizer.assertions[], keeping only the four
 *  kinds Apinizer's boolean-flag model can carry. Unmappable types
 *  (status_in_range, header_*, response_time/size_under, pm_script) are dropped
 *  from the extension — they stay in Testnizer's own `assertions` JSON for a
 *  Testnizer→Testnizer round-trip (contract §4.1). */
function assertionsToXApinizer(assertions: TestAssertionLike[]): XApinizerAssertion[] {
  const out: XApinizerAssertion[] = []
  for (const a of assertions) {
    switch (a.type) {
      case 'status_equals':
        out.push({ kind: 'STATUS_CODE', expected: a.expected })
        break
      case 'body_equals_json':
      case 'body_contains':
        out.push({ kind: 'BODY', expected: a.expected })
        break
      case 'body_jsonpath':
        out.push({ kind: 'JSONPATH', path: a.jsonPath ?? '$', expected: a.expected })
        break
      case 'body_xpath':
        out.push({ kind: 'XPATH', path: a.xPath ?? '', expected: a.expected })
        break
      default:
        // Unmappable — intentionally skipped (kept in Testnizer's own channel).
        break
    }
  }
  return out
}

/**
 * Derive Apinizer's `apiType` (EnumApiType) + `testType`
 * (EnumApiTestConsoleTestType) from the Testnizer protocol.
 *
 * We DERIVE rather than preserve an original value because a test imported into
 * Testnizer loses its Apinizer proxy binding (contract §0/§5.6 — apiProxyID etc.
 * are null), so it is a standalone test regardless of where it came from — the
 * original `PROXY` testType would be wrong to carry back. Deriving gives both
 * natively-authored and round-tripped tests a correct, proxy-free value:
 *   - apiType picks the closest EnumApiType (REST/SOAP/GRPC/WEBSOCKET/AI).
 *   - testType picks a standalone test-console kind: RESOURCE for the REST
 *     family (isRest), WSDL for SOAP (isSoap), API (neutral) for the rest.
 */
function protocolToApinizerTypes(protocol: string | undefined): {
  apiType: string
  testType: string
} {
  switch ((protocol ?? 'http').toLowerCase()) {
    case 'soap':
      return { apiType: 'SOAP', testType: 'WSDL' }
    case 'grpc':
      return { apiType: 'GRPC', testType: 'API' }
    case 'websocket':
    case 'socketio':
      return { apiType: 'WEBSOCKET', testType: 'API' }
    case 'ai':
      return { apiType: 'AI', testType: 'API' }
    default:
      // http / graphql / sse / mcp — all HTTP/REST-family.
      return { apiType: 'REST', testType: 'RESOURCE' }
  }
}

/** Reconstruct a full URL from a Postman url object or string. Preserves
 * `{{variables}}` and template placeholders as-is — never URL-decodes them. */
export function reconstructPostmanUrl(url: PostmanUrl | string | undefined): string {
  if (!url) return ''
  if (typeof url === 'string') return url
  if (url.raw) return url.raw

  const protocol = url.protocol ?? 'https'
  const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '')
  const port = url.port ? `:${url.port}` : ''
  const pathParts = Array.isArray(url.path)
    ? url.path.map((p) => (typeof p === 'string' ? p : (p.value ?? '')))
    : url.path
      ? [String(url.path)]
      : []
  const path = pathParts.length > 0 ? '/' + pathParts.join('/') : ''
  return `${protocol}://${host}${port}${path}`
}

/** Best-effort path extraction for the endpoints.path column. Falls back to
 * the raw URL if the URL contains template variables that break URL parsing. */
function extractPath(url: string): string {
  if (!url) return '/'
  // If the URL contains {{vars}} we can't reliably parse it — use a safe
  // substitution then strip back the placeholder.
  const PLACEHOLDER = '__VAR__'
  const safe = url.replace(/\{\{[^}]+\}\}/g, PLACEHOLDER)
  try {
    const parsed = new URL(safe)
    let pathname = parsed.pathname || '/'
    pathname = pathname.replace(new RegExp(PLACEHOLDER, 'g'), '*')
    return pathname
  } catch {
    // Relative URL or `{{baseUrl}}/path` form — strip protocol/host best-effort.
    const m = url.match(/(?:https?:\/\/[^/]+)?(\/.*)$/)
    return m?.[1] ?? url
  }
}

/** Map Postman body modes onto the renderer's RequestBody shape. */
export function mapPostmanBodyToUi(body: PostmanBody | undefined): {
  type: string
  content?: string
  formData?: Array<{
    id: string
    key: string
    value: string
    enabled: boolean
    type?: 'text' | 'file'
    filePath?: string
  }>
  urlEncoded?: Array<{ id: string; key: string; value: string; enabled: boolean }>
} {
  if (!body || !body.mode) return { type: 'none' }

  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language ?? 'text'
      const map: Record<string, string> = {
        json: 'json',
        xml: 'xml',
        html: 'html',
        javascript: 'javascript',
        text: 'text',
        graphql: 'json',
      }
      return { type: map[lang] ?? 'text', content: body.raw ?? '' }
    }
    case 'graphql': {
      const payload = body.graphql
        ? JSON.stringify(
            {
              query: body.graphql.query ?? '',
              variables: tryParseJson(body.graphql.variables) ?? {},
            },
            null,
            2,
          )
        : ''
      return { type: 'json', content: payload }
    }
    case 'formdata': {
      const formData = (body.formdata ?? []).map((fd) => {
        const isFile = (fd.type ?? '').toLowerCase() === 'file'
        const filePath = Array.isArray(fd.src) ? fd.src[0] : fd.src
        if (isFile) {
          // For file fields the human-readable filename goes in `value`
          // and the path the main process opens lives in `filePath`.
          const fileName = filePath ? (filePath.split(/[\\/]/).pop() ?? filePath) : ''
          return {
            id: genKvId(),
            key: fd.key ?? '',
            value: fileName,
            enabled: !fd.disabled,
            type: 'file' as const,
            filePath: filePath ?? undefined,
          }
        }
        return {
          id: genKvId(),
          key: fd.key ?? '',
          value: fd.value ?? (Array.isArray(fd.src) ? fd.src.join(',') : (fd.src ?? '')),
          enabled: !fd.disabled,
          type: 'text' as const,
        }
      })
      return { type: 'form-data', formData }
    }
    case 'urlencoded': {
      const urlEncoded = (body.urlencoded ?? []).map((ue) => ({
        id: genKvId(),
        key: ue.key ?? '',
        value: ue.value ?? '',
        enabled: !ue.disabled,
      }))
      return { type: 'urlencoded', urlEncoded }
    }
    case 'file':
      // Binary upload — content path can't survive an export, so we record the
      // hint. The user re-attaches the file in the UI.
      return { type: 'binary', content: body.file?.src ?? '' }
    default:
      return { type: 'none' }
  }
}

function tryParseJson(s: string | undefined): unknown {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** Map Postman auth onto the renderer's AuthConfig shape. */
export function mapPostmanAuthToUi(auth: PostmanAuth | undefined): Record<string, unknown> | null {
  if (!auth || !auth.type) return null

  const t = auth.type.toLowerCase()
  switch (t) {
    case 'noauth':
      return { type: 'none' }
    case 'basic':
      return {
        type: 'basic',
        basic: {
          username: readAuthField(auth.basic, 'username'),
          password: readAuthField(auth.basic, 'password'),
        },
      }
    case 'bearer':
      return {
        type: 'bearer',
        bearer: { token: readAuthField(auth.bearer, 'token'), prefix: 'Bearer' },
      }
    case 'apikey': {
      const inLocation = readAuthField(auth.apikey, 'in') || 'header'
      return {
        type: 'api-key',
        apiKey: {
          key: readAuthField(auth.apikey, 'key'),
          value: readAuthField(auth.apikey, 'value'),
          in: inLocation === 'query' ? 'query' : 'header',
        },
      }
    }
    case 'digest':
      return {
        type: 'digest',
        digest: {
          username: readAuthField(auth.digest, 'username'),
          password: readAuthField(auth.digest, 'password'),
        },
      }
    case 'ntlm':
      return {
        type: 'ntlm',
        ntlm: {
          username: readAuthField(auth.ntlm, 'username'),
          password: readAuthField(auth.ntlm, 'password'),
          domain: readAuthField(auth.ntlm, 'domain'),
          workstation: readAuthField(auth.ntlm, 'workstation'),
        },
      }
    case 'oauth2':
      // Best-effort — Postman has many flows; we capture token only.
      return {
        type: 'oauth2',
        oauth2: {
          grantType: 'client_credentials',
          tokenUrl: readAuthField(auth.oauth2, 'accessTokenUrl'),
          authUrl: readAuthField(auth.oauth2, 'authUrl'),
          clientId: readAuthField(auth.oauth2, 'clientId'),
          clientSecret: readAuthField(auth.oauth2, 'clientSecret'),
          scope: readAuthField(auth.oauth2, 'scope'),
          token: readAuthField(auth.oauth2, 'accessToken'),
        },
      }
    default:
      return { type: 'none' }
  }
}

// ─── Postman Import ─────────────────────────────────────────

export async function importPostman(
  projectId: string,
  content: string,
  rootFolderId: string | null = null,
): Promise<ImportResult> {
  const warnings: string[] = []
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch (e) {
    return {
      success: false,
      error: 'Failed to parse Postman collection JSON: ' + (e as Error).message,
    }
  }

  const root = parsed as Record<string, unknown>

  // Postman v1 legacy collections — `name` + `requests[]` instead of
  // `info` + `item[]`. Surface a v1-specific message so the user knows
  // to re-export as v2.1 rather than getting the generic "wrong file
  // type" error below.
  const hasV1Markers =
    typeof root['name'] === 'string' &&
    Array.isArray(root['requests']) &&
    !Array.isArray(root['item'])
  if (hasV1Markers) {
    return {
      success: false,
      error:
        'Postman v1 collections are not supported. Re-export the collection from Postman as v2.1 ' +
        '(Collections → ⋯ → Export → Collection v2.1) and import the resulting file.',
    }
  }

  // Reject anything that's not actually a Postman v2.x collection. The
  // APIs Import flow is collection-only — env / test-suite / mock
  // exports belong in their own importers. Keep the message generic so
  // we don't have to enumerate every wrong-file shape (env, test suite,
  // mock, …) — the importer's job is to verify the file it WAS asked
  // to load matches the format it was asked to load.
  const looksLikeCollection =
    root &&
    typeof root === 'object' &&
    typeof (root['info'] as Record<string, unknown> | undefined)?.['name'] === 'string' &&
    Array.isArray(root['item'])
  if (!looksLikeCollection) {
    return {
      success: false,
      error: "This file is not a Postman collection. You can't upload this file type from here.",
    }
  }

  const collection = parsed as PostmanCollection

  // Accept v2.0 and v2.1 schemas (both live under getpostman.com).
  const schema = collection.info.schema ?? ''
  if (schema && !/postman|getpostman/i.test(schema)) {
    warnings.push(`Unknown collection schema "${schema}" — importing best-effort.`)
  }

  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0
  const endpointIds: string[] = []
  const suggestedEnvVars: Record<string, string> = {}

  if (collection.variable) {
    for (const v of collection.variable) {
      if (v.key) suggestedEnvVars[v.key] = v.value ?? ''
    }
  }

  // Persist collection-level variables to a project-scoped environment so that
  // the export round-trip is lossless. Postman's `collection.variable[]` has no
  // first-class equivalent in our schema — the closest analogue is a per-project
  // environment. We create (or reuse) one named after the collection, stamp it
  // active, and write each variable as a row. On export we read from the active
  // environment for this project.
  if (collection.variable && collection.variable.length > 0) {
    const projectRow = db
      .prepare('SELECT workspace_id FROM projects WHERE id = ?')
      .get(projectId) as { workspace_id: string } | undefined
    if (projectRow) {
      const envName = `${collection.info.name} (imported)`
      // Reuse existing env with the same name if we've already imported this
      // collection — avoids exploding env count on re-imports.
      const envRow = db
        .prepare('SELECT id FROM environments WHERE project_id = ? AND name = ?')
        .get(projectId, envName) as { id: string } | undefined
      let envId: string
      if (envRow) {
        envId = envRow.id
        db.prepare('DELETE FROM environment_variables WHERE environment_id = ?').run(envId)
      } else {
        envId = randomUUID()
        // If the project has no active env yet, mark this one active.
        const hasActive = db
          .prepare('SELECT 1 AS x FROM environments WHERE project_id = ? AND is_active = 1')
          .get(projectId) as { x: number } | undefined
        db.prepare(
          `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(envId, projectRow.workspace_id, projectId, envName, hasActive ? 0 : 1, now, now)
      }
      const insertVar = db.prepare(
        `INSERT INTO environment_variables (id, environment_id, key, value, description, enabled, secret, initial_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const v of collection.variable) {
        if (!v.key) continue
        insertVar.run(randomUUID(), envId, v.key, v.value ?? '', null, 1, 0, v.value ?? null)
      }
    }
  }

  function processItems(
    items: PostmanItem[],
    parentFolderId: string | null,
    inheritedAuth: PostmanAuth | undefined,
  ): void {
    for (const item of items) {
      const isFolder = Array.isArray(item.item) && !item.request
      if (isFolder) {
        const folderId = randomUUID()
        // Folder-level cascade metadata — mirror the Insomnia v5 importer so a
        // Postman "Setup folder → token pre-request script → Bearer inherit"
        // pattern survives import. Without persisting these, the folder's
        // scripts/auth were dropped, the suite snapshot copied NULLs into
        // test_suite_folders, and the run lost the token step → 401 (the exact
        // parity gap Insomnia already closed).
        const folderScripts = extractPostmanEventScripts(item.event)
        const folderAuthUi = mapPostmanAuthToUi(item.auth)
        db.prepare(
          `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth, pre_script, post_script)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          folderId,
          projectId,
          parentFolderId,
          item.name || 'Folder',
          folderCount,
          folderAuthUi ? JSON.stringify(folderAuthUi) : null,
          folderScripts.preScript ?? null,
          folderScripts.postScript ?? null,
        )
        folderCount++
        // A folder's own auth also overrides the inherited one for its whole
        // subtree on the API-tree send path (which bakes auth onto each child
        // request); absent a block, inheritance flows straight through.
        const childAuth = item.auth ?? inheritedAuth
        processItems(item.item ?? [], folderId, childAuth)
        continue
      }

      if (!item.request) {
        warnings.push(`Skipped item "${item.name ?? '(unnamed)'}" — no request body`)
        continue
      }

      const req = item.request
      const method = (req.method ?? 'GET').toUpperCase()
      const url = reconstructPostmanUrl(req.url)
      const path = extractPath(url)

      // Skip Postman placeholder items that have neither a URL nor a name —
      // those show up after some Postman collection-builder operations and
      // surfaced as the stray "GET New Request" in v1.3.1 B16. We're
      // conservative: require BOTH the URL to be empty AND the name to look
      // like an unedited placeholder, so we don't accidentally drop a real
      // user-authored request that simply lacks a URL.
      const looksLikePlaceholder =
        !url.trim() && (!item.name || /^new request$/i.test(item.name.trim()))
      if (looksLikePlaceholder) {
        warnings.push(`Skipped empty placeholder item "${item.name ?? '(unnamed)'}"`)
        continue
      }

      // Headers — UI KeyValuePair[]
      const headers = (req.header ?? []).map((h) => ({
        id: genKvId(),
        key: h.key ?? '',
        value: h.value ?? '',
        description: h.description,
        enabled: !h.disabled,
      }))

      // Query params — UI KeyValuePair[]
      const params =
        typeof req.url === 'object' && Array.isArray(req.url?.query)
          ? req.url!.query!.map((q) => ({
              id: genKvId(),
              key: q.key ?? '',
              value: q.value ?? '',
              description: q.description,
              enabled: !q.disabled,
            }))
          : []

      const body = mapPostmanBodyToUi(req.body)
      // A request with no auth inherits the nearest ancestor's (folder →
      // collection root); an explicit block on the request (incl. `noauth`)
      // overrides. Previously only the collection root was inherited, so an
      // auth set on a folder never reached its child requests.
      const auth = mapPostmanAuthToUi(req.auth ?? inheritedAuth)

      // Pull pre-request + test scripts from item.event[]
      const { preScript, postScript } = extractPostmanEventScripts(item.event)

      const requestSchema: Record<string, unknown> = {
        url,
        method,
        params,
        headers,
        body,
      }
      if (auth) requestSchema.auth = auth
      if (preScript) requestSchema.preScript = preScript
      if (postScript) requestSchema.postScript = postScript

      // ── Apinizer interop: fold x-apinizer fidelity back in (additive) ──
      // Structured assertions from the extension are the primary source (more
      // reliable than re-parsing the Postman test script); the raw-body
      // sub-type and timeout that Postman can't carry are recovered too. Absent
      // or unknown-version extensions leave the plain-Postman import untouched.
      const xa = item['x-apinizer']
      if (xa && xApinizerVersionOk(xa)) {
        const xaAssertions = xApinizerAssertionsToUi(xa.assertions, warnings)
        if (xaAssertions.length > 0) requestSchema.assertions = xaAssertions
        const refinedBodyType = apinizerRowTypeToBodyType(xa.bodyRowType)
        if (refinedBodyType && isRawFamilyBodyType(body.type)) {
          // `body` is the same object stored under requestSchema.body, so
          // mutating it here updates the persisted schema.
          body.type = refinedBodyType
        }
        if (typeof xa.timeoutSeconds === 'number') {
          requestSchema.timeoutSeconds = xa.timeoutSeconds
        }
      } else if (xa) {
        warnings.push(
          `Ignored x-apinizer extension with unsupported schemaVersion "${
            xa.schemaVersion ?? '(none)'
          }" on "${item.name ?? '(unnamed)'}" — imported as plain Postman.`,
        )
      }

      const endpointId = randomUUID()
      db.prepare(
        `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        endpointId,
        projectId,
        parentFolderId,
        item.name || `${method} ${path}`,
        req.description ?? null,
        'http',
        method,
        path || '/',
        'developing',
        JSON.stringify(requestSchema),
        null,
        endpointCount,
        now,
        now,
      )
      endpointIds.push(endpointId)
      endpointCount++
    }
  }

  processItems(collection.item, rootFolderId, collection.auth)

  if (endpointCount === 0 && folderCount === 0) {
    warnings.push('No requests or folders found in the Postman collection')
  }

  return {
    success: true,
    collectionId: projectId,
    endpointCount,
    folderCount,
    endpointIds,
    suggestedEnvVars: Object.keys(suggestedEnvVars).length > 0 ? suggestedEnvVars : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

// ─── Postman Environment Import ─────────────────────────────

/**
 * Import a standalone Postman environment export file. Creates (or replaces)
 * a project-scoped environment whose name matches the export's `name` field.
 * Re-importing the same environment is idempotent — existing variables are
 * dropped and re-inserted so renames in Postman don't accumulate dead rows.
 *
 * Returns an ImportResult with `endpointCount: 0` (no endpoints) — callers
 * detect environment imports by the `environmentId` field, which only the
 * env importer populates.
 */
export async function importPostmanEnvironment(
  projectId: string,
  env: PostmanEnvironment,
): Promise<ImportResult & { environmentId?: string; environmentName?: string }> {
  const warnings: string[] = []

  if (!env.name || typeof env.name !== 'string') {
    return {
      success: false,
      error: 'Postman environment file is missing `name`',
    }
  }

  const values = Array.isArray(env.values) ? env.values : []
  const db = getDb()
  const now = Date.now()

  const projectRow = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as
    | { workspace_id: string }
    | undefined
  if (!projectRow) {
    return { success: false, error: 'Project not found: ' + projectId }
  }

  // Reuse the env when a row with the same name already exists in this project —
  // Postman's UI never shows duplicate env names so users expect a re-import to
  // overwrite. Variables are wiped before reinsert (no merge).
  const existing = db
    .prepare('SELECT id FROM environments WHERE project_id = ? AND name = ?')
    .get(projectId, env.name) as { id: string } | undefined
  let envId: string
  if (existing) {
    envId = existing.id
    db.prepare('DELETE FROM environment_variables WHERE environment_id = ?').run(envId)
  } else {
    envId = randomUUID()
    // First env on the project becomes active automatically — matches the
    // collection variable importer's behaviour and avoids a "select env"
    // chore right after import.
    const hasActive = db
      .prepare('SELECT 1 AS x FROM environments WHERE project_id = ? AND is_active = 1')
      .get(projectId) as { x: number } | undefined
    db.prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(envId, projectRow.workspace_id, projectId, env.name, hasActive ? 0 : 1, now, now)
  }

  const insertVar = db.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, description, enabled, secret, initial_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  let varCount = 0
  for (const v of values) {
    if (!v || typeof v.key !== 'string' || !v.key) continue
    // Postman flags secret variables with type "secret"; mirror that so the
    // env modal masks them. Default enabled=true matches Postman's omitted-flag
    // convention.
    const isSecret = v.type === 'secret' ? 1 : 0
    const isEnabled = v.enabled === false ? 0 : 1
    insertVar.run(
      randomUUID(),
      envId,
      v.key,
      v.value ?? '',
      null,
      isEnabled,
      isSecret,
      v.value ?? null,
    )
    varCount++
  }

  if (varCount === 0) {
    warnings.push('Postman environment had no variables — created an empty environment.')
  }

  return {
    success: true,
    environmentId: envId,
    environmentName: env.name,
    endpointCount: 0,
    folderCount: 0,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

// ─── Postman Export ─────────────────────────────────────────

// ─── Postman Export ─────────────────────────────────────────

interface UiKeyValuePair {
  id?: string
  key: string
  value: string
  description?: string
  enabled?: boolean
  type?: 'text' | 'file'
  filePath?: string
}

interface UiRequestSchema {
  url?: string
  method?: string
  params?: UiKeyValuePair[]
  headers?: UiKeyValuePair[]
  body?: {
    type?: string
    content?: string
    formData?: UiKeyValuePair[]
    urlEncoded?: UiKeyValuePair[]
  }
  auth?: Record<string, unknown>
  preScript?: string
  postScript?: string
  /**
   * Test assertions. Endpoint rows keep their assertions INSIDE request_schema
   * (no separate column — see save-active-request.ts / open-endpoint-tab.ts);
   * the Apinizer interop reads/writes them here for the Postman x-apinizer
   * round-trip.
   */
  assertions?: TestAssertionLike[]
  /** Request timeout in seconds — carried via x-apinizer.timeoutSeconds. */
  timeoutSeconds?: number
  /**
   * OpenAPI round-trip metadata. Populated by `importOpenApi`; consumed by
   * `exportProjectAsOpenApi` to preserve tags / operationId / security /
   * parameter `required` flags / xml body content. Optional — older rows
   * exported just fine without it (with sensible fallbacks).
   */
  openApi?: OpenApiRoundtripMeta
}

function buildPostmanUrl(rawUrl: string, params: UiKeyValuePair[] = []): PostmanUrl {
  const PLACEHOLDER = '__VAR__'
  const safe = (rawUrl || '').replace(/\{\{[^}]+\}\}/g, PLACEHOLDER)
  let parsed: URL | null = null
  try {
    parsed = new URL(safe)
  } catch {
    parsed = null
  }

  const result: PostmanUrl = { raw: rawUrl }
  if (parsed) {
    result.protocol = parsed.protocol.replace(':', '')
    const hostStr = parsed.hostname.replace(new RegExp(PLACEHOLDER, 'g'), '{{var}}')
    result.host = hostStr.split('.')
    if (parsed.port) result.port = parsed.port
    const pathnameRestored = parsed.pathname.replace(new RegExp(PLACEHOLDER, 'g'), '*')
    result.path = pathnameRestored.split('/').filter((s) => s.length > 0)
  } else {
    result.path = (rawUrl ?? '').split('/').filter((s) => s && !s.startsWith('{{'))
  }

  if (params.length > 0) {
    result.query = params.map((p) => ({
      key: p.key,
      value: p.value,
      description: p.description,
      disabled: p.enabled === false ? true : undefined,
    }))
  }

  return result
}

export function bodyToPostman(body: UiRequestSchema['body']): PostmanBody | undefined {
  if (!body || !body.type || body.type === 'none') return undefined
  // GraphQL requests imported from Postman are stored as `{type:'json', content:
  // '{"query":"...","variables":{...}}'}` (see line 1435). Detect that shape on
  // the way out so a Postman → Testnizer → Postman round-trip preserves the
  // GraphQL editor mode rather than degrading to a raw JSON body.
  if (body.type === 'json' && body.content) {
    try {
      const parsed = JSON.parse(body.content) as { query?: unknown; variables?: unknown }
      if (typeof parsed?.query === 'string') {
        return {
          mode: 'graphql',
          graphql: {
            query: parsed.query,
            variables: parsed.variables !== undefined ? JSON.stringify(parsed.variables) : '{}',
          },
        }
      }
    } catch {
      // Not valid JSON — fall through to raw json export.
    }
  }
  switch (body.type) {
    case 'json':
      return { mode: 'raw', raw: body.content ?? '', options: { raw: { language: 'json' } } }
    case 'xml':
      return { mode: 'raw', raw: body.content ?? '', options: { raw: { language: 'xml' } } }
    case 'html':
      return { mode: 'raw', raw: body.content ?? '', options: { raw: { language: 'html' } } }
    case 'javascript':
      return { mode: 'raw', raw: body.content ?? '', options: { raw: { language: 'javascript' } } }
    case 'text':
      return { mode: 'raw', raw: body.content ?? '', options: { raw: { language: 'text' } } }
    case 'form-data':
      return {
        mode: 'formdata',
        formdata: (body.formData ?? []).map((kv) => {
          if (kv.type === 'file') {
            // Postman v2.1 file field: `{ key, type: 'file', src: '...' }`.
            return {
              key: kv.key,
              type: 'file',
              src: kv.filePath ?? kv.value ?? '',
              disabled: kv.enabled === false ? true : undefined,
            }
          }
          return {
            key: kv.key,
            value: kv.value,
            disabled: kv.enabled === false ? true : undefined,
            type: 'text',
          }
        }),
      }
    case 'urlencoded':
      return {
        mode: 'urlencoded',
        urlencoded: (body.urlEncoded ?? []).map((kv) => ({
          key: kv.key,
          value: kv.value,
          disabled: kv.enabled === false ? true : undefined,
        })),
      }
    case 'binary':
      return { mode: 'file', file: { src: body.content ?? '' } }
    default:
      return undefined
  }
}

function authToPostman(auth: UiRequestSchema['auth']): PostmanAuth | undefined {
  if (!auth || !auth.type || auth.type === 'none') return undefined
  const t = auth.type as string
  switch (t) {
    case 'basic': {
      const a = (auth.basic ?? {}) as { username?: string; password?: string }
      return {
        type: 'basic',
        basic: [
          { key: 'username', value: a.username ?? '', type: 'string' },
          { key: 'password', value: a.password ?? '', type: 'string' },
        ],
      }
    }
    case 'bearer': {
      const a = (auth.bearer ?? {}) as { token?: string }
      return { type: 'bearer', bearer: [{ key: 'token', value: a.token ?? '', type: 'string' }] }
    }
    case 'api-key': {
      const a = (auth.apiKey ?? {}) as { key?: string; value?: string; in?: string }
      return {
        type: 'apikey',
        apikey: [
          { key: 'key', value: a.key ?? '', type: 'string' },
          { key: 'value', value: a.value ?? '', type: 'string' },
          { key: 'in', value: a.in ?? 'header', type: 'string' },
        ],
      }
    }
    case 'digest': {
      const a = (auth.digest ?? {}) as { username?: string; password?: string }
      return {
        type: 'digest',
        digest: [
          { key: 'username', value: a.username ?? '' },
          { key: 'password', value: a.password ?? '' },
        ],
      }
    }
    case 'ntlm': {
      const a = (auth.ntlm ?? {}) as {
        username?: string
        password?: string
        domain?: string
        workstation?: string
      }
      return {
        type: 'ntlm',
        ntlm: [
          { key: 'username', value: a.username ?? '' },
          { key: 'password', value: a.password ?? '' },
          { key: 'domain', value: a.domain ?? '' },
          { key: 'workstation', value: a.workstation ?? '' },
        ],
      }
    }
    case 'oauth2': {
      const a = (auth.oauth2 ?? {}) as Record<string, string>
      return {
        type: 'oauth2',
        oauth2: [
          { key: 'accessToken', value: a.token ?? '' },
          { key: 'accessTokenUrl', value: a.tokenUrl ?? '' },
          { key: 'authUrl', value: a.authUrl ?? '' },
          { key: 'clientId', value: a.clientId ?? '' },
          { key: 'clientSecret', value: a.clientSecret ?? '' },
          { key: 'scope', value: a.scope ?? '' },
        ],
      }
    }
    default:
      return undefined
  }
}

// ─── Shared export row shapes ──────────────────────────────────
// Both project endpoints and test-suite items export through the same
// collection / Insomnia builders. Suite items keep their request URL in `url`
// rather than `path`, so the suite wrappers map onto this shape.
interface ExportFolderRow {
  id: string
  parent_id: string | null
  name: string
  /** Suite folders carry cascade auth/scripts; project folders pass these undefined. */
  auth?: string | null
  pre_script?: string | null
  post_script?: string | null
}

interface ExportEndpointRow {
  id: string
  folder_id: string | null
  method: string | null
  path: string
  name: string
  description: string | null
  request_schema: string | null
  /** Suite items store assertions in their own column (not in request_schema);
   *  project endpoints keep them inside request_schema. Threaded here so the
   *  x-apinizer export reads whichever the source uses. */
  assertions?: string | null
  /** Source protocol (http/soap/grpc/…) — drives the derived x-apinizer
   *  apiType/testType. Optional: the Insomnia export path leaves it undefined. */
  protocol?: string | null
}

type PostmanScriptEvent = {
  listen: 'prerequest' | 'test'
  script: { type: string; exec: string[] }
}

/** Map a request schema's pre/post scripts onto Postman's event[]. */
function scriptsToPostmanEvents(pre?: string | null, post?: string | null): PostmanScriptEvent[] {
  const events: PostmanScriptEvent[] = []
  if (pre && pre.trim()) {
    events.push({
      listen: 'prerequest',
      script: { type: 'text/javascript', exec: pre.split('\n') },
    })
  }
  if (post && post.trim()) {
    events.push({ listen: 'test', script: { type: 'text/javascript', exec: post.split('\n') } })
  }
  return events
}

/**
 * Pick a project's variable source — its active environment, falling back to
 * the first one created — and project it as Postman collection variables.
 * Globals are intentionally excluded: they belong to a different scope and
 * round-tripping them as collection-level vars would leak across collections.
 */
function collectPostmanVariables(
  db: ReturnType<typeof getDb>,
  projectId: string,
): PostmanVariable[] | undefined {
  const envRow =
    (db
      .prepare(
        `SELECT id FROM environments WHERE project_id = ? AND is_active = 1
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(projectId) as { id: string } | undefined) ??
    (db
      .prepare(
        `SELECT id FROM environments WHERE project_id = ?
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(projectId) as { id: string } | undefined)
  if (!envRow) return undefined
  const rows = db
    .prepare(
      `SELECT key, value FROM environment_variables WHERE environment_id = ?
       ORDER BY rowid ASC`,
    )
    .all(envRow.id) as Array<{ key: string; value: string | null }>
  if (rows.length === 0) return undefined
  return rows.map((r) => ({ key: r.key, value: r.value ?? '', type: 'string' }))
}

/** Build a Postman v2.1 collection from folder + endpoint rows (shared by project & suite export). */
function buildPostmanCollection(
  name: string,
  description: string | null,
  folders: ExportFolderRow[],
  endpoints: ExportEndpointRow[],
  variables?: PostmanVariable[],
): PostmanCollection {
  type PostmanFolderNode = PostmanItem & {
    auth?: ReturnType<typeof authToPostman>
    event?: PostmanScriptEvent[]
  }
  const folderMap = new Map<string, PostmanItem>()
  const rootItems: PostmanItem[] = []

  for (const folder of folders) {
    const node: PostmanFolderNode = { name: folder.name, item: [] }
    // Suite folders carry cascade auth/scripts → Postman folder-level auth + event.
    if (folder.auth) {
      try {
        const a = authToPostman(JSON.parse(folder.auth) as UiRequestSchema['auth'])
        if (a) node.auth = a
      } catch {
        /* malformed folder auth — skip rather than abort the export */
      }
    }
    const fEvents = scriptsToPostmanEvents(folder.pre_script, folder.post_script)
    if (fEvents.length > 0) node.event = fEvents
    folderMap.set(folder.id, node)
  }

  for (const folder of folders) {
    const node = folderMap.get(folder.id)
    if (!node) continue
    if (folder.parent_id && folderMap.has(folder.parent_id)) {
      folderMap.get(folder.parent_id)!.item!.push(node)
    } else {
      rootItems.push(node)
    }
  }

  for (const ep of endpoints) {
    const method = (ep.method ?? 'GET').toUpperCase()
    let schema: UiRequestSchema = {}
    if (ep.request_schema) {
      try {
        schema = JSON.parse(ep.request_schema) as UiRequestSchema
      } catch {
        schema = {}
      }
    }
    const url = schema.url ?? ep.path

    const item: PostmanItem = {
      name: ep.name,
      request: {
        method,
        header: (schema.headers ?? []).map((h) => ({
          key: h.key,
          value: h.value,
          description: h.description,
          disabled: h.enabled === false ? true : undefined,
        })),
        url: buildPostmanUrl(url, schema.params),
        description: ep.description ?? undefined,
      },
    }

    const body = bodyToPostman(schema.body)
    if (body) item.request!.body = body
    const auth = authToPostman(schema.auth)
    if (auth) item.request!.auth = auth

    // Pre-request and test scripts → Postman event[]
    const events = scriptsToPostmanEvents(schema.preScript, schema.postScript)
    if (events.length > 0) {
      ;(item as PostmanItem & { event?: PostmanScriptEvent[] }).event = events
    }

    // ── Apinizer interop: attach x-apinizer when there's carryable fidelity ──
    // Assertions live either on a threaded column (suite items) or inside
    // request_schema (project endpoints) — prefer the column, fall back to the
    // schema. We only attach the extension when there's something Apinizer can
    // actually carry (mapped assertions or a timeout) so pure Postman exports
    // stay clean.
    let itemAssertions: TestAssertionLike[] = []
    if (ep.assertions) {
      try {
        const parsed = JSON.parse(ep.assertions) as TestAssertionLike[]
        if (Array.isArray(parsed)) itemAssertions = parsed
      } catch {
        /* malformed assertions column — skip */
      }
    }
    if (itemAssertions.length === 0 && Array.isArray(schema.assertions)) {
      itemAssertions = schema.assertions
    }
    const xaAssertions = assertionsToXApinizer(itemAssertions)
    const timeoutSeconds =
      typeof schema.timeoutSeconds === 'number' ? schema.timeoutSeconds : undefined
    if (xaAssertions.length > 0 || timeoutSeconds !== undefined) {
      const { apiType, testType } = protocolToApinizerTypes(ep.protocol ?? undefined)
      const ext: XApinizerExtension = {
        schemaVersion: '1.0',
        source: 'testnizer',
        testType,
        apiType,
      }
      const rowType = bodyTypeToApinizerRowType(schema.body?.type)
      if (rowType) ext.bodyRowType = rowType
      if (timeoutSeconds !== undefined) ext.timeoutSeconds = timeoutSeconds
      if (xaAssertions.length > 0) ext.assertions = xaAssertions
      ;(item as PostmanItem)['x-apinizer'] = ext
    }

    if (ep.folder_id && folderMap.has(ep.folder_id)) {
      folderMap.get(ep.folder_id)!.item!.push(item)
    } else {
      rootItems.push(item)
    }
  }

  const collection: PostmanCollection = {
    info: {
      name,
      description: description ?? undefined,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: rootItems,
  }
  if (variables) collection.variable = variables
  return collection
}

export function exportAsPostman(projectId: string): string {
  const db = getDb()

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | { name: string; description: string | null }
    | undefined
  if (!project) throw new Error('Project not found')

  // Project folders don't surface cascade auth/scripts in the collection — keep
  // the historical shape by selecting only id/parent_id/name.
  const folders = db
    .prepare('SELECT id, parent_id, name FROM folders WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as ExportFolderRow[]
  const endpoints = db
    .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as ExportEndpointRow[]

  const collection = buildPostmanCollection(
    project.name,
    project.description ?? null,
    folders,
    endpoints,
    collectPostmanVariables(db, projectId),
  )
  return JSON.stringify(collection, null, 2)
}

/**
 * Export a test suite as a Postman v2.1 collection. Suite items carry their
 * full request snapshot inline (url + request_schema), and suite folders carry
 * cascade auth / pre / post scripts — both round-trip into the collection so the
 * suite runs in Postman the way it does here.
 */
export function exportSuiteAsPostman(suiteId: string): string {
  const db = getDb()

  const suite = db.prepare('SELECT * FROM test_suites WHERE id = ?').get(suiteId) as
    | { name: string; description: string | null; project_id: string }
    | undefined
  if (!suite) throw new Error('Test suite not found')

  const folders = db
    .prepare(
      `SELECT id, parent_id, name, auth, pre_script, post_script
       FROM test_suite_folders WHERE suite_id = ? ORDER BY sort_order ASC`,
    )
    .all(suiteId) as ExportFolderRow[]
  const items = db
    .prepare('SELECT * FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order ASC')
    .all(suiteId) as Array<{
    id: string
    folder_id: string | null
    method: string | null
    url: string | null
    name: string
    request_schema: string | null
    assertions: string | null
    protocol: string | null
  }>
  const endpoints: ExportEndpointRow[] = items.map((it) => ({
    id: it.id,
    folder_id: it.folder_id,
    method: it.method,
    path: it.url ?? '',
    name: it.name,
    description: null,
    request_schema: it.request_schema,
    // Suite items carry assertions in their own column → thread so the
    // x-apinizer export can emit them.
    assertions: it.assertions,
    protocol: it.protocol,
  }))

  const collection = buildPostmanCollection(
    suite.name,
    suite.description ?? null,
    folders,
    endpoints,
    collectPostmanVariables(db, suite.project_id),
  )
  return JSON.stringify(collection, null, 2)
}

// ─── cURL Types ─────────────────────────────────────────────

interface CurlExportRequest {
  method: string
  url: string
  headers?: Array<{ key: string; value: string; enabled: boolean }>
  body?: {
    type: string
    content?: string
    formData?: Array<{
      key: string
      value: string
      enabled: boolean
      type?: 'text' | 'file'
      filePath?: string
    }>
    urlEncoded?: Array<{ key: string; value: string; enabled: boolean }>
  }
  auth?: {
    type: string
    basic?: { username: string; password: string }
    bearer?: { token: string; prefix?: string }
  }
  sslVerification?: boolean
  cookies?: string
}

// ─── cURL Import ────────────────────────────────────────────

function importCurl(
  projectId: string,
  curlCommand: string,
  parentFolderId: string | null = null,
): ImportResult {
  const warnings: string[] = []
  const db = getDb()
  const now = Date.now()

  // Reject input that obviously isn't a cURL command before parsing —
  // protects against the same wrong-file-type confusion as the Postman /
  // Insomnia importers (v1.4.6). A real cURL starts with `curl `
  // (optionally preceded by whitespace, line continuations, or a `$ `
  // shell prompt). Anything else gets a single generic message.
  const cleaned = (curlCommand || '').replace(/^\s*\$\s*/, '').trim()
  if (!/^curl(\s|$)/i.test(cleaned)) {
    return {
      success: false,
      error: "This is not a cURL command. You can't upload this file type from here.",
    }
  }

  // Parse cURL command
  const parsed = parseCurlCommand(curlCommand)

  if (!parsed.url) {
    return { success: false, error: 'No URL found in cURL command' }
  }

  const endpointId = randomUUID()
  let path = ''
  try {
    path = new URL(parsed.url).pathname
  } catch {
    path = parsed.url
  }

  const name = `${parsed.method} ${path}`

  const requestSchema: Record<string, unknown> = {}

  if (parsed.headers && Object.keys(parsed.headers).length > 0) {
    // Persist as KeyValuePair[] so the renderer's request store can load it
    // directly without an ad-hoc map → array conversion at every read site.
    requestSchema.headers = Object.entries(parsed.headers).map(([key, value]) => ({
      id: randomUUID(),
      key,
      value,
      enabled: true,
    }))
  }
  if (parsed.formData && parsed.formData.length > 0) {
    requestSchema.body = {
      type: 'form-data',
      formData: parsed.formData.map((row) => ({
        id: randomUUID(),
        key: row.key,
        value: row.value,
        enabled: true,
        type: row.type,
        filePath: row.filePath,
      })),
    }
  } else if (parsed.body) {
    // Best-effort: classify the raw body string by header content-type so the
    // user lands on the right body tab in the UI.
    const ct = parsed.headers['Content-Type'] ?? parsed.headers['content-type'] ?? ''
    if (/application\/x-www-form-urlencoded/i.test(ct)) {
      const urlEncoded = parsed.body.split('&').map((pair) => {
        const eq = pair.indexOf('=')
        const key = eq === -1 ? pair : pair.slice(0, eq)
        const value = eq === -1 ? '' : pair.slice(eq + 1)
        return {
          id: randomUUID(),
          key: decodeURIComponent(key),
          value: decodeURIComponent(value),
          enabled: true,
        }
      })
      requestSchema.body = { type: 'urlencoded', urlEncoded }
    } else if (/json/i.test(ct)) {
      requestSchema.body = { type: 'json', content: parsed.body }
    } else if (/xml/i.test(ct)) {
      requestSchema.body = { type: 'xml', content: parsed.body }
    } else {
      requestSchema.body = { type: 'raw', content: parsed.body }
    }
  }
  if (parsed.auth) {
    requestSchema.auth = parsed.auth
  }

  db.prepare(
    `
    INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    endpointId,
    projectId,
    parentFolderId,
    name,
    null,
    'http',
    parsed.method,
    path,
    'developing',
    Object.keys(requestSchema).length > 0 ? JSON.stringify(requestSchema) : null,
    null,
    0,
    now,
    now,
  )

  return {
    success: true,
    collectionId: projectId,
    endpointCount: 1,
    folderCount: 0,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

interface ParsedCurl {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  /**
   * Multipart `-F` rows parsed structurally so the importer can persist a
   * proper UI body shape (`{ type: 'form-data', formData: KeyValuePair[] }`)
   * instead of joining everything into a body string. `type: 'file'` rows
   * carry the source path in `filePath` for the main-process upload stream.
   */
  formData?: Array<{
    key: string
    value: string
    type?: 'text' | 'file'
    filePath?: string
  }>
  auth?: { type: string; basic?: { username: string; password: string } }
  insecure: boolean
  cookies?: string
}

export function parseCurlCommand(command: string): ParsedCurl {
  // Normalize the command
  const normalized = command
    .replace(/\\\n/g, ' ') // Line continuations
    .replace(/\\\r\n/g, ' ')
    .trim()

  const result: ParsedCurl = {
    method: 'GET',
    url: '',
    headers: {},
    insecure: false,
  }

  // Track whether the body was set via -d/--data/--data-raw/--data-binary so we
  // can auto-add Content-Type: application/x-www-form-urlencoded at the end of
  // parsing if the user did not provide one. This matches cURL's actual
  // behaviour for these flags.
  let bodyFromDataFlag = false

  const tokens = tokenizeCurl(normalized)

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]

    switch (token) {
      case 'curl':
        // skip the command itself
        break

      case '-X':
      case '--request': {
        i++
        if (i < tokens.length) {
          result.method = tokens[i].toUpperCase()
        }
        break
      }

      case '-H':
      case '--header': {
        i++
        if (i < tokens.length) {
          const headerStr = tokens[i]
          const colonIdx = headerStr.indexOf(':')
          if (colonIdx > 0) {
            const key = headerStr.substring(0, colonIdx).trim()
            const value = headerStr.substring(colonIdx + 1).trim()
            result.headers[key] = value
          }
        }
        break
      }

      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii': {
        i++
        if (i < tokens.length) {
          result.body = tokens[i]
          bodyFromDataFlag = true
          // If method is still GET, change to POST
          if (result.method === 'GET') {
            result.method = 'POST'
          }
        }
        break
      }

      case '--data-urlencode': {
        i++
        if (i < tokens.length) {
          const existing = result.body || ''
          const sep = existing ? '&' : ''
          result.body = existing + sep + tokens[i]
          if (result.method === 'GET') {
            result.method = 'POST'
          }
          if (!result.headers['Content-Type']) {
            result.headers['Content-Type'] = 'application/x-www-form-urlencoded'
          }
        }
        break
      }

      case '-u':
      case '--user': {
        i++
        if (i < tokens.length) {
          const userPass = tokens[i]
          const colonIdx = userPass.indexOf(':')
          if (colonIdx > 0) {
            result.auth = {
              type: 'basic',
              basic: {
                username: userPass.substring(0, colonIdx),
                password: userPass.substring(colonIdx + 1),
              },
            }
          }
        }
        break
      }

      case '-k':
      case '--insecure': {
        result.insecure = true
        break
      }

      case '-b':
      case '--cookie': {
        i++
        if (i < tokens.length) {
          result.cookies = tokens[i]
        }
        break
      }

      case '-A':
      case '--user-agent': {
        i++
        if (i < tokens.length) {
          result.headers['User-Agent'] = tokens[i]
        }
        break
      }

      case '-e':
      case '--referer': {
        i++
        if (i < tokens.length) {
          result.headers['Referer'] = tokens[i]
        }
        break
      }

      case '-x':
      case '--proxy': {
        // Consume the proxy value but do not let it leak into result.url.
        // Proxy is not yet surfaced on the imported endpoint schema.
        i++
        break
      }

      case '-L':
      case '--location':
      case '--compressed': {
        // Boolean flags with no value; safely ignored at parse time.
        break
      }

      case '-F':
      case '--form': {
        i++
        if (i < tokens.length) {
          // Multipart form data — content-type boundary is set by the HTTP
          // client when it builds the multipart body, so we don't pre-fill
          // `Content-Type` from the importer.
          const formPart = tokens[i]
          const eqIdx = formPart.indexOf('=')
          if (eqIdx > 0) {
            const fieldName = formPart.slice(0, eqIdx)
            const rawValue = formPart.slice(eqIdx + 1)
            const row = parseCurlFormPart(fieldName, rawValue)
            if (!result.formData) result.formData = []
            result.formData.push(row)
          }
          if (result.method === 'GET') {
            result.method = 'POST'
          }
        }
        break
      }

      default: {
        // If it looks like a URL (not a flag), capture it
        if (!token.startsWith('-') && !result.url) {
          result.url = token
        }
        break
      }
    }
    i++
  }

  // cURL behaviour: -d / --data / --data-raw / --data-binary all imply
  // Content-Type: application/x-www-form-urlencoded when the user did not
  // supply one explicitly via -H. We only add the default after all tokens
  // have been processed so a later -H overrides nothing.
  if (bodyFromDataFlag && !hasContentTypeHeader(result.headers)) {
    result.headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  return result
}

function hasContentTypeHeader(headers: Record<string, string>): boolean {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-type') return true
  }
  return false
}

/**
 * Parse a single cURL `-F` value (everything after `field=`).
 * - `@/path/to/file`     → `{ type: 'file', filePath: '/path/to/file', value: <basename> }`
 * - `@/path;type=...`    → file row, the `;type=`/`;filename=` modifiers are noted in `value` only as basename
 * - `<value>`            → text row with the literal value
 * `<` (read-from-file then send as text) is rare; we fall back to text.
 */
function parseCurlFormPart(
  fieldName: string,
  rawValue: string,
): { key: string; value: string; type?: 'text' | 'file'; filePath?: string } {
  if (rawValue.startsWith('@')) {
    // Strip `;type=...;filename=...` modifiers that aren't part of the path
    const semiIdx = rawValue.indexOf(';')
    const path = semiIdx === -1 ? rawValue.slice(1) : rawValue.slice(1, semiIdx)
    const baseName = path.split(/[/\\]/).pop() ?? path
    return { key: fieldName, value: baseName, type: 'file', filePath: path }
  }
  return { key: fieldName, value: rawValue, type: 'text' }
}

export function tokenizeCurl(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let inAnsiC = false // bash $'...' — backslash escapes interpreted
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    if (escaped) {
      // Inside $'...': decode common bash ANSI-C escapes; elsewhere preserve verbatim.
      if (inAnsiC) {
        current += decodeAnsiCEscape(ch)
      } else {
        current += ch
      }
      escaped = false
      continue
    }

    // ANSI-C quoting opener: $'...'
    if (ch === '$' && !inSingle && !inDouble && !inAnsiC && command[i + 1] === "'") {
      inAnsiC = true
      i++ // skip the opening single quote
      continue
    }

    // Inside $'...': only \ and the closing ' are special; spaces are literal.
    if (inAnsiC) {
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === "'") {
        inAnsiC = false
        continue
      }
      current += ch
      continue
    }

    if (ch === '\\' && !inSingle) {
      escaped = true
      continue
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }

    if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

/** Decode a single character that follows `\` inside a bash `$'...'` literal. */
function decodeAnsiCEscape(ch: string | undefined): string {
  switch (ch) {
    case 'n':
      return '\n'
    case 't':
      return '\t'
    case 'r':
      return '\r'
    case 'a':
      return '\x07'
    case 'b':
      return '\b'
    case 'f':
      return '\f'
    case 'v':
      return '\v'
    case '0':
      return '\0'
    case '\\':
      return '\\'
    case "'":
      return "'"
    case '"':
      return '"'
    case '?':
      return '?'
    case 'e':
    case 'E':
      return '\x1b'
    default:
      return ch ?? ''
  }
}

// ─── cURL Export ────────────────────────────────────────────

/**
 * POSIX-shell-quote a value for use inside a cURL command line. Returns the
 * value wrapped in single quotes, with any internal `'` rewritten as `'\''`
 * (close-quote, escaped quote, reopen-quote). This is the canonical way to
 * embed arbitrary text in a single-quoted bash word and is what cURL itself
 * expects when round-tripping. Always pass user-controlled strings (URL,
 * header values, cookies, passwords, body content, form values) through this
 * helper before interpolating them into the output.
 */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

export function exportAsCurl(request: CurlExportRequest): string {
  const parts: string[] = ['curl']

  // Method
  if (request.method && request.method !== 'GET') {
    parts.push(`-X ${request.method.toUpperCase()}`)
  }

  // URL
  parts.push(shellEscape(request.url))

  // Headers
  if (request.headers) {
    for (const h of request.headers) {
      if (h.enabled && h.key) {
        parts.push(`-H ${shellEscape(`${h.key}: ${h.value}`)}`)
      }
    }
  }

  // Auth
  if (request.auth) {
    if (request.auth.type === 'basic' && request.auth.basic) {
      parts.push(
        `-u ${shellEscape(`${request.auth.basic.username}:${request.auth.basic.password}`)}`,
      )
    } else if (request.auth.type === 'bearer' && request.auth.bearer) {
      const prefix = request.auth.bearer.prefix || 'Bearer'
      parts.push(`-H ${shellEscape(`Authorization: ${prefix} ${request.auth.bearer.token}`)}`)
    }
  }

  // Body
  if (request.body && request.body.type !== 'none') {
    switch (request.body.type) {
      case 'json':
      case 'xml':
      case 'text':
      case 'html':
      case 'javascript': {
        if (request.body.content) {
          parts.push(`-d ${shellEscape(request.body.content)}`)
        }
        break
      }
      case 'urlencoded': {
        if (request.body.urlEncoded) {
          for (const item of request.body.urlEncoded) {
            if (item.enabled) {
              parts.push(`--data-urlencode ${shellEscape(`${item.key}=${item.value}`)}`)
            }
          }
        }
        break
      }
      case 'form-data': {
        if (request.body.formData) {
          for (const item of request.body.formData) {
            if (!item.enabled) continue
            if (item.type === 'file' && item.filePath) {
              // cURL convention for file uploads: -F 'field=@/path/to/file'
              parts.push(`-F ${shellEscape(`${item.key}=@${item.filePath}`)}`)
            } else {
              parts.push(`-F ${shellEscape(`${item.key}=${item.value}`)}`)
            }
          }
        }
        break
      }
    }
  }

  // Cookies
  if (request.cookies) {
    parts.push(`-b ${shellEscape(request.cookies)}`)
  }

  // SSL
  if (request.sslVerification === false) {
    parts.push('-k')
  }

  return parts.join(' \\\n  ')
}

// ─── HAR Types ──────────────────────────────────────────────

interface HarLog {
  log: {
    version: string
    entries: HarEntry[]
  }
}

interface HarEntry {
  request: {
    method: string
    url: string
    httpVersion?: string
    // HAR 1.2 doesn't define a `disabled` field, but some exporters (e.g.
    // browser extensions, request capture tools) include one — honor it on
    // import so a captured-but-disabled header doesn't get re-sent on replay.
    headers: Array<{ name: string; value: string; disabled?: boolean }>
    queryString: Array<{ name: string; value: string; disabled?: boolean }>
    postData?: {
      mimeType?: string
      text?: string
      params?: Array<{ name: string; value: string; disabled?: boolean }>
    }
  }
  response?: {
    status: number
    statusText?: string
    headers?: Array<{ name: string; value: string }>
    content?: {
      size?: number
      mimeType?: string
      text?: string
    }
  }
  time?: number
  timings?: {
    send?: number
    wait?: number
    receive?: number
  }
}

// ─── HAR Import ─────────────────────────────────────────────

async function importHar(
  projectId: string,
  content: string,
  folderId: string | null = null,
): Promise<ImportResult> {
  const warnings: string[] = []
  let har: HarLog

  try {
    har = JSON.parse(content) as HarLog
  } catch {
    return { success: false, error: 'Failed to parse HAR file as JSON' }
  }

  if (!har.log || har.log.version !== '1.2') {
    return { success: false, error: 'Not a valid HAR 1.2 file (expected log.version === "1.2")' }
  }

  if (!har.log.entries || har.log.entries.length === 0) {
    return { success: false, error: 'HAR file contains no entries' }
  }

  const db = getDb()
  const now = Date.now()
  let endpointCount = 0

  for (const entry of har.log.entries) {
    const req = entry.request
    if (!req || !req.url) {
      warnings.push('Skipped entry with missing URL')
      continue
    }

    const method = (req.method || 'GET').toUpperCase()
    let path = ''
    let urlForName = req.url

    try {
      const parsedUrl = new URL(req.url)
      path = parsedUrl.pathname
      urlForName = parsedUrl.pathname
    } catch {
      path = req.url
    }

    const endpointId = randomUUID()
    const name = `${method} ${urlForName}`

    const requestSchema: Record<string, unknown> = { method, url: req.url }

    // Query string parameters → KeyValuePair[]
    if (req.queryString && req.queryString.length > 0) {
      requestSchema.params = req.queryString.map((q) => ({
        id: genKvId(),
        key: q.name,
        value: q.value,
        enabled: !q.disabled,
      }))
    }

    // Headers → KeyValuePair[]
    if (req.headers && req.headers.length > 0) {
      const headerList: Array<{
        id: string
        key: string
        value: string
        enabled: boolean
      }> = []
      for (const h of req.headers) {
        const lowerName = h.name.toLowerCase()
        if (lowerName.startsWith(':') || lowerName === 'host' || lowerName === 'connection') {
          continue
        }
        headerList.push({ id: genKvId(), key: h.name, value: h.value, enabled: !h.disabled })
      }
      if (headerList.length > 0) requestSchema.headers = headerList
    }

    // Body → RequestBody (UI shape)
    if (req.postData) {
      const postData = req.postData
      const mimeType = postData.mimeType || ''
      if (postData.text && postData.text.length <= 1_000_000) {
        let bodyType: 'json' | 'xml' | 'html' | 'text' | 'javascript' | 'urlencoded' = 'text'
        if (mimeType.includes('json')) bodyType = 'json'
        else if (mimeType.includes('xml')) bodyType = 'xml'
        else if (mimeType.includes('html')) bodyType = 'html'
        else if (mimeType.includes('javascript')) bodyType = 'javascript'
        else if (mimeType.includes('x-www-form-urlencoded')) bodyType = 'urlencoded'
        if (bodyType === 'urlencoded' && postData.params && postData.params.length > 0) {
          requestSchema.body = {
            type: 'urlencoded',
            urlEncoded: postData.params.map((p) => ({
              id: genKvId(),
              key: p.name,
              value: p.value,
              enabled: !p.disabled,
            })),
          }
        } else {
          requestSchema.body = { type: bodyType, content: postData.text }
        }
      } else if (postData.params && postData.params.length > 0) {
        requestSchema.body = {
          type: 'urlencoded',
          urlEncoded: postData.params.map((p) => ({
            id: genKvId(),
            key: p.name,
            value: p.value,
            enabled: !p.disabled,
          })),
        }
      } else if (postData.text && postData.text.length > 1_000_000) {
        warnings.push(`Skipped large body for ${method} ${path} (${postData.text.length} bytes)`)
      }
    }

    // Map response status as metadata
    const responseSchemas: Record<string, unknown> = {}
    if (entry.response) {
      const statusCode = String(entry.response.status)
      responseSchemas[statusCode] = {
        description: entry.response.statusText || 'Response',
      }
    }

    db.prepare(
      `
      INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      endpointId,
      projectId,
      folderId,
      name,
      null,
      'http',
      method,
      path,
      'developing',
      Object.keys(requestSchema).length > 0 ? JSON.stringify(requestSchema) : null,
      Object.keys(responseSchemas).length > 0 ? JSON.stringify(responseSchemas) : null,
      endpointCount,
      now,
      now,
    )
    endpointCount++
  }

  if (endpointCount === 0) {
    warnings.push('No valid entries found in HAR file')
  }

  return {
    success: true,
    collectionId: projectId,
    endpointCount,
    folderCount: 0,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

// ─── Insomnia Types ─────────────────────────────────────────

interface InsomniaExport {
  __export_format?: number
  __export_date?: string
  __export_source?: string
  _type?: string
  resources?: InsomniaResource[]
}

interface InsomniaResource {
  _id: string
  _type: string
  parentId?: string
  name?: string
  description?: string
  url?: string
  method?: string
  body?: InsomniaBody
  headers?: Array<{ name: string; value: string; disabled?: boolean }>
  parameters?: Array<{ name: string; value: string; disabled?: boolean; type?: string }>
  authentication?: InsomniaAuth
  data?: Array<{ name: string; value: string }>
  preRequestScript?: string
  afterResponseScript?: string
  /** v4 spelling of the sibling sort key (v5 nests it under meta.sortKey).
   *  Insomnia renders/runs siblings by this ascending — see sortByInsomniaSortKey. */
  metaSortKey?: number
}

interface InsomniaBody {
  mimeType?: string
  text?: string
  params?: Array<{
    name: string
    value: string
    fileName?: string
    type?: string
    disabled?: boolean
  }>
}

interface InsomniaAuth {
  type?: string
  username?: string
  password?: string
  token?: string
  prefix?: string
  key?: string
  value?: string
  addTo?: string
  disabled?: boolean
}

// ─── Insomnia Import ────────────────────────────────────────

// Insomnia v5 (Insomnia 8+) exports YAML with a different shape:
// `type: collection.insomnia.rest/5.0`, `collection: [{ children: [...] }]`,
// `meta: { id, name, ... }`. We accept both v4 JSON and v5 YAML/JSON here.
interface InsomniaV5Doc {
  type?: string
  name?: string
  meta?: { id?: string; name?: string }
  collection?: InsomniaV5Item[]
  environments?: { data?: Record<string, unknown>; name?: string }
  /** Collection-root authentication that every request inherits unless it
   *  carries (or a closer folder carries) its own block. */
  authentication?: InsomniaAuth
}

interface InsomniaV5Item {
  meta?: { id?: string; name?: string; sortKey?: number }
  name?: string
  url?: string
  method?: string
  headers?: Array<{ name: string; value: string; disabled?: boolean }>
  parameters?: Array<{ name: string; value: string; disabled?: boolean }>
  body?: InsomniaBody
  authentication?: InsomniaAuth
  description?: string
  children?: InsomniaV5Item[] // request groups
  scripts?: { preRequest?: string; afterResponse?: string }
}

/**
 * Insomnia renders and *runs* a folder's children ordered by `meta.sortKey`
 * ascending (more-negative first), NOT by their position in the exported YAML
 * array — the two routinely disagree. Importing in raw array order therefore
 * scrambled folders/requests, so a Run fired them out of sequence and
 * order-dependent chains (token setup → protected calls) broke. Sort every
 * sibling level by sortKey; stable on the original index so items that share or
 * lack a key keep their array order.
 */
function sortByInsomniaSortKey<T extends { meta?: { sortKey?: number }; metaSortKey?: number }>(
  items: T[],
): T[] {
  // v4 `resources` can contain null/garbage entries (the importer filters them
  // AFTER sorting), so guard before touching .meta / .metaSortKey.
  const keyOf = (it: T): number => {
    if (!it || typeof it !== 'object') return 0
    if (typeof it.meta?.sortKey === 'number') return it.meta.sortKey
    if (typeof it.metaSortKey === 'number') return it.metaSortKey
    return 0
  }
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => keyOf(a.item) - keyOf(b.item) || a.index - b.index)
    .map((entry) => entry.item)
}

function isInsomniaV5(doc: unknown): doc is InsomniaV5Doc {
  if (!doc || typeof doc !== 'object') return false
  const d = doc as Record<string, unknown>
  // Insomnia 8+ exports several document subtypes under the same shape:
  // `collection.insomnia.rest`, `spec.insomnia.rest` (OpenAPI-spec-wrapped
  // collections), and `proxy.insomnia.rest`. All carry a `collection: [...]`
  // array we can walk, so we accept any of them rather than blocking the
  // user with an "unknown format" error.
  return (
    typeof d.type === 'string' && /\binsomnia\.rest\b/.test(d.type) && Array.isArray(d.collection)
  )
}

/**
 * v5 environment exports are YAML with `type: environment.insomnia.rest/5.0`
 * and a top-level `data` map (`{ key: value }`). Detected separately from
 * collections so they can route to the environment importer instead of
 * falling through to v4 and erroring with "Insomnia v4 export contains no
 * resources" — the v1.3.1 M12 bug.
 */
function isInsomniaV5Environment(doc: unknown): doc is {
  type: string
  name?: string
  data?: Record<string, unknown>
} {
  if (!doc || typeof doc !== 'object') return false
  const d = doc as Record<string, unknown>
  return (
    typeof d.type === 'string' &&
    /\benvironment\.insomnia\.rest\b/.test(d.type) &&
    typeof d.data === 'object' &&
    d.data !== null
  )
}

export async function importInsomnia(
  projectId: string,
  content: string,
  rootFolderId: string | null = null,
): Promise<ImportResult> {
  const warnings: string[] = []
  let doc: unknown

  // Try JSON first; fall back to YAML for v5 exports.
  try {
    doc = JSON.parse(content)
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const yaml = require('js-yaml') as { load: (s: string) => unknown }
      doc = yaml.load(content)
    } catch (e) {
      return {
        success: false,
        error: 'Failed to parse Insomnia export (not valid JSON or YAML): ' + (e as Error).message,
      }
    }
  }

  if (isInsomniaV5Environment(doc)) {
    return {
      success: false,
      error:
        "This file is not an Insomnia request collection. You can't upload this file type from here.",
    }
  }
  if (isInsomniaV5(doc)) {
    return importInsomniaV5(projectId, doc, rootFolderId, warnings)
  }
  return importInsomniaV4(projectId, doc as InsomniaExport, rootFolderId, warnings)
}

/**
 * Import an Insomnia v5 environment YAML export. Creates (or replaces) a
 * project-scoped environment whose name matches the export's `name`. The
 * variables live under `data` as a flat `{ key: value }` map. Falls back to
 * the file's logical name when `name` is missing.
 */
function importInsomniaV5Environment(
  projectId: string,
  doc: { type: string; name?: string; data?: Record<string, unknown> },
  warnings: string[],
): ImportResult & { environmentId?: string; environmentName?: string } {
  const db = getDb()
  const now = Date.now()
  const envName = doc.name || 'Imported Insomnia Environment'

  const projectRow = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as
    | { workspace_id: string }
    | undefined
  if (!projectRow) {
    return { success: false, error: 'Project not found: ' + projectId }
  }

  const existing = db
    .prepare('SELECT id FROM environments WHERE project_id = ? AND name = ?')
    .get(projectId, envName) as { id: string } | undefined

  let envId: string
  if (existing) {
    envId = existing.id
    db.prepare('DELETE FROM environment_variables WHERE environment_id = ?').run(envId)
  } else {
    envId = randomUUID()
    const hasActive = db
      .prepare('SELECT 1 AS x FROM environments WHERE project_id = ? AND is_active = 1')
      .get(projectId) as { x: number } | undefined
    db.prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(envId, projectRow.workspace_id, projectId, envName, hasActive ? 0 : 1, now, now)
  }

  const insertVar = db.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, description, enabled, secret, initial_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  let varCount = 0
  for (const [k, v] of Object.entries(doc.data ?? {})) {
    if (!k) continue
    const stringValue = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v)
    insertVar.run(randomUUID(), envId, k, stringValue, null, 1, 0, stringValue)
    varCount++
  }
  if (varCount === 0) {
    warnings.push('Insomnia v5 environment had no variables — created an empty environment.')
  }
  return {
    success: true,
    environmentId: envId,
    environmentName: envName,
    endpointCount: 0,
    folderCount: 0,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

/**
 * Insomnia stores query parameters in a separate `parameters[]` array and
 * keeps the request `url` clean, whereas Postman's `url.raw` carries the
 * `?query`. Without folding the params back into the URL, an Insomnia-imported
 * request shows no query in the URL bar (issue #12). Append enabled params the
 * same way Postman's raw URL would (unencoded so `{{vars}}` survive).
 */
export function insomniaUrlWithParams(
  url: string,
  params: Array<{ key: string; value: string; enabled: boolean }>,
): string {
  if (url.includes('?')) return url // already carries a query — leave it
  const qs = params
    .filter((p) => p.enabled && p.key.trim() !== '')
    .map((p) => (p.value !== '' ? `${p.key}=${p.value}` : p.key))
    .join('&')
  return qs ? `${url}?${qs}` : url
}

function importInsomniaV4(
  projectId: string,
  doc: InsomniaExport,
  rootFolderId: string | null,
  warnings: string[],
): ImportResult {
  if (!doc.resources || doc.resources.length === 0) {
    return { success: false, error: 'Insomnia v4 export contains no resources' }
  }

  if (doc.__export_format && doc.__export_format !== 4) {
    warnings.push(`Unexpected __export_format=${doc.__export_format}; importing best-effort.`)
  }

  // Insomnia renders/runs siblings by metaSortKey ascending, NOT export array
  // order (the two disagree). Sort the flat resource list once so folder + request
  // sort_order (assigned sequentially below) reflects the real execution order —
  // otherwise order-dependent chains (token setup → protected calls) run scrambled.
  const resources = sortByInsomniaSortKey(doc.resources)
  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0
  const endpointIds: string[] = []
  const suggestedEnvVars: Record<string, string> = {}

  const folderMap = new Map<string, string>()

  // First pass: create folders. Insomnia v4 lists resources flat with parentId
  // pointers, and parents may appear after children — so we do this in two
  // passes (first create, then re-parent). Folder-level auth + scripts are
  // persisted so the suite importer can cascade them at run time.
  for (const resource of resources) {
    if (!resource || typeof resource !== 'object') continue
    if (resource._type === 'request_group' && resource._id) {
      const folderId = randomUUID()
      const folderAuthUi = mapInsomniaAuthToUi(resource.authentication)
      const folderPre = resource.preRequestScript
        ? normalizeInsomniaScript(resource.preRequestScript)
        : null
      const folderPost = resource.afterResponseScript
        ? normalizeInsomniaScript(resource.afterResponseScript)
        : null
      db.prepare(
        `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth, pre_script, post_script)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        folderId,
        projectId,
        rootFolderId,
        resource.name || 'Folder',
        folderCount,
        folderAuthUi ? JSON.stringify(folderAuthUi) : null,
        folderPre,
        folderPost,
      )
      folderMap.set(resource._id, folderId)
      folderCount++
    }
  }

  for (const resource of resources) {
    if (!resource || typeof resource !== 'object') continue
    if (resource._type === 'request_group' && resource.parentId && resource._id) {
      const folderId = folderMap.get(resource._id)
      const parentFolderId = folderMap.get(resource.parentId) ?? rootFolderId
      if (folderId) {
        db.prepare(`UPDATE folders SET parent_id = ? WHERE id = ?`).run(parentFolderId, folderId)
      }
    }
  }

  for (const resource of resources) {
    if (!resource || typeof resource !== 'object') continue
    if (resource._type !== 'request') continue
    const method = (resource.method ?? 'GET').toUpperCase()
    const url = resource.url ?? ''
    const path = extractPath(url)
    const parentFolderId = resource.parentId
      ? (folderMap.get(resource.parentId) ?? rootFolderId)
      : rootFolderId

    const params = (resource.parameters ?? []).map((p) => ({
      id: genKvId(),
      key: p.name,
      value: p.value,
      enabled: !p.disabled,
    }))
    const headers = (resource.headers ?? []).map((h) => ({
      id: genKvId(),
      key: h.name,
      value: h.value,
      enabled: !h.disabled,
    }))
    const body = mapInsomniaBodyToUi(resource.body)
    const auth = mapInsomniaAuthToUi(resource.authentication)

    const preScript = resource.preRequestScript
      ? normalizeInsomniaScript(resource.preRequestScript)
      : undefined
    const postScript = resource.afterResponseScript
      ? normalizeInsomniaScript(resource.afterResponseScript)
      : undefined

    const requestSchema: Record<string, unknown> = {
      url: insomniaUrlWithParams(url, params),
      method,
      params,
      headers,
      body,
    }
    if (auth) requestSchema.auth = auth
    if (preScript) requestSchema.preScript = preScript
    if (postScript) requestSchema.postScript = postScript

    const endpointId = randomUUID()
    db.prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      endpointId,
      projectId,
      parentFolderId,
      resource.name || `${method} ${path}`,
      resource.description ?? null,
      'http',
      method,
      path || '/',
      'developing',
      JSON.stringify(requestSchema),
      null,
      endpointCount,
      now,
      now,
    )
    endpointIds.push(endpointId)
    endpointCount++
  }

  // Insomnia v4 environment resources used to be silently collected into
  // `suggestedEnvVars` only — they never actually became real environments
  // in the DB, so the EnvironmentModal showed a success toast but the
  // import was invisible (v1.4.2 #3). Now we persist each one as a proper
  // environment row, mirroring the v5 importer.
  const projectRow = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as
    | { workspace_id: string }
    | undefined
  let environmentCount = 0
  const lastEnv: { id: string; name: string } | null = (() => {
    if (!projectRow) return null
    const envResources = resources.filter(
      (r) => r && typeof r === 'object' && (r as InsomniaResource)._type === 'environment',
    )
    let last: { id: string; name: string } | null = null
    for (const resource of envResources) {
      const r = resource as InsomniaResource & { name?: string; data?: unknown }
      const rawName = (r.name || '').trim() || 'Imported Insomnia Environment'
      // Reuse name if it already exists to avoid duplicate clutter on
      // repeated imports — overwrite its variables.
      const existing = db
        .prepare('SELECT id FROM environments WHERE project_id = ? AND name = ?')
        .get(projectId, rawName) as { id: string } | undefined
      let envId: string
      if (existing) {
        envId = existing.id
        db.prepare('DELETE FROM environment_variables WHERE environment_id = ?').run(envId)
      } else {
        envId = randomUUID()
        const hasActive = db
          .prepare('SELECT 1 AS x FROM environments WHERE project_id = ? AND is_active = 1')
          .get(projectId) as { x: number } | undefined
        db.prepare(
          `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(envId, projectRow.workspace_id, projectId, rawName, hasActive ? 0 : 1, now, now)
      }
      const insertVar = db.prepare(
        `INSERT INTO environment_variables (id, environment_id, key, value, description, enabled, secret, initial_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const data = r.data
      let varCount = 0
      const pushKv = (k: string, v: string): void => {
        insertVar.run(randomUUID(), envId, k, v, null, 1, 0, v)
        varCount++
      }
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry && typeof entry === 'object' && (entry as { name?: string }).name) {
            const e = entry as { name: string; value?: string }
            pushKv(e.name, e.value ?? '')
            suggestedEnvVars[e.name] = e.value ?? ''
          }
        }
      } else if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === 'string') {
            pushKv(k, v)
            suggestedEnvVars[k] = v
          } else if (v != null) {
            const s = JSON.stringify(v)
            pushKv(k, s)
            suggestedEnvVars[k] = s
          }
        }
      }
      if (varCount === 0) {
        warnings.push(`Insomnia v4 environment "${rawName}" had no variables.`)
      }
      environmentCount++
      last = { id: envId, name: rawName }
    }
    return last
  })()

  if (endpointCount === 0 && folderCount === 0 && environmentCount === 0) {
    warnings.push('No request or environment resources found in Insomnia export')
  }

  return {
    success: true,
    collectionId: projectId,
    endpointCount,
    folderCount,
    endpointIds,
    environmentId: lastEnv?.id,
    environmentName: lastEnv?.name,
    suggestedEnvVars: Object.keys(suggestedEnvVars).length > 0 ? suggestedEnvVars : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

function importInsomniaV5(
  projectId: string,
  doc: InsomniaV5Doc,
  rootFolderId: string | null,
  warnings: string[],
): ImportResult {
  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0
  const endpointIds: string[] = []
  const suggestedEnvVars: Record<string, string> = {}

  function walk(
    items: InsomniaV5Item[],
    parentFolderId: string | null,
    inheritedAuth: InsomniaAuth | undefined,
  ): void {
    for (const item of sortByInsomniaSortKey(items)) {
      const isFolder = Array.isArray(item.children)
      if (isFolder) {
        const folderId = randomUUID()
        // Persist folder-level auth + pre/post scripts so the suite importer can
        // carry them into test_suite_folders and they cascade at run time (the
        // collection's "00 Collection Setup"-style preRequest is folder-scoped).
        // We KEEP the down-cascade into child requests below (childAuth) too, so
        // existing per-request 401 fixes don't regress — belt and suspenders.
        const folderAuthUi = mapInsomniaAuthToUi(item.authentication)
        const folderPre = item.scripts?.preRequest
          ? normalizeInsomniaScript(item.scripts.preRequest)
          : null
        const folderPost = item.scripts?.afterResponse
          ? normalizeInsomniaScript(item.scripts.afterResponse)
          : null
        db.prepare(
          `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth, pre_script, post_script)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          folderId,
          projectId,
          parentFolderId,
          item.name ?? 'Folder',
          folderCount,
          folderAuthUi ? JSON.stringify(folderAuthUi) : null,
          folderPre,
          folderPost,
        )
        folderCount++
        // A folder may carry its own auth that overrides the inherited one for
        // its whole subtree (including an explicit "No Auth" → {type:'none'}).
        // Absent a block, inheritance flows straight through.
        const childAuth = item.authentication !== undefined ? item.authentication : inheritedAuth
        walk(item.children ?? [], folderId, childAuth)
        continue
      }

      const method = (item.method ?? 'GET').toUpperCase()
      const url = item.url ?? ''
      const path = extractPath(url)

      const params = (item.parameters ?? []).map((p) => ({
        id: genKvId(),
        key: p.name,
        value: p.value,
        enabled: !p.disabled,
      }))
      const headers = (item.headers ?? []).map((h) => ({
        id: genKvId(),
        key: h.name,
        value: h.value,
        enabled: !h.disabled,
      }))
      const body = mapInsomniaBodyToUi(item.body)
      // A request with no `authentication` block inherits the nearest ancestor's
      // (folder → collection root). Insomnia exports the common "Bearer
      // {{accessToken}}" once at the collection root and leaves child requests
      // bare; without inheriting it the imported requests sent no Authorization
      // and the server replied 401 "Empty Key" even though the token variable
      // was populated. An explicit `{type:'none'}` still maps to null (override).
      const effectiveAuth = item.authentication !== undefined ? item.authentication : inheritedAuth
      const auth = mapInsomniaAuthToUi(effectiveAuth)

      const requestSchema: Record<string, unknown> = {
        url: insomniaUrlWithParams(url, params),
        method,
        params,
        headers,
        body,
      }
      if (auth) requestSchema.auth = auth

      // Insomnia v5 scripts → pm-compatible scripts
      const preScript = item.scripts?.preRequest
        ? normalizeInsomniaScript(item.scripts.preRequest)
        : undefined
      const postScript = item.scripts?.afterResponse
        ? normalizeInsomniaScript(item.scripts.afterResponse)
        : undefined
      if (preScript) requestSchema.preScript = preScript
      if (postScript) requestSchema.postScript = postScript

      const endpointId = randomUUID()
      db.prepare(
        `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        endpointId,
        projectId,
        parentFolderId,
        item.name || `${method} ${path}`,
        item.description ?? null,
        'http',
        method,
        path || '/',
        'developing',
        JSON.stringify(requestSchema),
        null,
        endpointCount,
        now,
        now,
      )
      endpointIds.push(endpointId)
      endpointCount++
    }
  }

  walk(doc.collection ?? [], rootFolderId, doc.authentication)

  // Create a REAL environment from the bundled `environments.data` block so the
  // imported collection's {{vars}} have something to resolve against. The v5
  // collection path used to drop these into `suggestedEnvVars` (a UI hint only,
  // never persisted), so imported requests had no active environment — issue
  // #11. The standalone v5-environment importer already does this DB insert.
  if (doc.environments?.data && Object.keys(doc.environments.data).length > 0) {
    const data = doc.environments.data
    const envName =
      doc.environments.name ||
      (doc.name ? `${doc.name} Environment` : 'Imported Insomnia Environment')
    const existing = db
      .prepare('SELECT id FROM environments WHERE project_id = ? AND name = ?')
      .get(projectId, envName) as { id: string } | undefined
    let envId: string | undefined
    if (existing) {
      envId = existing.id
      db.prepare('DELETE FROM environment_variables WHERE environment_id = ?').run(envId)
    } else {
      const projectRow = db
        .prepare('SELECT workspace_id FROM projects WHERE id = ?')
        .get(projectId) as { workspace_id: string } | undefined
      if (projectRow) {
        envId = randomUUID()
        const hasActive = db
          .prepare('SELECT 1 AS x FROM environments WHERE project_id = ? AND is_active = 1')
          .get(projectId) as { x: number } | undefined
        db.prepare(
          `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(envId, projectRow.workspace_id, projectId, envName, hasActive ? 0 : 1, now, now)
        // When another environment is already active we deliberately don't steal
        // the user's selection — but then the imported {{vars}} (AccessURL, token,
        // …) won't resolve at run time until they switch. Surface that (B-10).
        if (hasActive) {
          warnings.push(
            `Imported environment "${envName}" was added but not activated (another environment is currently active). ` +
              `Select it in the footer environment switcher so {{variables}} resolve when you run the suite.`,
          )
        }
      }
    }
    if (envId) {
      const insertVar = db.prepare(
        `INSERT INTO environment_variables (id, environment_id, key, value, description, enabled, secret, initial_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const [k, v] of Object.entries(data)) {
        if (!k) continue
        const stringValue = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v)
        insertVar.run(randomUUID(), envId, k, stringValue, null, 1, 0, stringValue)
        suggestedEnvVars[k] = stringValue // keep the UI hint too
      }
    }
  }

  if (endpointCount === 0 && folderCount === 0) {
    warnings.push('No requests or folders found in Insomnia v5 export')
  }

  return {
    success: true,
    collectionId: projectId,
    endpointCount,
    folderCount,
    endpointIds,
    suggestedEnvVars: Object.keys(suggestedEnvVars).length > 0 ? suggestedEnvVars : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

/** Map Insomnia body onto the renderer's RequestBody shape. */
export function mapInsomniaBodyToUi(body: InsomniaBody | undefined): {
  type: string
  content?: string
  formData?: Array<{
    id: string
    key: string
    value: string
    enabled: boolean
    type?: 'text' | 'file'
    filePath?: string
  }>
  urlEncoded?: Array<{ id: string; key: string; value: string; enabled: boolean }>
} {
  if (!body) return { type: 'none' }
  const mime = body.mimeType ?? ''

  switch (mime) {
    case 'application/json':
      return { type: 'json', content: body.text ?? '' }
    case 'application/xml':
    case 'text/xml':
      return { type: 'xml', content: body.text ?? '' }
    case 'text/html':
      return { type: 'html', content: body.text ?? '' }
    case 'application/javascript':
      return { type: 'javascript', content: body.text ?? '' }
    case 'text/plain':
    case '':
      return body.text ? { type: 'text', content: body.text } : { type: 'none' }
    case 'multipart/form-data':
      return {
        type: 'form-data',
        formData: (body.params ?? []).map((p) => {
          const isFile = (p.type ?? '').toLowerCase() === 'file'
          if (isFile) {
            const fp = p.fileName ?? ''
            const fname = fp ? (fp.split(/[\\/]/).pop() ?? fp) : ''
            return {
              id: genKvId(),
              key: p.name,
              value: fname,
              enabled: !(p as { disabled?: boolean }).disabled,
              type: 'file' as const,
              filePath: fp || undefined,
            }
          }
          return {
            id: genKvId(),
            key: p.name,
            value: p.value ?? p.fileName ?? '',
            enabled: !(p as { disabled?: boolean }).disabled,
            type: 'text' as const,
          }
        }),
      }
    case 'application/x-www-form-urlencoded':
      return {
        type: 'urlencoded',
        urlEncoded: (body.params ?? []).map((p) => ({
          id: genKvId(),
          key: p.name,
          value: p.value ?? '',
          enabled: !(p as { disabled?: boolean }).disabled,
        })),
      }
    default:
      // Unknown mime — preserve raw text under that media type as best-effort.
      return body.text ? { type: 'text', content: body.text } : { type: 'none' }
  }
}

// ─── Insomnia Export ────────────────────────────────────────

function bodyToInsomnia(body: UiRequestSchema['body']): InsomniaBody | undefined {
  if (!body || !body.type || body.type === 'none') return undefined
  // Insomnia represents GraphQL with `mimeType: 'application/graphql'` (or the
  // newer `'graphql/json'`) and a `text` field carrying `{"query","variables"}`.
  // Detect imported-from-Postman GraphQL bodies the same way we do for the
  // Postman exporter so round-tripping doesn't lose the editor mode.
  if (body.type === 'json' && body.content) {
    try {
      const parsed = JSON.parse(body.content) as { query?: unknown; variables?: unknown }
      if (typeof parsed?.query === 'string') {
        return {
          mimeType: 'application/graphql',
          text: JSON.stringify({
            query: parsed.query,
            variables: parsed.variables ?? {},
          }),
        }
      }
    } catch {
      // Not valid JSON — fall through to raw json export.
    }
  }
  switch (body.type) {
    case 'json':
      return { mimeType: 'application/json', text: body.content ?? '' }
    case 'xml':
      return { mimeType: 'application/xml', text: body.content ?? '' }
    case 'html':
      return { mimeType: 'text/html', text: body.content ?? '' }
    case 'javascript':
      return { mimeType: 'application/javascript', text: body.content ?? '' }
    case 'text':
      return { mimeType: 'text/plain', text: body.content ?? '' }
    case 'form-data':
      return {
        mimeType: 'multipart/form-data',
        params: (body.formData ?? []).map((kv) => {
          const isFile = kv.type === 'file'
          if (isFile) {
            return {
              name: kv.key,
              value: '',
              type: 'file' as const,
              fileName: kv.filePath ?? kv.value ?? '',
              ...(kv.enabled === false ? { disabled: true } : {}),
            }
          }
          return {
            name: kv.key,
            value: kv.value,
            ...(kv.enabled === false ? { disabled: true } : {}),
          }
        }),
      }
    case 'urlencoded':
      return {
        mimeType: 'application/x-www-form-urlencoded',
        params: (body.urlEncoded ?? []).map((kv) => ({
          name: kv.key,
          value: kv.value,
          ...(kv.enabled === false ? { disabled: true } : {}),
        })),
      }
    default:
      return undefined
  }
}

function authToInsomnia(auth: UiRequestSchema['auth']): InsomniaAuth | undefined {
  if (!auth || !auth.type || auth.type === 'none') return undefined
  const t = auth.type as string
  switch (t) {
    case 'basic': {
      const a = (auth.basic ?? {}) as { username?: string; password?: string }
      return { type: 'basic', username: a.username ?? '', password: a.password ?? '' }
    }
    case 'bearer': {
      const a = (auth.bearer ?? {}) as { token?: string; prefix?: string }
      return { type: 'bearer', token: a.token ?? '', prefix: a.prefix ?? 'Bearer' }
    }
    case 'api-key': {
      const a = (auth.apiKey ?? {}) as { key?: string; value?: string; in?: string }
      return {
        type: 'apikey',
        key: a.key ?? '',
        value: a.value ?? '',
        addTo: a.in === 'query' ? 'queryParams' : 'header',
      }
    }
    case 'digest': {
      const a = (auth.digest ?? {}) as { username?: string; password?: string }
      return { type: 'digest', username: a.username ?? '', password: a.password ?? '' }
    }
    case 'ntlm': {
      const a = (auth.ntlm ?? {}) as { username?: string; password?: string }
      return { type: 'ntlm', username: a.username ?? '', password: a.password ?? '' }
    }
    case 'oauth2': {
      const a = (auth.oauth2 ?? {}) as { token?: string }
      return { type: 'oauth2', token: a.token ?? '' }
    }
    default:
      return undefined
  }
}

/** Build Insomnia v4 resources from folder + endpoint rows (shared by project & suite export). */
function buildInsomniaResources(
  workspaceId: string,
  name: string,
  description: string | null,
  folders: ExportFolderRow[],
  endpoints: ExportEndpointRow[],
): InsomniaResource[] {
  const resources: InsomniaResource[] = []

  // Workspace root resource
  resources.push({
    _id: workspaceId,
    _type: 'workspace',
    name,
    description: description ?? undefined,
  })

  for (const folder of folders) {
    resources.push({
      _id: `fld_${folder.id}`,
      _type: 'request_group',
      parentId: folder.parent_id ? `fld_${folder.parent_id}` : workspaceId,
      name: folder.name,
    })
  }

  for (const ep of endpoints) {
    let schema: UiRequestSchema = {}
    if (ep.request_schema) {
      try {
        schema = JSON.parse(ep.request_schema) as UiRequestSchema
      } catch {
        schema = {}
      }
    }
    const url = schema.url ?? ep.path
    const method = (ep.method ?? 'GET').toUpperCase()
    const parentId = ep.folder_id ? `fld_${ep.folder_id}` : workspaceId

    const headers = (schema.headers ?? []).map((h) => ({
      name: h.key,
      value: h.value,
      ...(h.enabled === false ? { disabled: true } : {}),
    }))
    const parameters = (schema.params ?? []).map((p) => ({
      name: p.key,
      value: p.value,
      ...(p.enabled === false ? { disabled: true } : {}),
    }))

    const body = bodyToInsomnia(schema.body)
    const authentication = authToInsomnia(schema.auth)

    const resource: InsomniaResource = {
      _id: `req_${ep.id}`,
      _type: 'request',
      parentId,
      name: ep.name,
      method,
      url,
      description: ep.description ?? undefined,
      headers,
      parameters,
    }
    if (body) resource.body = body
    if (authentication) resource.authentication = authentication

    resources.push(resource)
  }

  return resources
}

function wrapInsomniaExport(resources: InsomniaResource[]): InsomniaExport {
  return {
    __export_format: 4,
    __export_date: new Date().toISOString(),
    __export_source: 'testnizer',
    _type: 'export',
    resources,
  }
}

export function exportAsInsomnia(projectId: string): string {
  const db = getDb()

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | { id: string; name: string; description: string | null }
    | undefined
  if (!project) throw new Error('Project not found')

  const folders = db
    .prepare('SELECT id, parent_id, name FROM folders WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as ExportFolderRow[]
  const endpoints = db
    .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as ExportEndpointRow[]

  const resources = buildInsomniaResources(
    `wrk_${project.id}`,
    project.name,
    project.description ?? null,
    folders,
    endpoints,
  )
  return JSON.stringify(wrapInsomniaExport(resources), null, 2)
}

/**
 * Export a test suite as an Insomnia v4 export document. Suite items carry their
 * full request snapshot inline, so each becomes a `request` resource under the
 * folder tree rebuilt from `test_suite_folders`.
 */
export function exportSuiteAsInsomnia(suiteId: string): string {
  const db = getDb()

  const suite = db.prepare('SELECT * FROM test_suites WHERE id = ?').get(suiteId) as
    | { id: string; name: string; description: string | null }
    | undefined
  if (!suite) throw new Error('Test suite not found')

  const folders = db
    .prepare(
      'SELECT id, parent_id, name FROM test_suite_folders WHERE suite_id = ? ORDER BY sort_order ASC',
    )
    .all(suiteId) as ExportFolderRow[]
  const items = db
    .prepare('SELECT * FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order ASC')
    .all(suiteId) as Array<{
    id: string
    folder_id: string | null
    method: string | null
    url: string | null
    name: string
    request_schema: string | null
  }>
  const endpoints: ExportEndpointRow[] = items.map((it) => ({
    id: it.id,
    folder_id: it.folder_id,
    method: it.method,
    path: it.url ?? '',
    name: it.name,
    description: null,
    request_schema: it.request_schema,
  }))

  const resources = buildInsomniaResources(
    `wrk_${suite.id}`,
    suite.name,
    suite.description ?? null,
    folders,
    endpoints,
  )
  return JSON.stringify(wrapInsomniaExport(resources), null, 2)
}

/** Map Insomnia authentication onto the renderer's AuthConfig shape. */
export function mapInsomniaAuthToUi(
  auth: InsomniaAuth | undefined,
): Record<string, unknown> | null {
  if (!auth || !auth.type || auth.type === 'none' || auth.disabled) return null
  switch (auth.type) {
    case 'basic':
      return {
        type: 'basic',
        basic: { username: auth.username ?? '', password: auth.password ?? '' },
      }
    case 'bearer':
      // Insomnia exports bearer auth with `prefix: ""` by default and itself
      // treats an empty prefix as "Bearer" (`prefix || 'Bearer'`). Use `||`,
      // not `??`, so the imported request stores "Bearer" rather than a blank
      // prefix that shows empty in the auth editor.
      return {
        type: 'bearer',
        bearer: { token: auth.token ?? '', prefix: auth.prefix || 'Bearer' },
      }
    case 'apikey':
      return {
        type: 'api-key',
        apiKey: {
          key: auth.key ?? '',
          value: auth.value ?? '',
          in: auth.addTo === 'queryParams' || auth.addTo === 'query' ? 'query' : 'header',
        },
      }
    case 'digest':
      return {
        type: 'digest',
        digest: { username: auth.username ?? '', password: auth.password ?? '' },
      }
    case 'ntlm':
      return {
        type: 'ntlm',
        ntlm: { username: auth.username ?? '', password: auth.password ?? '' },
      }
    case 'oauth2':
      return {
        type: 'oauth2',
        oauth2: {
          grantType: 'client_credentials',
          tokenUrl: '',
          clientId: '',
          token: auth.token ?? '',
        },
      }
    default:
      return null
  }
}

// ─── gRPC / Proto Import ────────────────────────────────────

export async function importProto(payload: {
  projectId: string
  protoPath: string
  folderId?: string | null
  serverAddress?: string
}): Promise<ImportResult> {
  const warnings: string[] = []
  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0

  let parsed: GrpcServiceDescription
  try {
    parsed = await loadProto(payload.protoPath)
  } catch (e) {
    return { success: false, error: 'Failed to parse proto file: ' + (e as Error).message }
  }

  if (!parsed.services || parsed.services.length === 0) {
    return { success: false, error: 'Proto file contains no gRPC services' }
  }

  const rootFolderId = payload.folderId ?? null
  const serverAddress = payload.serverAddress ?? 'localhost:50051'

  for (const service of parsed.services) {
    // One folder per service so the tree mirrors `package.Service`.
    const serviceFolderId = randomUUID()
    db.prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`,
    ).run(serviceFolderId, payload.projectId, rootFolderId, service.name, folderCount)
    folderCount++

    for (const method of service.methods) {
      const endpointId = randomUUID()

      const streamingType =
        method.requestStream && method.responseStream
          ? 'bidi'
          : method.requestStream
            ? 'client-stream'
            : method.responseStream
              ? 'server-stream'
              : 'unary'

      const skeletonContent = method.requestSkeleton ?? '{}'
      const requestSchema = JSON.stringify({
        method: 'POST',
        url: serverAddress,
        body: { type: 'json', content: skeletonContent },
        headers: [],
        params: [],
        auth: { type: 'none' },
        grpc: {
          protoPath: payload.protoPath,
          packageName: parsed.packageName,
          serviceName: service.fullName || service.name,
          methodName: method.name,
          requestType: method.requestType,
          responseType: method.responseType,
          requestStream: method.requestStream,
          responseStream: method.responseStream,
          streamingType,
          serverAddress,
        },
      })

      db.prepare(
        `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        endpointId,
        payload.projectId,
        serviceFolderId,
        method.name,
        `gRPC ${streamingType} method: ${service.fullName || service.name}.${method.name} (${method.requestType} → ${method.responseType})`,
        'grpc',
        'POST',
        `${service.fullName || service.name}/${method.name}`,
        'developing',
        requestSchema,
        null,
        endpointCount,
        now,
        now,
      )
      endpointCount++
    }
  }

  if (endpointCount === 0) {
    warnings.push('No gRPC methods found in proto file')
  }

  return {
    success: true,
    collectionId: payload.projectId,
    endpointCount,
    folderCount,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

// ─── WSDL Import (Postman-like flow) ───────────────────────
// Kullanıcı WSDL URL verir → uygulama parse eder → klasör seçimi sorar → tüm operasyonları endpoint olarak oluşturur

async function importWsdl(payload: {
  projectId: string
  targetFolderId?: string | null
  createNewFolder?: boolean
  newFolderName?: string
  wsdlUrl?: string
  wsdlContent?: string
  parsedWsdl?: WsdlParseResult
}): Promise<ImportResult> {
  const warnings: string[] = []
  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0

  // Step 1: Get parsed WSDL (either pre-parsed or parse now)
  let parsed: WsdlParseResult
  if (payload.parsedWsdl) {
    parsed = payload.parsedWsdl
  } else if (payload.wsdlUrl) {
    parsed = await parseWsdl(payload.wsdlUrl)
  } else if (payload.wsdlContent) {
    parsed = await parseWsdlFromContent(payload.wsdlContent)
  } else {
    return { success: false, error: 'No WSDL URL or content provided' }
  }

  if (!parsed.services || parsed.services.length === 0) {
    return { success: false, error: 'No services found in WSDL' }
  }

  // Step 2: Determine target folder
  let rootFolderId: string | null = payload.targetFolderId ?? null

  if (payload.createNewFolder) {
    rootFolderId = randomUUID()
    const folderName = payload.newFolderName || parsed.services[0]?.name || 'WSDL Import'
    db.prepare(
      `
      INSERT INTO folders (id, project_id, parent_id, name, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(rootFolderId, payload.projectId, payload.targetFolderId ?? null, folderName, 0)
    folderCount++
  }

  // Step 3: Create folder hierarchy and endpoints for each service/port/operation
  // Matches Postman/Apidog: Service folder > Port folders > Operations
  // When user created a new folder AND there's only 1 service, use the new folder as the
  // service container (avoids double-nesting like Calculator > Calculator > CalculatorSoap)
  const skipServiceFolder = payload.createNewFolder && parsed.services.length === 1

  for (const service of parsed.services) {
    let serviceFolderId: string

    if (skipServiceFolder) {
      // The user-created folder IS the service folder
      serviceFolderId = rootFolderId!
    } else {
      // Create a service-level folder (matches Postman/Apidog behavior)
      serviceFolderId = randomUUID()
      db.prepare(
        `
        INSERT INTO folders (id, project_id, parent_id, name, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(serviceFolderId, payload.projectId, rootFolderId, service.name, folderCount)
      folderCount++
    }

    for (const port of service.ports) {
      // Always create port-level folders under the service folder
      const portFolderId = randomUUID()
      db.prepare(
        `
        INSERT INTO folders (id, project_id, parent_id, name, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(portFolderId, payload.projectId, serviceFolderId, port.name, folderCount)
      folderCount++
      const parentForEndpoints = portFolderId

      for (const operation of port.operations) {
        const endpointId = randomUUID()
        const endpointUrl = port.endpointUrl || parsed.endpointUrl

        const requestSchema = JSON.stringify({
          method: 'POST',
          url: endpointUrl,
          headers: [
            {
              id: randomUUID(),
              key: 'Content-Type',
              value:
                parsed.soapVersion === 'soap12'
                  ? 'application/soap+xml; charset=utf-8'
                  : 'text/xml; charset=utf-8',
              enabled: true,
            },
            { id: randomUUID(), key: 'SOAPAction', value: operation.soapAction, enabled: true },
          ],
          body: { type: 'xml', content: operation.exampleRequest },
          soap: {
            wsdlUrl: payload.wsdlUrl || '',
            serviceName: service.name,
            portName: port.name,
            operationName: operation.name,
            soapAction: operation.soapAction,
            soapVersion: parsed.soapVersion,
            endpointUrl,
            inputSchema: operation.inputSchema,
            outputSchema: operation.outputSchema,
            exampleRequest: operation.exampleRequest,
            exampleResponse: operation.exampleResponse,
          },
        })

        const responseSchemas = JSON.stringify({
          '200': {
            description: 'SOAP Response',
            content: { 'text/xml': { example: operation.exampleResponse } },
          },
        })

        db.prepare(
          `
          INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          endpointId,
          payload.projectId,
          parentForEndpoints,
          operation.name,
          `SOAP operation: ${operation.name} (${service.name}/${port.name})`,
          'soap',
          'POST',
          endpointUrl,
          'developing',
          requestSchema,
          responseSchemas,
          endpointCount,
          now,
          now,
        )
        endpointCount++
      }
    }
  }

  if (endpointCount === 0) {
    warnings.push('No operations found in WSDL')
  }

  return {
    success: true,
    collectionId: payload.projectId,
    endpointCount,
    folderCount,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

// ─── SoapUI / ReadyAPI Project Import ──────────────────────
// Parses a SoapUI project XML export: each <con:call> under <con:operation> under
// <con:interface> becomes one SOAP endpoint (POST text/xml). Each interface becomes
// a sub-folder under the user's chosen target folder (or under the root).

export interface SoapUiCall {
  /** Name of the request/call as authored in SoapUI (e.g. "Request 1") */
  name: string
  /** Endpoint URL the SoapUI request was pointed at (may be empty if absent) */
  endpointUrl: string
  /** SOAP envelope body (raw XML string from <con:request>) */
  rawXml: string
  /** SOAPAction header value inherited from the operation (may be empty) */
  soapAction: string
}

export interface SoapUiOperation {
  name: string
  /** SOAPAction declared at the operation level */
  soapAction: string
  calls: SoapUiCall[]
}

export interface SoapUiInterface {
  name: string
  /** WSDL definition URL/path if the interface declared one */
  definition: string
  operations: SoapUiOperation[]
  /**
   * REST methods (when the interface is `con:RestService`). SOAP interfaces
   * leave this empty; REST interfaces leave `operations` empty. Splitting the
   * two surfaces lets `importSoapUi` create the right endpoint shape (SOAP vs
   * vanilla HTTP) without re-detecting the interface type.
   */
  restMethods: SoapUiRestMethod[]
  /** Base path captured at the interface level (RestService → con:endpoints) */
  baseUrl: string
}

export interface SoapUiRestMethod {
  /** Operation-level name (resource + method label) */
  name: string
  /** HTTP verb */
  method: string
  /** Concrete path (resource path joined to base url where possible) */
  url: string
  /** Headers extracted from the request node (Authorization, Content-Type…) */
  headers: Array<{ key: string; value: string }>
  /** Optional request body (when SoapUI stored an inline body) */
  body?: string
  /** Optional query parameters defined at the operation level */
  params: Array<{ key: string; value: string }>
}

export interface SoapUiParseResult {
  projectName: string
  interfaces: SoapUiInterface[]
}

/**
 * Pull a string attribute from a fast-xml-parser node, tolerating multiple
 * candidate names (e.g. SoapUI uses both `action` and `soapAction` across
 * project versions). fast-xml-parser emits attributes with the `@_` prefix
 * when `attributeNamePrefix` is left at its default.
 */
function readSoapUiAttr(node: unknown, ...names: string[]): string {
  if (!node || typeof node !== 'object') return ''
  const obj = node as Record<string, unknown>
  for (const n of names) {
    const direct = obj[`@_${n}`]
    if (typeof direct === 'string') return direct
    if (typeof direct === 'number') return String(direct)
  }
  return ''
}

/**
 * Coerce a possibly-single-or-array fast-xml-parser child into a flat array.
 * fast-xml-parser collapses single-element arrays to scalars by default; we
 * always want list semantics for repeated SoapUI children.
 */
function asSoapUiArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Extract a string body from a fast-xml-parser node that may be a string scalar
 * or an object with a `#text` property. Returns '' for missing values.
 */
function readSoapUiText(node: unknown): string {
  if (node === undefined || node === null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    const text = obj['#text']
    if (typeof text === 'string') return text
    if (typeof text === 'number') return String(text)
  }
  return ''
}

/**
 * Parse a SoapUI / ReadyAPI project XML string into our internal shape.
 *
 * SoapUI project files use `con:` namespace prefixes throughout. We keep the
 * prefixes (`removeNSPrefix: false`) so we don't accidentally collide with
 * unrelated tags inside CDATA-encoded SOAP envelopes.
 *
 * Multiple <con:request> children inside a single <con:call> are *all*
 * preserved — they typically represent SoapUI's "test request" variants. We
 * surface each as a separate endpoint so users see every variant rather than
 * silently dropping all but the first. Variant names are disambiguated with
 * " - request N" so the endpoint list stays readable.
 */
export function parseSoapUiProject(content: string): SoapUiParseResult {
  // Use a fresh fast-xml-parser per call; cheap and avoids shared state.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { XMLParser } = require('fast-xml-parser') as typeof import('fast-xml-parser')

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    cdataPropName: '#cdata',
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
    removeNSPrefix: false,
  })

  const doc = parser.parse(content) as Record<string, unknown>
  const project =
    (doc['con:soapui-project'] as Record<string, unknown> | undefined) ??
    (doc['soapui-project'] as Record<string, unknown> | undefined)

  if (!project) {
    throw new Error('Not a valid SoapUI project file (missing <con:soapui-project> root)')
  }

  const projectName = readSoapUiAttr(project, 'name') || 'SoapUI Import'
  const rawInterfaces = asSoapUiArray(project['con:interface'] ?? project['interface']) as Record<
    string,
    unknown
  >[]

  const interfaces: SoapUiInterface[] = []
  for (const iface of rawInterfaces) {
    const ifaceName = readSoapUiAttr(iface, 'name') || 'Interface'
    const definition = readSoapUiAttr(iface, 'definition')
    const ifaceType = readSoapUiAttr(iface, 'type', 'xsi:type')

    // REST services live under `con:resource` with `con:method` / `con:request`
    // children. v1.3.1 B20: the parser only walked `con:operation`, so the 6
    // REST methods Dilek imported produced an empty interface folder. We now
    // walk REST resources separately and collect the methods.
    const isRestService =
      /RestService/i.test(ifaceType) ||
      Array.isArray(iface['con:resource']) ||
      iface['con:resource'] !== undefined

    const baseUrl = readSoapUiAttr(iface, 'basePath') || readBaseEndpoint(iface)

    const restMethods: SoapUiRestMethod[] = []
    if (isRestService) {
      collectRestResources(iface, '', baseUrl, restMethods)
    }

    const rawOps = asSoapUiArray(iface['con:operation'] ?? iface['operation']) as Record<
      string,
      unknown
    >[]

    const operations: SoapUiOperation[] = []
    for (const op of rawOps) {
      const opName = readSoapUiAttr(op, 'name') || 'Operation'
      // SoapUI stores the SOAPAction either under `action` (current schema) or
      // `soapAction` (legacy). Tolerate both.
      const soapAction = readSoapUiAttr(op, 'action', 'soapAction')

      const rawCalls = asSoapUiArray(op['con:call'] ?? op['call']) as Record<string, unknown>[]

      const calls: SoapUiCall[] = []
      for (const call of rawCalls) {
        const callName = readSoapUiAttr(call, 'name') || 'Request'
        const endpointUrl = readSoapUiText(call['con:endpoint'] ?? call['endpoint'])

        const requestNodes = asSoapUiArray(call['con:request'] ?? call['request']) as Array<
          Record<string, unknown> | string
        >

        if (requestNodes.length === 0) {
          calls.push({ name: callName, endpointUrl, rawXml: '', soapAction })
          continue
        }

        for (let i = 0; i < requestNodes.length; i++) {
          const node = requestNodes[i]
          let rawXml = ''
          if (typeof node === 'string') {
            rawXml = node
          } else if (node && typeof node === 'object') {
            const obj = node as Record<string, unknown>
            const cdata = obj['#cdata']
            if (typeof cdata === 'string') rawXml = cdata
            else if (Array.isArray(cdata)) rawXml = cdata.join('')
            else rawXml = readSoapUiText(node)
          }

          const variantName = requestNodes.length > 1 ? `${callName} - request ${i + 1}` : callName

          calls.push({
            name: variantName,
            endpointUrl: endpointUrl || '',
            rawXml,
            soapAction,
          })
        }
      }

      operations.push({ name: opName, soapAction, calls })
    }

    interfaces.push({
      name: ifaceName,
      definition,
      operations,
      restMethods,
      baseUrl,
    })
  }

  return { projectName, interfaces }
}

/** Walk a single SoapUI `con:endpoints` block to extract the first URL. */
function readBaseEndpoint(iface: Record<string, unknown>): string {
  const endpoints = iface['con:endpoints'] ?? iface['endpoints']
  if (!endpoints) return ''
  const list = asSoapUiArray(endpoints) as Array<Record<string, unknown> | string>
  for (const item of list) {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object') {
      const inner = (item as Record<string, unknown>)['con:endpoint']
      const text = readSoapUiText(inner ?? item)
      if (text) return text
    }
  }
  return ''
}

/**
 * Recursively walk SoapUI REST resources. Resources can nest (one resource
 * declaring sub-resources via further `con:resource` children) so we
 * concatenate their paths as we descend, matching SoapUI's own URL building.
 */
function collectRestResources(
  parent: Record<string, unknown>,
  parentPath: string,
  baseUrl: string,
  out: SoapUiRestMethod[],
): void {
  const resources = asSoapUiArray(parent['con:resource'] ?? parent['resource']) as Record<
    string,
    unknown
  >[]
  for (const res of resources) {
    const resPath = readSoapUiAttr(res, 'path')
    const resName = readSoapUiAttr(res, 'name')
    const combinedPath = joinUrlPath(parentPath, resPath)

    const methods = asSoapUiArray(res['con:method'] ?? res['method']) as Record<string, unknown>[]
    for (const method of methods) {
      const httpMethod = (readSoapUiAttr(method, 'method', 'httpMethod') || 'GET').toUpperCase()
      const methodName = readSoapUiAttr(method, 'name') || `${httpMethod} ${combinedPath}`

      // SoapUI stores per-method `con:parameter` for query parameters and one
      // or more `con:request` children for the example body / headers.
      const params: Array<{ key: string; value: string }> = []
      const rawParams = asSoapUiArray(method['con:parameter'] ?? method['parameter']) as Record<
        string,
        unknown
      >[]
      for (const p of rawParams) {
        const k = readSoapUiAttr(p, 'name')
        if (!k) continue
        const v = readSoapUiText(p['con:value'] ?? p['value'])
        params.push({ key: k, value: v })
      }

      const reqList = asSoapUiArray(method['con:request'] ?? method['request']) as Array<
        Record<string, unknown> | string
      >
      const headers: Array<{ key: string; value: string }> = []
      let body: string | undefined
      if (reqList.length > 0) {
        const first = reqList[0]
        if (first && typeof first === 'object') {
          const obj = first as Record<string, unknown>
          // Headers are stored as `con:header`/`con:settings.con:setting` rows.
          const rawHeaders = asSoapUiArray(obj['con:header'] ?? obj['header']) as Array<
            Record<string, unknown>
          >
          for (const h of rawHeaders) {
            const k = readSoapUiAttr(h, 'name')
            const v = readSoapUiText(h['con:value'] ?? h['value'])
            if (k) headers.push({ key: k, value: v })
          }
          const inlineBody = obj['con:request'] ?? obj['#cdata'] ?? obj['#text']
          if (typeof inlineBody === 'string') body = inlineBody
          else if (Array.isArray(inlineBody)) body = inlineBody.join('')
        } else if (typeof first === 'string') {
          body = first
        }
      }

      const url = joinUrlPath(baseUrl, combinedPath)
      out.push({
        name: resName ? `${resName} ${methodName}` : methodName,
        method: httpMethod,
        url,
        headers,
        body,
        params,
      })
    }

    // Recurse into sub-resources, threading the current combined path.
    collectRestResources(res, combinedPath, baseUrl, out)
  }
}

function joinUrlPath(left: string, right: string): string {
  if (!left) return right || ''
  if (!right) return left
  if (left.endsWith('/') && right.startsWith('/')) return left + right.slice(1)
  if (left.endsWith('/') || right.startsWith('/')) return left + right
  return `${left}/${right}`
}

async function importSoapUi(payload: {
  projectId: string
  content: string
  folderId?: string | null
}): Promise<ImportResult> {
  const warnings: string[] = []
  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0

  // SoapUI files are XML rooted at `<con:soapui-project ...>` (the
  // `con` prefix maps to https://eviware.com/soapui/config). Reject
  // input that doesn't match this shape with the generic wrong-file
  // message so other XML / JSON / YAML exports don't accidentally
  // pass through (v1.4.6).
  const head = (payload.content || '').trim().slice(0, 4096)
  if (!/<con:soapui-project[\s>]/i.test(head)) {
    return {
      success: false,
      error: "This is not a SoapUI project file. You can't upload this file type from here.",
    }
  }

  let parsed: SoapUiParseResult
  try {
    parsed = parseSoapUiProject(payload.content)
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }

  if (parsed.interfaces.length === 0) {
    return {
      success: true,
      collectionId: payload.projectId,
      endpointCount: 0,
      folderCount: 0,
      warnings: ['No <con:interface> elements found in project'],
    }
  }

  const rootFolderId: string | null = payload.folderId ?? null

  for (const iface of parsed.interfaces) {
    // Each interface gets its own folder so SoapUI services stay grouped.
    const interfaceFolderId = randomUUID()
    db.prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(interfaceFolderId, payload.projectId, rootFolderId, iface.name, folderCount)
    folderCount++

    for (const op of iface.operations) {
      for (const call of op.calls) {
        const endpointId = randomUUID()
        const endpointName = `${op.name} - ${call.name}`

        if (!call.endpointUrl) {
          warnings.push(`Endpoint URL missing for ${iface.name}/${op.name}/${call.name}`)
        }

        const requestSchema = JSON.stringify({
          method: 'POST',
          url: call.endpointUrl,
          headers: [
            {
              id: randomUUID(),
              key: 'Content-Type',
              value: 'text/xml; charset=utf-8',
              enabled: true,
            },
            {
              id: randomUUID(),
              key: 'SOAPAction',
              value: op.soapAction || call.soapAction || '',
              enabled: true,
            },
          ],
          body: { type: 'xml', content: call.rawXml },
          soap: {
            wsdlUrl: iface.definition,
            serviceName: iface.name,
            operationName: op.name,
            soapAction: op.soapAction || call.soapAction || '',
            endpointUrl: call.endpointUrl,
            rawXml: call.rawXml,
            contentType: 'text/xml; charset=utf-8',
          },
        })

        db.prepare(
          `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          endpointId,
          payload.projectId,
          interfaceFolderId,
          endpointName,
          `SoapUI call: ${iface.name}/${op.name}/${call.name}`,
          'soap',
          'POST',
          call.endpointUrl,
          'developing',
          requestSchema,
          null,
          endpointCount,
          now,
          now,
        )
        endpointCount++
      }
    }

    // v1.3.1 B20: REST methods nested inside `con:resource` elements were
    // silently dropped because we only walked `con:operation`. The parser now
    // hands us a flat list of REST methods per interface; insert each as a
    // plain HTTP endpoint with whatever headers/params SoapUI captured.
    for (const restMethod of iface.restMethods) {
      const endpointId = randomUUID()
      if (!restMethod.url) {
        warnings.push(`Endpoint URL missing for REST method ${iface.name}/${restMethod.name}`)
      }
      const requestSchema = JSON.stringify({
        method: restMethod.method,
        url: restMethod.url,
        params: restMethod.params.map((p) => ({
          id: randomUUID(),
          key: p.key,
          value: p.value,
          enabled: true,
        })),
        headers: restMethod.headers.map((h) => ({
          id: randomUUID(),
          key: h.key,
          value: h.value,
          enabled: true,
        })),
        body: restMethod.body ? { type: 'json', content: restMethod.body } : { type: 'none' },
      })
      db.prepare(
        `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        endpointId,
        payload.projectId,
        interfaceFolderId,
        restMethod.name,
        `SoapUI REST: ${iface.name}/${restMethod.name}`,
        'http',
        restMethod.method,
        restMethod.url,
        'developing',
        requestSchema,
        null,
        endpointCount,
        now,
        now,
      )
      endpointCount++
    }
  }

  if (endpointCount === 0) {
    warnings.push('No <con:call> or REST <con:method> entries found in any interface')
  }

  return {
    success: true,
    collectionId: payload.projectId,
    endpointCount,
    folderCount,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

// ─── RAML 1.0 Import ─────────────────────────────────────────
//
// Minimal RAML 1.0 importer. Handles the 80% case:
//   - title / version / baseUri (with {version} substitution)
//   - Nested resources (e.g. /users, /users/{id})
//   - HTTP methods (get/post/put/patch/delete/head/options) with:
//       * displayName / description
//       * queryParameters → params
//       * headers
//       * body (application/json | application/xml | text/plain)
//
// Deferred to a follow-up (NOT supported here):
//   - types / schemas (no $ref expansion)
//   - resourceTypes / traits inheritance
//   - securitySchemes
//   - protocols / mediaType global defaults beyond fallback
//   - !include directives (cross-file resolution)

interface RamlMethodLike {
  displayName?: unknown
  description?: unknown
  queryParameters?: unknown
  headers?: unknown
  body?: unknown
}

export interface ParsedRamlMethod {
  method: string
  displayName: string | null
  description: string | null
  queryParameters: Array<{ name: string; description: string | null; defaultValue: string }>
  headers: Array<{ name: string; description: string | null; defaultValue: string }>
  body: { type: 'none' | 'json' | 'xml' | 'text'; content?: string }
}

export interface ParsedRamlEndpoint {
  fullPath: string
  resourceDisplayName: string | null
  parentSegments: string[]
  method: ParsedRamlMethod
}

export interface ParsedRamlSpec {
  title: string | null
  version: string | null
  baseUri: string | null
  resolvedBaseUri: string | null
  endpoints: ParsedRamlEndpoint[]
}

const RAML_HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRamlString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function extractRamlNamedFields(
  raw: unknown,
): Array<{ name: string; description: string | null; defaultValue: string }> {
  if (!isPlainObject(raw)) return []
  const out: Array<{ name: string; description: string | null; defaultValue: string }> = []
  for (const [name, def] of Object.entries(raw)) {
    if (isPlainObject(def)) {
      const description = asRamlString(def.description)
      const defaultValue = asRamlString(def.default) ?? asRamlString(def.example) ?? ''
      out.push({ name, description, defaultValue })
    } else {
      // Shorthand form e.g. queryParameters: { foo: string }
      out.push({ name, description: null, defaultValue: '' })
    }
  }
  return out
}

function extractRamlBody(raw: unknown): {
  type: 'none' | 'json' | 'xml' | 'text'
  content?: string
} {
  if (!isPlainObject(raw)) return { type: 'none' }

  // Media-type-keyed form: body: { application/json: { ... } }
  if ('application/json' in raw && isPlainObject(raw['application/json'])) {
    const def = raw['application/json'] as Record<string, unknown>
    const example = asRamlString(def.example)
    return { type: 'json', content: example ?? '{}' }
  }
  if ('application/xml' in raw && isPlainObject(raw['application/xml'])) {
    const def = raw['application/xml'] as Record<string, unknown>
    const example = asRamlString(def.example)
    return { type: 'xml', content: example ?? '' }
  }
  if ('text/plain' in raw && isPlainObject(raw['text/plain'])) {
    const def = raw['text/plain'] as Record<string, unknown>
    const example = asRamlString(def.example)
    return { type: 'text', content: example ?? '' }
  }

  // Direct type form: body: { type: object, properties: {...}, example: ... }
  if ('type' in raw || 'properties' in raw || 'example' in raw) {
    const example = asRamlString(raw.example)
    return { type: 'json', content: example ?? '{}' }
  }

  return { type: 'none' }
}

function parseRamlMethod(method: string, raw: unknown): ParsedRamlMethod {
  const obj: RamlMethodLike = isPlainObject(raw) ? (raw as RamlMethodLike) : {}
  return {
    method: method.toUpperCase(),
    displayName: asRamlString(obj.displayName),
    description: asRamlString(obj.description),
    queryParameters: extractRamlNamedFields(obj.queryParameters),
    headers: extractRamlNamedFields(obj.headers),
    body: extractRamlBody(obj.body),
  }
}

function walkRamlResource(
  resourcePath: string,
  resource: Record<string, unknown>,
  parentSegments: string[],
  acc: ParsedRamlEndpoint[],
): void {
  const displayName = asRamlString(resource.displayName)
  const newParents = [...parentSegments, displayName ?? resourcePath]

  for (const method of RAML_HTTP_METHODS) {
    if (method in resource) {
      const parsed = parseRamlMethod(method, resource[method])
      acc.push({
        fullPath: resourcePath,
        resourceDisplayName: displayName,
        parentSegments,
        method: parsed,
      })
    }
  }

  // Recurse into nested resources (any key that starts with '/')
  for (const [key, value] of Object.entries(resource)) {
    if (key.startsWith('/') && isPlainObject(value)) {
      walkRamlResource(resourcePath + key, value, newParents, acc)
    }
  }
}

function resolveRamlBaseUri(baseUri: string | null, version: string | null): string | null {
  if (!baseUri) return null
  if (!version) return baseUri
  return baseUri.replace(/\{version\}/g, version)
}

function stripRamlHeader(content: string): string {
  // Strip the leading `#%RAML 1.0` directive — it's a YAML comment so js-yaml
  // treats it as harmless, but stripping makes the parser inputs deterministic.
  return content.replace(/^#%RAML[^\n]*\n/, '')
}

export function parseRamlSpec(content: string): ParsedRamlSpec {
  const stripped = stripRamlHeader(content)

  /* eslint-disable @typescript-eslint/no-require-imports */
  const yamlMod = require('js-yaml') as {
    load: (s: string, opts?: { schema?: unknown }) => unknown
    Type: new (
      tag: string,
      opts: { kind: 'scalar' | 'mapping' | 'sequence'; construct: (data: unknown) => unknown },
    ) => unknown
    DEFAULT_SCHEMA: { extend: (types: unknown[]) => unknown }
  }
  /* eslint-enable @typescript-eslint/no-require-imports */

  // RAML uses `!include path/to/file.raml` to fan a spec out across multiple
  // files. We don't resolve those includes yet (that would mean an extra
  // I/O pass and security review for arbitrary path traversal), but unknown
  // tags blow up `js-yaml.load` with "unknown tag !<!include>". Registering
  // a no-op constructor lets the parse succeed — the included payload is
  // dropped, but the rest of the spec (resources, endpoints) loads.
  // v1.4.4 §6.1 reported this as a hard import failure.
  const includeType = new yamlMod.Type('!include', {
    kind: 'scalar',
    construct: (data) => (typeof data === 'string' ? data : ''),
  })
  const ramlSchema = yamlMod.DEFAULT_SCHEMA.extend([includeType])

  let parsed: unknown
  try {
    parsed = yamlMod.load(stripped, { schema: ramlSchema })
  } catch (e) {
    throw new Error('Failed to parse RAML as YAML: ' + (e as Error).message)
  }

  if (!isPlainObject(parsed)) {
    throw new Error('RAML root is not an object')
  }

  const title = asRamlString(parsed.title)
  const version = asRamlString(parsed.version)
  const baseUri = asRamlString(parsed.baseUri)
  const resolvedBaseUri = resolveRamlBaseUri(baseUri, version)

  const endpoints: ParsedRamlEndpoint[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (key.startsWith('/') && isPlainObject(value)) {
      walkRamlResource(key, value, [], endpoints)
    }
  }

  return { title, version, baseUri, resolvedBaseUri, endpoints }
}

async function importRaml(
  projectId: string,
  content: string,
  parentFolderId: string | null = null,
): Promise<ImportResult> {
  const warnings: string[] = []
  let spec: ParsedRamlSpec
  try {
    spec = parseRamlSpec(content)
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }

  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0
  const suggestedEnvVars: Record<string, string> = {}

  if (spec.resolvedBaseUri) {
    suggestedEnvVars['baseUrl'] = spec.resolvedBaseUri
  }

  // Group endpoints by their top-level resource segment so we get a tidy folder
  // tree (one folder per top-level resource).
  const topLevelFolderMap: Record<string, string> = {}

  for (const ep of spec.endpoints) {
    const topSegment = '/' + (ep.fullPath.split('/').filter(Boolean)[0] ?? '')

    let folderId: string | null = parentFolderId
    if (topSegment !== '/') {
      if (!topLevelFolderMap[topSegment]) {
        const newFolderId = randomUUID()
        db.prepare(
          `
          INSERT INTO folders (id, project_id, parent_id, name, sort_order)
          VALUES (?, ?, ?, ?, ?)
        `,
        ).run(newFolderId, projectId, parentFolderId, topSegment, folderCount)
        topLevelFolderMap[topSegment] = newFolderId
        folderCount++
      }
      folderId = topLevelFolderMap[topSegment]
    }

    const baseUrl = spec.resolvedBaseUri ?? ''
    const fullUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}${ep.fullPath}` : ep.fullPath

    const params = ep.method.queryParameters.map((p) => ({
      id: randomUUID(),
      key: p.name,
      value: p.defaultValue,
      description: p.description ?? '',
      enabled: true,
    }))
    const headers = ep.method.headers.map((h) => ({
      id: randomUUID(),
      key: h.name,
      value: h.defaultValue,
      description: h.description ?? '',
      enabled: true,
    }))

    const requestSchema = {
      method: ep.method.method,
      url: fullUrl,
      params,
      headers,
      body: ep.method.body,
      auth: { type: 'none' },
    }

    const name =
      ep.method.displayName ?? ep.resourceDisplayName ?? `${ep.method.method} ${ep.fullPath}`

    const endpointId = randomUUID()
    db.prepare(
      `
      INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      endpointId,
      projectId,
      folderId,
      name,
      ep.method.description ?? null,
      'http',
      ep.method.method,
      fullUrl,
      'developing',
      JSON.stringify(requestSchema),
      null,
      endpointCount,
      now,
      now,
    )
    endpointCount++
  }

  if (endpointCount === 0) {
    warnings.push('No endpoints found in the RAML document')
  }

  return {
    success: true,
    collectionId: projectId,
    endpointCount,
    folderCount,
    suggestedEnvVars: Object.keys(suggestedEnvVars).length ? suggestedEnvVars : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}
