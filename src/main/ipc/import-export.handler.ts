import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { getDb } from '../db/database'
import { parseWsdl, parseWsdlFromContent, type WsdlParseResult } from '../protocols/soap.engine'

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
    responses?: Record<string, {
      description?: string
      content?: Record<string, { schema?: Record<string, unknown> }>
    }>
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
  ipcMain.handle('import:openFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'API Specs', extensions: ['json', 'yaml', 'yml', 'wsdl', 'xml', 'proto'] },
          { name: 'All Files', extensions: ['*'] }
        ]
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

  ipcMain.handle('import:openApi', async (_event, payload: {
    projectId: string
    content: string
    format: string
  }) => {
    try {
      const result = await importOpenApi(payload.projectId, payload.content)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

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
          { name: 'All Files', extensions: ['*'] }
        ]
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
  ipcMain.handle('import:postman', async (_event, payload: {
    projectId: string
    content: string
  }) => {
    try {
      const result = await importPostman(payload.projectId, payload.content)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

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
  ipcMain.handle('import:har', async (_event, payload: {
    projectId: string
    content: string
  }) => {
    try {
      const result = await importHar(payload.projectId, payload.content)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Insomnia Import ────────────────────────────────────────
  ipcMain.handle('import:insomnia', async (_event, payload: {
    projectId: string
    content: string
  }) => {
    try {
      const result = await importInsomnia(payload.projectId, payload.content)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── cURL Import ──────────────────────────────────────────
  ipcMain.handle('import:curl', async (_event, payload: {
    projectId: string
    curlCommand: string
  }) => {
    try {
      const result = importCurl(payload.projectId, payload.curlCommand)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

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
  ipcMain.handle('import:wsdl', async (_event, payload: {
    projectId: string
    targetFolderId?: string | null
    createNewFolder?: boolean
    newFolderName?: string
    wsdlUrl?: string
    wsdlContent?: string
    parsedWsdl?: WsdlParseResult
  }) => {
    try {
      const result = await importWsdl(payload)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}

async function importOpenApi(projectId: string, content: string): Promise<ImportResult> {
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
    baseUrl = doc.servers[0].url
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
      db.prepare(`
        INSERT INTO folders (id, project_id, parent_id, name, sort_order)
        VALUES (?, ?, NULL, ?, ?)
      `).run(folderId, projectId, tag.name, folderCount)
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
        let folderId: string | null = null
        if (operation.tags && operation.tags.length > 0) {
          const tagName = operation.tags[0]
          if (tagFolderMap[tagName]) {
            folderId = tagFolderMap[tagName]
          } else {
            // Create folder for this tag
            const newFolderId = randomUUID()
            db.prepare(`
              INSERT INTO folders (id, project_id, parent_id, name, sort_order)
              VALUES (?, ?, NULL, ?, ?)
            `).run(newFolderId, projectId, tagName, folderCount)
            tagFolderMap[tagName] = newFolderId
            folderId = newFolderId
            folderCount++
          }
        }

        // Build request schema from parameters
        const requestSchema: Record<string, unknown> = {}
        if (operation.parameters) {
          requestSchema.parameters = operation.parameters
        }
        if (operation.requestBody) {
          requestSchema.requestBody = operation.requestBody
        }

        // Build response schemas
        const responseSchemas = operation.responses ? JSON.stringify(operation.responses) : null

        db.prepare(`
          INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          endpointId,
          projectId,
          folderId,
          name,
          operation.description ?? null,
          'http',
          method.toUpperCase(),
          path,
          'developing',
          Object.keys(requestSchema).length > 0 ? JSON.stringify(requestSchema) : null,
          responseSchemas,
          endpointCount,
          now,
          now
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
    warnings: warnings.length > 0 ? warnings : undefined
  }
}

function exportProjectAsOpenApi(projectId: string): string {
  const db = getDb()

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as {
    name: string
    description: string | null
  } | undefined

  if (!project) {
    throw new Error('Project not found')
  }

  const endpoints = db.prepare(
    'SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order ASC'
  ).all(projectId) as Array<{
    method: string | null
    path: string
    name: string
    description: string | null
    request_schema: string | null
    response_schemas: string | null
  }>

  const paths: Record<string, Record<string, unknown>> = {}

  for (const ep of endpoints) {
    if (!paths[ep.path]) {
      paths[ep.path] = {}
    }
    const method = (ep.method || 'GET').toLowerCase()
    const operation: Record<string, unknown> = {
      summary: ep.name,
      description: ep.description || undefined,
      responses: ep.response_schemas ? JSON.parse(ep.response_schemas) : { '200': { description: 'OK' } }
    }

    if (ep.request_schema) {
      const schema = JSON.parse(ep.request_schema) as Record<string, unknown>
      if (schema.parameters) {
        operation.parameters = schema.parameters
      }
      if (schema.requestBody) {
        operation.requestBody = schema.requestBody
      }
    }

    paths[ep.path][method] = operation
  }

  const doc = {
    openapi: '3.0.3',
    info: {
      title: project.name,
      description: project.description || '',
      version: '1.0.0'
    },
    paths
  }

  return JSON.stringify(doc, null, 2)
}

// ─── Postman Types ──────────────────────────────────────────

interface PostmanCollection {
  info: {
    name: string
    description?: string
    schema: string
  }
  item: PostmanItem[]
  variable?: PostmanVariable[]
  auth?: PostmanAuth
}

interface PostmanItem {
  name: string
  request?: PostmanRequest
  response?: unknown[]
  item?: PostmanItem[]   // folder (item group)
}

interface PostmanRequest {
  method: string
  header?: PostmanHeader[]
  url: PostmanUrl | string
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
  host?: string[]
  path?: string[]
  query?: PostmanQuery[]
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
  options?: {
    raw?: { language?: string }
  }
}

interface PostmanFormData {
  key: string
  value: string
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

interface PostmanAuth {
  type: string
  basic?: Array<{ key: string; value: string }>
  bearer?: Array<{ key: string; value: string }>
  apikey?: Array<{ key: string; value: string }>
}

interface PostmanVariable {
  key: string
  value: string
}

// ─── Postman Import ─────────────────────────────────────────

async function importPostman(projectId: string, content: string): Promise<ImportResult> {
  const warnings: string[] = []
  let collection: PostmanCollection

  try {
    collection = JSON.parse(content) as PostmanCollection
  } catch {
    return { success: false, error: 'Failed to parse Postman collection JSON' }
  }

  if (!collection.info?.schema?.includes('postman')) {
    return { success: false, error: 'Not a valid Postman v2.1 collection' }
  }

  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0
  const suggestedEnvVars: Record<string, string> = {}

  // Extract collection-level variables
  if (collection.variable) {
    for (const v of collection.variable) {
      if (v.key && v.value) {
        suggestedEnvVars[v.key] = v.value
      }
    }
  }

  function processItems(items: PostmanItem[], parentFolderId: string | null): void {
    for (const item of items) {
      if (item.item && !item.request) {
        // This is a folder
        const folderId = randomUUID()
        db.prepare(`
          INSERT INTO folders (id, project_id, parent_id, name, sort_order)
          VALUES (?, ?, ?, ?, ?)
        `).run(folderId, projectId, parentFolderId, item.name, folderCount)
        folderCount++
        processItems(item.item, folderId)
      } else if (item.request) {
        // This is a request
        const req = item.request
        const method = req.method?.toUpperCase() || 'GET'
        let url = ''
        let path = ''

        if (typeof req.url === 'string') {
          url = req.url
          try {
            path = new URL(url).pathname
          } catch {
            path = url
          }
        } else if (req.url) {
          url = req.url.raw || ''
          path = req.url.path ? '/' + req.url.path.join('/') : ''
        }

        const endpointId = randomUUID()

        // Build request schema
        const requestSchema: Record<string, unknown> = {}

        // Map parameters from URL query
        if (typeof req.url === 'object' && req.url?.query) {
          requestSchema.parameters = req.url.query.map((q) => ({
            name: q.key,
            in: 'query',
            required: false,
            schema: { type: 'string', default: q.value },
            description: q.description
          }))
        }

        // Map body
        if (req.body) {
          requestSchema.requestBody = mapPostmanBody(req.body)
        }

        // Map auth
        const authConfig = req.auth ? mapPostmanAuth(req.auth) : (
          collection.auth ? mapPostmanAuth(collection.auth) : null
        )
        if (authConfig) {
          requestSchema.auth = authConfig
        }

        db.prepare(`
          INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          endpointId,
          projectId,
          parentFolderId,
          item.name,
          req.description ?? null,
          'http',
          method,
          path || url,
          'developing',
          Object.keys(requestSchema).length > 0 ? JSON.stringify(requestSchema) : null,
          null,
          endpointCount,
          now,
          now
        )
        endpointCount++
      }
    }
  }

  processItems(collection.item, null)

  if (endpointCount === 0) {
    warnings.push('No requests found in the Postman collection')
  }

  return {
    success: true,
    collectionId: projectId,
    endpointCount,
    folderCount,
    suggestedEnvVars,
    warnings: warnings.length > 0 ? warnings : undefined
  }
}

function mapPostmanBody(body: PostmanBody): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language || 'text'
      let mediaType = 'text/plain'
      if (lang === 'json') mediaType = 'application/json'
      else if (lang === 'xml') mediaType = 'application/xml'
      else if (lang === 'html') mediaType = 'text/html'
      else if (lang === 'javascript') mediaType = 'application/javascript'

      result.content = {
        [mediaType]: {
          example: body.raw
        }
      }
      break
    }
    case 'formdata': {
      if (body.formdata) {
        const properties: Record<string, unknown> = {}
        for (const fd of body.formdata) {
          properties[fd.key] = {
            type: fd.type === 'file' ? 'string' : 'string',
            format: fd.type === 'file' ? 'binary' : undefined,
            example: fd.value
          }
        }
        result.content = {
          'multipart/form-data': {
            schema: { type: 'object', properties }
          }
        }
      }
      break
    }
    case 'urlencoded': {
      if (body.urlencoded) {
        const properties: Record<string, unknown> = {}
        for (const ue of body.urlencoded) {
          properties[ue.key] = { type: 'string', example: ue.value }
        }
        result.content = {
          'application/x-www-form-urlencoded': {
            schema: { type: 'object', properties }
          }
        }
      }
      break
    }
  }

  return result
}

function mapPostmanAuth(auth: PostmanAuth): Record<string, unknown> {
  const config: Record<string, unknown> = { type: auth.type }

  switch (auth.type) {
    case 'basic': {
      if (auth.basic) {
        const username = auth.basic.find((b) => b.key === 'username')?.value ?? ''
        const password = auth.basic.find((b) => b.key === 'password')?.value ?? ''
        config.basic = { username, password }
      }
      break
    }
    case 'bearer': {
      if (auth.bearer) {
        const token = auth.bearer.find((b) => b.key === 'token')?.value ?? ''
        config.bearer = { token }
      }
      break
    }
    case 'apikey': {
      if (auth.apikey) {
        const key = auth.apikey.find((b) => b.key === 'key')?.value ?? ''
        const value = auth.apikey.find((b) => b.key === 'value')?.value ?? ''
        const inLocation = auth.apikey.find((b) => b.key === 'in')?.value ?? 'header'
        config.type = 'api-key'
        config.apiKey = { key, value, in: inLocation }
      }
      break
    }
  }

  return config
}

// ─── Postman Export ─────────────────────────────────────────

function exportAsPostman(projectId: string): string {
  const db = getDb()

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as {
    name: string
    description: string | null
  } | undefined

  if (!project) {
    throw new Error('Project not found')
  }

  // Get folders
  const folders = db.prepare(
    'SELECT * FROM folders WHERE project_id = ? ORDER BY sort_order ASC'
  ).all(projectId) as Array<{
    id: string
    parent_id: string | null
    name: string
  }>

  // Get endpoints
  const endpoints = db.prepare(
    'SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order ASC'
  ).all(projectId) as Array<{
    id: string
    folder_id: string | null
    method: string | null
    path: string
    name: string
    description: string | null
    request_schema: string | null
  }>

  // Build folder map
  const folderMap = new Map<string, PostmanItem>()
  const rootItems: PostmanItem[] = []

  for (const folder of folders) {
    const postmanFolder: PostmanItem = {
      name: folder.name,
      item: []
    }
    folderMap.set(folder.id, postmanFolder)
  }

  // Assign folders to parents
  for (const folder of folders) {
    const postmanFolder = folderMap.get(folder.id)
    if (!postmanFolder) continue

    if (folder.parent_id && folderMap.has(folder.parent_id)) {
      const parentFolder = folderMap.get(folder.parent_id)
      if (parentFolder?.item) {
        parentFolder.item.push(postmanFolder)
      }
    } else {
      rootItems.push(postmanFolder)
    }
  }

  // Build endpoint items
  for (const ep of endpoints) {
    const method = (ep.method || 'GET').toUpperCase()
    const postmanItem: PostmanItem = {
      name: ep.name,
      request: {
        method,
        header: [],
        url: {
          raw: ep.path,
          path: ep.path.split('/').filter(Boolean)
        },
        description: ep.description ?? undefined
      }
    }

    if (ep.folder_id && folderMap.has(ep.folder_id)) {
      const folder = folderMap.get(ep.folder_id)
      if (folder?.item) {
        folder.item.push(postmanItem)
      }
    } else {
      rootItems.push(postmanItem)
    }
  }

  const collection: PostmanCollection = {
    info: {
      name: project.name,
      description: project.description ?? undefined,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: rootItems
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
    formData?: Array<{ key: string; value: string; enabled: boolean }>
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

function importCurl(projectId: string, curlCommand: string): ImportResult {
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

  db.prepare(`
    INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    endpointId,
    projectId,
    null,
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
    now
  )

  return {
    success: true,
    collectionId: projectId,
    endpointCount: 1,
    folderCount: 0,
    warnings: warnings.length > 0 ? warnings : undefined
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

function parseCurlCommand(command: string): ParsedCurl {
  // Normalize the command
  const normalized = command
    .replace(/\\\n/g, ' ')    // Line continuations
    .replace(/\\\r\n/g, ' ')
    .trim()

  const result: ParsedCurl = {
    method: 'GET',
    url: '',
    headers: {},
    insecure: false
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
                password: userPass.substring(colonIdx + 1)
              }
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

function tokenizeCurl(command: string): string[] {
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

function exportAsCurl(request: CurlExportRequest): string {
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
            if (item.enabled) {
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

    const requestSchema: Record<string, unknown> = {}

    // Query string parameters
    if (req.queryString && req.queryString.length > 0) {
      requestSchema.parameters = req.queryString.map((q) => ({
        name: q.name,
        in: 'query',
        required: false,
        schema: { type: 'string', default: q.value }
      }))
    }

    // Headers
    if (req.headers && req.headers.length > 0) {
      const headerMap: Record<string, string> = {}
      for (const h of req.headers) {
        // Skip pseudo-headers and common browser headers
        const lowerName = h.name.toLowerCase()
        if (lowerName.startsWith(':') || lowerName === 'host' || lowerName === 'connection') {
          continue
        }
        headerMap[h.name] = h.value
      }
      if (Object.keys(headerMap).length > 0) {
        requestSchema.headers = headerMap
      }
    }

    // Body
    if (req.postData) {
      const postData = req.postData
      // Skip binary/large bodies
      if (postData.text && postData.text.length <= 1_000_000) {
        const mimeType = postData.mimeType || 'text/plain'
        requestSchema.requestBody = {
          content: {
            [mimeType]: {
              example: postData.text
            }
          }
        }
      } else if (postData.params && postData.params.length > 0) {
        const properties: Record<string, unknown> = {}
        for (const p of postData.params) {
          properties[p.name] = { type: 'string', example: p.value }
        }
        requestSchema.requestBody = {
          content: {
            'application/x-www-form-urlencoded': {
              schema: { type: 'object', properties }
            }
          }
        }
      } else if (postData.text && postData.text.length > 1_000_000) {
        warnings.push(`Skipped large body for ${method} ${path} (${postData.text.length} bytes)`)
      }
    }

    // Map response status and timing as metadata
    const responseSchemas: Record<string, unknown> = {}
    if (entry.response) {
      const statusCode = String(entry.response.status)
      responseSchemas[statusCode] = {
        description: entry.response.statusText || 'Response'
      }
    }

    if (entry.time !== undefined) {
      requestSchema._timing = { total: entry.time }
    }

    db.prepare(`
      INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
      now
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
    warnings: warnings.length > 0 ? warnings : undefined
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
  parameters?: Array<{ name: string; value: string; disabled?: boolean }>
  authentication?: InsomniaAuth
  data?: Array<{ name: string; value: string }>
}

interface InsomniaBody {
  mimeType?: string
  text?: string
  params?: Array<{ name: string; value: string; fileName?: string; type?: string }>
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

async function importInsomnia(projectId: string, content: string): Promise<ImportResult> {
  const warnings: string[] = []
  let doc: InsomniaExport

  try {
    doc = JSON.parse(content) as InsomniaExport
  } catch {
    return { success: false, error: 'Failed to parse Insomnia export as JSON' }
  }

  // Validate format version
  if (doc.__export_format !== 4 && !doc.resources) {
    return { success: false, error: 'Not a valid Insomnia v4 export file' }
  }

  const resources = doc.resources
  if (!resources || resources.length === 0) {
    return { success: false, error: 'Insomnia export contains no resources' }
  }

  const db = getDb()
  const now = Date.now()
  let endpointCount = 0
  let folderCount = 0
  const suggestedEnvVars: Record<string, string> = {}

  // Build parent-id to folder-id map for request_group resources
  const folderMap = new Map<string, string>()

  // First pass: create folders from request_group resources
  for (const resource of resources) {
    if (resource._type === 'request_group') {
      const folderId = randomUUID()
      const parentFolderId = resource.parentId ? (folderMap.get(resource.parentId) ?? null) : null

      db.prepare(`
        INSERT INTO folders (id, project_id, parent_id, name, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `).run(folderId, projectId, parentFolderId, resource.name || 'Unnamed Folder', folderCount)

      folderMap.set(resource._id, folderId)
      folderCount++
    }
  }

  // Second pass: update folder parent_ids for nested groups
  // (handle case where child appears before parent in array)
  for (const resource of resources) {
    if (resource._type === 'request_group' && resource.parentId) {
      const folderId = folderMap.get(resource._id)
      const parentFolderId = folderMap.get(resource.parentId)
      if (folderId && parentFolderId) {
        db.prepare(`UPDATE folders SET parent_id = ? WHERE id = ?`).run(parentFolderId, folderId)
      }
    }
  }

  // Third pass: create endpoints from request resources
  for (const resource of resources) {
    if (resource._type === 'request') {
      const method = (resource.method || 'GET').toUpperCase()
      const url = resource.url || ''
      let path = ''

      try {
        const parsedUrl = new URL(url.replace(/\{\{[^}]+\}\}/g, 'placeholder'))
        path = parsedUrl.pathname
      } catch {
        path = url
      }

      const endpointId = randomUUID()
      const parentFolderId = resource.parentId ? (folderMap.get(resource.parentId) ?? null) : null

      const requestSchema: Record<string, unknown> = {}

      // Parameters
      if (resource.parameters && resource.parameters.length > 0) {
        requestSchema.parameters = resource.parameters
          .filter((p) => !p.disabled)
          .map((p) => ({
            name: p.name,
            in: 'query',
            required: false,
            schema: { type: 'string', default: p.value }
          }))
      }

      // Headers
      if (resource.headers && resource.headers.length > 0) {
        const headerMap: Record<string, string> = {}
        for (const h of resource.headers) {
          if (!h.disabled) {
            headerMap[h.name] = h.value
          }
        }
        if (Object.keys(headerMap).length > 0) {
          requestSchema.headers = headerMap
        }
      }

      // Body
      if (resource.body) {
        requestSchema.requestBody = mapInsomniaBody(resource.body)
      }

      // Auth
      if (resource.authentication && !resource.authentication.disabled) {
        const authConfig = mapInsomniaAuth(resource.authentication)
        if (authConfig) {
          requestSchema.auth = authConfig
        }
      }

      db.prepare(`
        INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        endpointId,
        projectId,
        parentFolderId,
        resource.name || `${method} ${path}`,
        resource.description ?? null,
        'http',
        method,
        path || url,
        'developing',
        Object.keys(requestSchema).length > 0 ? JSON.stringify(requestSchema) : null,
        null,
        endpointCount,
        now,
        now
      )
      endpointCount++
    }
  }

  // Fourth pass: extract environment variables
  for (const resource of resources) {
    if (resource._type === 'environment' && resource.data) {
      for (const entry of resource.data) {
        if (entry.name && entry.value) {
          suggestedEnvVars[entry.name] = entry.value
        }
      }
    }
  }

  if (endpointCount === 0) {
    warnings.push('No request resources found in Insomnia export')
  }

  return {
    success: true,
    collectionId: projectId,
    endpointCount,
    folderCount,
    suggestedEnvVars: Object.keys(suggestedEnvVars).length > 0 ? suggestedEnvVars : undefined,
    warnings: warnings.length > 0 ? warnings : undefined
  }
}

function mapInsomniaBody(body: InsomniaBody): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (!body.mimeType) {
    if (body.text) {
      result.content = { 'text/plain': { example: body.text } }
    }
    return result
  }

  switch (body.mimeType) {
    case 'application/json':
    case 'application/xml':
    case 'text/xml':
    case 'text/plain':
    case 'text/html':
    case 'application/javascript': {
      if (body.text) {
        result.content = { [body.mimeType]: { example: body.text } }
      }
      break
    }
    case 'multipart/form-data': {
      if (body.params && body.params.length > 0) {
        const properties: Record<string, unknown> = {}
        for (const p of body.params) {
          properties[p.name] = {
            type: 'string',
            format: p.type === 'file' || p.fileName ? 'binary' : undefined,
            example: p.value
          }
        }
        result.content = {
          'multipart/form-data': {
            schema: { type: 'object', properties }
          }
        }
      }
      break
    }
    case 'application/x-www-form-urlencoded': {
      if (body.params && body.params.length > 0) {
        const properties: Record<string, unknown> = {}
        for (const p of body.params) {
          properties[p.name] = { type: 'string', example: p.value }
        }
        result.content = {
          'application/x-www-form-urlencoded': {
            schema: { type: 'object', properties }
          }
        }
      }
      break
    }
    default: {
      if (body.text) {
        result.content = { [body.mimeType]: { example: body.text } }
      }
      break
    }
  }

  return result
}

function mapInsomniaAuth(auth: InsomniaAuth): Record<string, unknown> | null {
  if (!auth.type || auth.type === 'none') {
    return null
  }

  const config: Record<string, unknown> = { type: auth.type }

  switch (auth.type) {
    case 'basic': {
      config.basic = {
        username: auth.username ?? '',
        password: auth.password ?? ''
      }
      break
    }
    case 'bearer': {
      config.bearer = {
        token: auth.token ?? '',
        prefix: auth.prefix ?? 'Bearer'
      }
      break
    }
    case 'apikey': {
      config.type = 'api-key'
      config.apiKey = {
        key: auth.key ?? '',
        value: auth.value ?? '',
        in: auth.addTo === 'query' ? 'query' : 'header'
      }
      break
    }
    case 'oauth2': {
      config.oauth2 = {
        token: auth.token ?? ''
      }
      break
    }
    default: {
      // Unknown auth type, store what we can
      break
    }
  }

  return config
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
    db.prepare(`
      INSERT INTO folders (id, project_id, parent_id, name, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(rootFolderId, payload.projectId, payload.targetFolderId ?? null, folderName, 0)
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
      db.prepare(`
        INSERT INTO folders (id, project_id, parent_id, name, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `).run(serviceFolderId, payload.projectId, rootFolderId, service.name, folderCount)
      folderCount++
    }

    for (const port of service.ports) {
      // Always create port-level folders under the service folder
      const portFolderId = randomUUID()
      db.prepare(`
        INSERT INTO folders (id, project_id, parent_id, name, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `).run(portFolderId, payload.projectId, serviceFolderId, port.name, folderCount)
      folderCount++
      const parentForEndpoints = portFolderId

      for (const operation of port.operations) {
        const endpointId = randomUUID()
        const endpointUrl = port.endpointUrl || parsed.endpointUrl

        const requestSchema = JSON.stringify({
          method: 'POST',
          url: endpointUrl,
          headers: [
            { id: randomUUID(), key: 'Content-Type', value: parsed.soapVersion === 'soap12' ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8', enabled: true },
            { id: randomUUID(), key: 'SOAPAction', value: operation.soapAction, enabled: true }
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
            exampleResponse: operation.exampleResponse
          }
        })

        const responseSchemas = JSON.stringify({
          '200': {
            description: 'SOAP Response',
            content: { 'text/xml': { example: operation.exampleResponse } }
          }
        })

        db.prepare(`
          INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
          now
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
    warnings: warnings.length > 0 ? warnings : undefined
  }
}
