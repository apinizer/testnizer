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
      content?: Record<string, { schema?: Record<string, unknown> }>
    }
    responses?: Record<
      string,
      {
        description?: string
        content?: Record<string, { schema?: Record<string, unknown> }>
      }
    >
  }
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
          { name: 'API Specs', extensions: ['json', 'yaml', 'yml', 'wsdl', 'xml', 'proto'] },
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
      },
    ) => {
      try {
        const result = await importHar(payload.projectId, payload.content)
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

        if (operation.parameters) {
          for (const param of operation.parameters) {
            const item = {
              id: randomUUID(),
              key: param.name,
              value: param.schema?.default ?? '',
              description: param.description || '',
              enabled: true,
            }
            if (param.in === 'query') params.push(item)
            else if (param.in === 'header') headers.push(item)
            // path params are embedded in URL
          }
        }

        // Convert request body
        let body: { type: string; content?: string } = { type: 'none' }
        if (operation.requestBody?.content) {
          const contentTypes = Object.keys(operation.requestBody.content)
          if (contentTypes.some((ct) => ct.includes('json'))) {
            const schema = operation.requestBody.content['application/json']?.schema
            body = { type: 'json', content: schema ? JSON.stringify(schema, null, 2) : '{}' }
          } else if (contentTypes.some((ct) => ct.includes('xml'))) {
            body = { type: 'xml', content: '' }
          } else if (contentTypes.some((ct) => ct.includes('form'))) {
            body = { type: 'form-data' }
          }
        }

        // Build request_schema in app's expected format
        const requestSchema = {
          method: method.toUpperCase(),
          url: fullUrl,
          params,
          headers,
          body,
          auth: { type: 'none' },
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
    method: string | null
    path: string
    name: string
    description: string | null
    request_schema: string | null
    response_schemas: string | null
  }>

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

  for (const ep of endpoints) {
    const path = ep.path || '/'
    if (!paths[path]) {
      paths[path] = {}
    }
    const method = (ep.method || 'GET').toLowerCase()
    const operation: Record<string, unknown> = {
      summary: ep.name,
      description: ep.description || undefined,
      responses: ep.response_schemas
        ? JSON.parse(ep.response_schemas)
        : { '200': { description: 'OK' } },
    }

    if (ep.request_schema) {
      const schema = JSON.parse(ep.request_schema) as UiRequestSchema
      const params: Array<Record<string, unknown>> = []

      // Path templating from `{vars}` in URL
      const pathVarRe = /\{([^}]+)\}/g
      let m: RegExpExecArray | null
      while ((m = pathVarRe.exec(path)) !== null) {
        params.push({
          name: m[1],
          in: 'path',
          required: true,
          schema: { type: 'string' },
        })
      }

      // Query params
      for (const p of schema.params ?? []) {
        if (p.enabled === false) continue
        params.push({
          name: p.key,
          in: 'query',
          description: p.description,
          required: false,
          schema: { type: 'string', default: p.value },
        })
      }

      // Headers
      for (const h of schema.headers ?? []) {
        if (h.enabled === false) continue
        // Skip headers OpenAPI doesn't want (Content-Type covered by requestBody)
        if (h.key.toLowerCase() === 'content-type') continue
        params.push({
          name: h.key,
          in: 'header',
          description: h.description,
          required: false,
          schema: { type: 'string', default: h.value },
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
        } else if (exampleObj !== undefined) {
          operation.requestBody = {
            content: { [mediaType]: { example: exampleObj } },
          }
        }
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

// ─── Postman Import ─────────────────────────────────────────

// ─── Postman / Insomnia script helpers ─────────────────────

/**
 * Normalize an Insomnia v5 script string so it runs against the same `pm`
 * shim as Postman scripts. Replaces `insomnia.*` references with their `pm.*`
 * equivalents — the surface is API-compatible for the cases we care about
 * (environment, response, test/expect, iterationData, execution.skipRequest).
 */
export function normalizeInsomniaScript(script: string): string {
  if (!script) return ''
  return script
    .replace(/\binsomnia\.iterationData\b/g, 'pm.iterationData')
    .replace(/\binsomnia\.environment\b/g, 'pm.environment')
    .replace(/\binsomnia\.globals\b/g, 'pm.globals')
    .replace(/\binsomnia\.variables\b/g, 'pm.variables')
    .replace(/\binsomnia\.collectionVariables\b/g, 'pm.collectionVariables')
    .replace(/\binsomnia\.response\b/g, 'pm.response')
    .replace(/\binsomnia\.request\b/g, 'pm.request')
    .replace(/\binsomnia\.test\b/g, 'pm.test')
    .replace(/\binsomnia\.expect\b/g, 'pm.expect')
    .replace(/\binsomnia\.execution\b/g, 'pm.execution')
    .replace(/\binsomnia\.info\b/g, 'pm.info')
    .replace(/\binsomnia\.sendRequest\b/g, 'pm.sendRequest')
    .replace(/\binsomnia\b/g, 'pm')
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
          const fileName = filePath ? filePath.split(/[\\/]/).pop() ?? filePath : ''
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

async function importPostman(
  projectId: string,
  content: string,
  rootFolderId: string | null = null,
): Promise<ImportResult> {
  const warnings: string[] = []
  let collection: PostmanCollection

  try {
    collection = JSON.parse(content) as PostmanCollection
  } catch (e) {
    return {
      success: false,
      error: 'Failed to parse Postman collection JSON: ' + (e as Error).message,
    }
  }

  if (
    !collection.info ||
    typeof collection.info.name !== 'string' ||
    !Array.isArray(collection.item)
  ) {
    return {
      success: false,
      error: 'Not a valid Postman collection (missing `info.name` or `item[]`)',
    }
  }

  // Accept v2.0 and v2.1 schemas (both live under getpostman.com).
  const schema = collection.info.schema ?? ''
  if (schema && !/postman|getpostman/i.test(schema)) {
    warnings.push(`Unknown collection schema "${schema}" — importing best-effort.`)
  }

  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0
  const suggestedEnvVars: Record<string, string> = {}

  if (collection.variable) {
    for (const v of collection.variable) {
      if (v.key) suggestedEnvVars[v.key] = v.value ?? ''
    }
  }

  function processItems(items: PostmanItem[], parentFolderId: string | null): void {
    for (const item of items) {
      const isFolder = Array.isArray(item.item) && !item.request
      if (isFolder) {
        const folderId = randomUUID()
        db.prepare(
          `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`,
        ).run(folderId, projectId, parentFolderId, item.name || 'Folder', folderCount)
        folderCount++
        processItems(item.item ?? [], folderId)
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
      const auth = mapPostmanAuthToUi(req.auth ?? collection.auth)

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
      endpointCount++
    }
  }

  processItems(collection.item, rootFolderId)

  if (endpointCount === 0 && folderCount === 0) {
    warnings.push('No requests or folders found in the Postman collection')
  }

  return {
    success: true,
    collectionId: projectId,
    endpointCount,
    folderCount,
    suggestedEnvVars: Object.keys(suggestedEnvVars).length > 0 ? suggestedEnvVars : undefined,
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

function exportAsPostman(projectId: string): string {
  const db = getDb()

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | { name: string; description: string | null }
    | undefined

  if (!project) throw new Error('Project not found')

  const folders = db
    .prepare('SELECT * FROM folders WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as Array<{ id: string; parent_id: string | null; name: string }>

  const endpoints = db
    .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as Array<{
    id: string
    folder_id: string | null
    method: string | null
    path: string
    name: string
    description: string | null
    request_schema: string | null
  }>

  const folderMap = new Map<string, PostmanItem>()
  const rootItems: PostmanItem[] = []

  for (const folder of folders) {
    folderMap.set(folder.id, { name: folder.name, item: [] })
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

    if (ep.folder_id && folderMap.has(ep.folder_id)) {
      folderMap.get(ep.folder_id)!.item!.push(item)
    } else {
      rootItems.push(item)
    }
  }

  const collection: PostmanCollection = {
    info: {
      name: project.name,
      description: project.description ?? undefined,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: rootItems,
  }

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
    requestSchema.headers = parsed.headers
  }
  if (parsed.body) {
    requestSchema.body = parsed.body
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
          // Multipart form data
          if (!result.headers['Content-Type']) {
            result.headers['Content-Type'] = 'multipart/form-data'
          }
          const formPart = tokens[i]
          const eqIdx = formPart.indexOf('=')
          if (eqIdx > 0) {
            // Collect form data in body as key=value pairs separated by &
            const existing = result.body || ''
            const sep = existing ? '&' : ''
            result.body = existing + sep + formPart
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

  return result
}

export function tokenizeCurl(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    if (escaped) {
      current += ch
      escaped = false
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

// ─── cURL Export ────────────────────────────────────────────

export function exportAsCurl(request: CurlExportRequest): string {
  const parts: string[] = ['curl']

  // Method
  if (request.method && request.method !== 'GET') {
    parts.push(`-X ${request.method.toUpperCase()}`)
  }

  // URL
  parts.push(`'${request.url}'`)

  // Headers
  if (request.headers) {
    for (const h of request.headers) {
      if (h.enabled && h.key) {
        parts.push(`-H '${h.key}: ${h.value}'`)
      }
    }
  }

  // Auth
  if (request.auth) {
    if (request.auth.type === 'basic' && request.auth.basic) {
      parts.push(`-u '${request.auth.basic.username}:${request.auth.basic.password}'`)
    } else if (request.auth.type === 'bearer' && request.auth.bearer) {
      const prefix = request.auth.bearer.prefix || 'Bearer'
      parts.push(`-H 'Authorization: ${prefix} ${request.auth.bearer.token}'`)
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
          const escaped = request.body.content.replace(/'/g, "'\\''")
          parts.push(`-d '${escaped}'`)
        }
        break
      }
      case 'urlencoded': {
        if (request.body.urlEncoded) {
          for (const item of request.body.urlEncoded) {
            if (item.enabled) {
              parts.push(`--data-urlencode '${item.key}=${item.value}'`)
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
              parts.push(`-F '${item.key}=@${item.filePath}'`)
            } else {
              parts.push(`-F '${item.key}=${item.value}'`)
            }
          }
        }
        break
      }
    }
  }

  // Cookies
  if (request.cookies) {
    parts.push(`-b '${request.cookies}'`)
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
    headers: Array<{ name: string; value: string }>
    queryString: Array<{ name: string; value: string }>
    postData?: {
      mimeType?: string
      text?: string
      params?: Array<{ name: string; value: string }>
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

async function importHar(projectId: string, content: string): Promise<ImportResult> {
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
        enabled: true,
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
        headerList.push({ id: genKvId(), key: h.name, value: h.value, enabled: true })
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
              enabled: true,
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
            enabled: true,
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
      null,
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
  environments?: { data?: Record<string, unknown> }
}

interface InsomniaV5Item {
  meta?: { id?: string; name?: string }
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

function isInsomniaV5(doc: unknown): doc is InsomniaV5Doc {
  if (!doc || typeof doc !== 'object') return false
  const d = doc as Record<string, unknown>
  return (
    typeof d.type === 'string' && /collection\.insomnia/.test(d.type) && Array.isArray(d.collection)
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

  if (isInsomniaV5(doc)) {
    return importInsomniaV5(projectId, doc, rootFolderId, warnings)
  }
  return importInsomniaV4(projectId, doc as InsomniaExport, rootFolderId, warnings)
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

  const resources = doc.resources
  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0
  const suggestedEnvVars: Record<string, string> = {}

  const folderMap = new Map<string, string>()

  // First pass: create folders. Insomnia v4 lists resources flat with parentId
  // pointers, and parents may appear after children — so we do this in two
  // passes (first create, then re-parent).
  for (const resource of resources) {
    if (!resource || typeof resource !== 'object') continue
    if (resource._type === 'request_group' && resource._id) {
      const folderId = randomUUID()
      db.prepare(
        `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`,
      ).run(folderId, projectId, rootFolderId, resource.name || 'Folder', folderCount)
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
      url,
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
    endpointCount++
  }

  for (const resource of resources) {
    if (!resource || typeof resource !== 'object') continue
    if (resource._type === 'environment') {
      // Insomnia v4: environment vars live in `data` either as
      // `[{name, value}]` (legacy) or `{key: value}` (current export). We
      // accept both so secret-only and structured envs both round-trip.
      const data = (resource as InsomniaResource & { data?: unknown }).data
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry && typeof entry === 'object' && (entry as { name?: string }).name) {
            const e = entry as { name: string; value?: string }
            suggestedEnvVars[e.name] = e.value ?? ''
          }
        }
      } else if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === 'string') suggestedEnvVars[k] = v
        }
      }
    }
  }

  if (endpointCount === 0 && folderCount === 0) {
    warnings.push('No request resources found in Insomnia export')
  }

  return {
    success: true,
    collectionId: projectId,
    endpointCount,
    folderCount,
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
  const suggestedEnvVars: Record<string, string> = {}

  function walk(items: InsomniaV5Item[], parentFolderId: string | null): void {
    for (const item of items) {
      const isFolder = Array.isArray(item.children)
      if (isFolder) {
        const folderId = randomUUID()
        db.prepare(
          `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`,
        ).run(folderId, projectId, parentFolderId, item.name ?? 'Folder', folderCount)
        folderCount++
        walk(item.children ?? [], folderId)
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
      const auth = mapInsomniaAuthToUi(item.authentication)

      const requestSchema: Record<string, unknown> = {
        url,
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
      endpointCount++
    }
  }

  walk(doc.collection ?? [], rootFolderId)

  if (doc.environments?.data) {
    for (const [k, v] of Object.entries(doc.environments.data)) {
      if (typeof v === 'string') suggestedEnvVars[k] = v
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
            const fname = fp ? fp.split(/[\\/]/).pop() ?? fp : ''
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

export function exportAsInsomnia(projectId: string): string {
  const db = getDb()

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | { id: string; name: string; description: string | null }
    | undefined
  if (!project) throw new Error('Project not found')

  const folders = db
    .prepare('SELECT * FROM folders WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as Array<{ id: string; parent_id: string | null; name: string }>

  const endpoints = db
    .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as Array<{
    id: string
    folder_id: string | null
    method: string | null
    path: string
    name: string
    description: string | null
    request_schema: string | null
  }>

  const workspaceId = `wrk_${project.id}`
  const resources: InsomniaResource[] = []

  // Workspace root resource
  resources.push({
    _id: workspaceId,
    _type: 'workspace',
    name: project.name,
    description: project.description ?? undefined,
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

  const doc: InsomniaExport = {
    __export_format: 4,
    __export_date: new Date().toISOString(),
    __export_source: 'testnizer',
    _type: 'export',
    resources,
  }

  return JSON.stringify(doc, null, 2)
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
      return {
        type: 'bearer',
        bearer: { token: auth.token ?? '', prefix: auth.prefix ?? 'Bearer' },
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

      const requestSchema = JSON.stringify({
        method: 'POST',
        url: serverAddress,
        body: { type: 'json', content: '{}' },
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
          'http',
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
  const rawInterfaces = asSoapUiArray(
    project['con:interface'] ?? project['interface'],
  ) as Record<string, unknown>[]

  const interfaces: SoapUiInterface[] = []
  for (const iface of rawInterfaces) {
    const ifaceName = readSoapUiAttr(iface, 'name') || 'Interface'
    const definition = readSoapUiAttr(iface, 'definition')

    const rawOps = asSoapUiArray(
      iface['con:operation'] ?? iface['operation'],
    ) as Record<string, unknown>[]

    const operations: SoapUiOperation[] = []
    for (const op of rawOps) {
      const opName = readSoapUiAttr(op, 'name') || 'Operation'
      // SoapUI stores the SOAPAction either under `action` (current schema) or
      // `soapAction` (legacy). Tolerate both.
      const soapAction = readSoapUiAttr(op, 'action', 'soapAction')

      const rawCalls = asSoapUiArray(
        op['con:call'] ?? op['call'],
      ) as Record<string, unknown>[]

      const calls: SoapUiCall[] = []
      for (const call of rawCalls) {
        const callName = readSoapUiAttr(call, 'name') || 'Request'
        const endpointUrl = readSoapUiText(call['con:endpoint'] ?? call['endpoint'])

        const requestNodes = asSoapUiArray(
          call['con:request'] ?? call['request'],
        ) as Array<Record<string, unknown> | string>

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

          const variantName =
            requestNodes.length > 1 ? `${callName} - request ${i + 1}` : callName

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

    interfaces.push({ name: ifaceName, definition, operations })
  }

  return { projectName, interfaces }
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
  }

  if (endpointCount === 0) {
    warnings.push('No <con:call> entries found in any interface')
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

function extractRamlBody(
  raw: unknown,
): { type: 'none' | 'json' | 'xml' | 'text'; content?: string } {
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
    FAILSAFE_SCHEMA: unknown
  }
  /* eslint-enable @typescript-eslint/no-require-imports */

  let parsed: unknown
  try {
    // Default schema is fine for the common case; FAILSAFE_SCHEMA would force
    // every scalar to a string which loses booleans/numbers, so we let js-yaml
    // use CORE_SCHEMA but catch and rethrow on unknown tags like `!include`.
    parsed = yamlMod.load(stripped)
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
