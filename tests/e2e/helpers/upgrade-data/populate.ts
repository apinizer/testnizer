/**
 * Issue #291 — fills a fresh userData with a realistic, SECRET-FREE data set
 * through the app's own IPC, so the Electron upgrade test can prove that data
 * written by one build is read back intact by another.
 *
 * Every "secret" here is a fixture string (`fixture-…`), never a real
 * credential. The values that the app stores ENCRYPTED (secret variables, mock
 * auth, the Mock MCP bearer token, the certificate passphrase, the OTP seed,
 * the AI provider key) are listed in the returned manifest in plaintext, so
 * the reader side can check that each one still DECRYPTS to its original.
 *
 * The function runs inside the renderer (`page.evaluate`), so it must not
 * close over anything; IPC calls the running build does not have (an older
 * release) are recorded as `skipped` instead of failing the fixture.
 */
import type { Page } from '@playwright/test'

export interface PopulateArgs {
  /** Prefix that makes names unique per fixture (e.g. 'v1.5.4', 'e33'). */
  label: string
  /** Base URL of the local HTTP test server, for the endpoint that is Sent. */
  httpBase: string
  /** Absolute path of a PEM file the certificate row points at (any content). */
  certPath: string
}

export interface PopulateManifest {
  workspaceId: string
  projectIds: string[]
  /** Endpoint the reader side Sends to prove the app still works. */
  sendEndpointId: string
  /** Active environment of project A, and its `baseUrl` variable. */
  environmentId: string
  baseUrlVarId: string
  /** `envVariable` ids → expected plaintext {value, initial_value}. */
  envSecrets: Record<string, { value: string; initial_value: string }>
  /** `globalVariable` ids → expected plaintext {value, initial_value}. */
  globalSecrets: Record<string, { value: string; initial_value: string }>
  mockServerId?: string
  mockAuth?: unknown
  mockMcpServerId?: string
  mockMcpBearer?: string
  certificateId?: string
  otpId?: string
  otpSecret?: string
  aiKeyScope?: string
  aiKey?: string
  /** settings key → value written through settings:set. */
  settings: Record<string, unknown>
  skipped: string[]
}

export async function populateUserData(page: Page, args: PopulateArgs): Promise<PopulateManifest> {
  return page.evaluate(populateInRenderer, args)
}

/** Runs in the renderer. Self-contained by design — see the module note. */
export async function populateInRenderer(args: PopulateArgs): Promise<PopulateManifest> {
  type Res = { success: boolean; data?: unknown; error?: string }
  type Fn = (...a: unknown[]) => Promise<Res>
  const api = (window as unknown as { api: Record<string, Record<string, unknown>> }).api
  const skipped: string[] = []

  function fn(path: string): Fn | null {
    let cur: unknown = api
    for (const part of path.split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    return typeof cur === 'function' ? (cur as Fn) : null
  }
  async function call<T>(path: string, ...a: unknown[]): Promise<T> {
    const f = fn(path)
    if (!f) throw new Error(`IPC ${path} is not available in this build`)
    const r = await f(...a)
    if (!r || r.success !== true) throw new Error(`${path} failed: ${r?.error ?? 'no result'}`)
    return r.data as T
  }
  async function optional<T>(path: string, ...a: unknown[]): Promise<T | undefined> {
    if (!fn(path)) {
      skipped.push(path)
      return undefined
    }
    return call<T>(path, ...a)
  }

  const L = args.label
  // The workspace Project Home shows (the first one), so the UI part of the
  // test can open the projects; a fresh profile gets one on first start.
  const existing = await call<Array<{ id: string }>>('workspace.list')
  const ws =
    existing[0] ??
    (await call<{ id: string }>('workspace.create', { name: `Upgrade WS ${L}`, color: '#2D5FA0' }))
  const pA = await call<{ id: string }>('project.create', {
    workspace_id: ws.id,
    name: `upgrade-a-${L}`,
    type: 'http',
  })
  const pB = await call<{ id: string }>('project.create', {
    workspace_id: ws.id,
    name: `upgrade-b-${L}`,
    type: 'http',
  })

  // ── Folders (nested, with folder auth + scripts) ───────────────────────────
  const fRoot = await call<{ id: string }>('folder.create', { project_id: pA.id, name: 'Accounts' })
  const fChild = await call<{ id: string }>('folder.create', {
    project_id: pA.id,
    parent_id: fRoot.id,
    name: 'Transfers',
  })
  await call('folder.update', fRoot.id, {
    auth: JSON.stringify({ type: 'bearer', bearer: { token: '{{token}}', prefix: 'Bearer' } }),
    pre_script: "pm.variables.set('fromFolder', 'yes')",
    post_script: "pm.test('folder ok', () => pm.expect(true).to.be.true)",
  })
  await call('folder.create', { project_id: pB.id, name: 'Inventory' })

  // ── Endpoints, one per protocol ────────────────────────────────────────────
  const http = await call<{ id: string }>('endpoint.create', {
    project_id: pA.id,
    folder_id: fChild.id,
    name: 'Get echo',
    protocol: 'http',
    method: 'GET',
    path: '/get',
    request_schema: JSON.stringify({
      // {{baseUrl}}, not a literal port: the reader side points it at ITS
      // test server and Sends this exact saved request.
      url: '{{baseUrl}}/get?q={{query}}',
      method: 'GET',
      params: [{ key: 'q', value: '{{query}}', enabled: true }],
      headers: [{ key: 'X-Trace', value: 'upgrade', enabled: true }],
      auth: { type: 'inherit' },
      body: { type: 'none' },
      preScript: "pm.environment.set('lastRun', 'pre')",
      postScript: "pm.test('status 200', () => pm.response.to.have.status(200))",
      assertions: [{ id: 'a1', type: 'status', operator: 'eq', expected: '200', enabled: true }],
      timeout: 15000,
    }),
  })
  const protocolEndpoints: Array<[string, string, Record<string, unknown>]> = [
    [
      'graphql',
      'GraphQL users',
      { url: `${args.httpBase}/graphql`, query: '{ users { id } }', variables: '{"limit":5}' },
    ],
    [
      'soap',
      'SOAP balance',
      {
        url: `${args.httpBase}/soap`,
        wsdl: `${args.httpBase}/soap?wsdl`,
        operation: 'GetBalance',
        soapVersion: '1.1',
        envelope: '<soap:Envelope/>',
      },
    ],
    [
      'websocket',
      'WS feed',
      {
        url: 'ws://127.0.0.1:1/feed',
        savedMessages: [{ id: 'm1', name: 'hello', body: '{"op":"hi"}' }],
        composerMode: 'json',
      },
    ],
    [
      'socketio',
      'Socket.IO chat',
      {
        url: 'http://127.0.0.1:1',
        namespace: '/chat',
        // The pre-1.6.0 shape (issue #283 renamed these to listeners/emitArgs):
        // the profile is written as an older build would have saved it.
        subscriptions: ['message', 'room-update'],
        emitEvent: 'join',
        emitPayload: '{"room":"a"}',
      },
    ],
    ['mqtt', 'MQTT telemetry', { url: 'mqtt://127.0.0.1:1', topic: 'tele/#', qos: 1 }],
    [
      'mcp',
      'MCP tools',
      {
        transport: 'http',
        url: 'http://127.0.0.1:1/mcp',
        toolName: 'echo',
        toolArgs: '{"text":"hi"}',
      },
    ],
    [
      'grpc',
      'gRPC health',
      { url: '127.0.0.1:1', service: 'grpc.health.v1.Health', method: 'Check' },
    ],
    ['sse', 'SSE ticks', { url: `${args.httpBase}/sse` }],
  ]
  const endpointIds: string[] = [http.id]
  for (const [protocol, name, schema] of protocolEndpoints) {
    const ep = await call<{ id: string }>('endpoint.create', {
      project_id: pA.id,
      folder_id: fRoot.id,
      name,
      protocol,
      method: protocol === 'graphql' ? 'POST' : 'GET',
      path: '/',
      // Where the app reads protocol fields from when it opens the request
      // (`request_schema.metadata.<protocol>`, as 1.5.4 and 1.6.0 do).
      request_schema: JSON.stringify({ url: schema.url, metadata: { [protocol]: schema } }),
    })
    endpointIds.push(ep.id)
  }
  await call('endpoint.create', {
    project_id: pB.id,
    name: 'List items',
    protocol: 'http',
    method: 'POST',
    path: '/post',
    request_schema: JSON.stringify({
      url: `${args.httpBase}/post`,
      method: 'POST',
      body: { type: 'json', content: '{"sku":"A-1","qty":2}' },
      auth: { type: 'basic', basic: { username: 'fixture-user', password: '{{basicPass}}' } },
    }),
  })

  // A saved request (the older "request" row kind) with metadata.
  const saved = await optional<{ id: string }>('savedRequest.create', {
    project_id: pA.id,
    folder_id: fRoot.id,
    name: 'Saved POST',
    protocol: 'http',
    method: 'POST',
    url: `${args.httpBase}/post`,
    headers: JSON.stringify([{ key: 'Content-Type', value: 'application/json', enabled: true }]),
    body: JSON.stringify({ type: 'json', content: '{"a":1}' }),
    metadata: JSON.stringify({ pathVariables: [], timeout: 5000 }),
  })

  // ── Saved examples ─────────────────────────────────────────────────────────
  await optional('savedResponse.create', {
    project_id: pA.id,
    owner_type: 'endpoint',
    owner_id: http.id,
    name: '200 example',
    protocol: 'http',
    method: 'GET',
    url: `${args.httpBase}/get`,
    status_code: 200,
    response_json: JSON.stringify({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
    }),
    request_json: JSON.stringify({
      configured: { url: `${args.httpBase}/get?q={{query}}` },
      sent: { url: `${args.httpBase}/get?q=x` },
    }),
  })
  if (saved) {
    await optional('savedResponse.create', {
      project_id: pA.id,
      owner_type: 'saved_request',
      owner_id: saved.id,
      name: 'saved example',
      protocol: 'http',
      status_code: 201,
      response_json: JSON.stringify({ status: 201, body: '{"created":true}' }),
    })
  }

  // ── Environments: secret + non-secret, current + initial ───────────────────
  const envSecrets: PopulateManifest['envSecrets'] = {}
  const env = await call<{ id: string }>('environment.create', {
    workspace_id: ws.id,
    project_id: pA.id,
    name: 'Staging',
    is_active: true,
  })
  const baseUrl = await call<{ id: string }>('envVariable.create', {
    environment_id: env.id,
    key: 'baseUrl',
    value: args.httpBase,
    initial_value: args.httpBase,
    enabled: true,
  })
  await call('envVariable.create', {
    environment_id: env.id,
    key: 'query',
    value: 'current-q',
    initial_value: 'initial-q',
    enabled: true,
  })
  const tok = await call<{ id: string }>('envVariable.create', {
    environment_id: env.id,
    key: 'token',
    value: `fixture-token-current-${L}`,
    initial_value: `fixture-token-initial-${L}`,
    enabled: true,
    secret: true,
  })
  envSecrets[tok.id] = {
    value: `fixture-token-current-${L}`,
    initial_value: `fixture-token-initial-${L}`,
  }
  const pass = await call<{ id: string }>('envVariable.create', {
    environment_id: env.id,
    key: 'basicPass',
    value: '',
    initial_value: `fixture-pass-initial-${L}`,
    enabled: true,
    secret: true,
  })
  envSecrets[pass.id] = { value: '', initial_value: `fixture-pass-initial-${L}` }
  await call('environment.setActiveForProject', pA.id, env.id)
  const envB = await call<{ id: string }>('environment.create', {
    workspace_id: ws.id,
    project_id: pB.id,
    name: 'Production',
  })
  await call('envVariable.create', {
    environment_id: envB.id,
    key: 'region',
    value: 'eu',
    enabled: false,
  })

  // ── Project (global) variables ─────────────────────────────────────────────
  const globalSecrets: PopulateManifest['globalSecrets'] = {}
  await call('globalVariable.create', {
    workspace_id: ws.id,
    project_id: pA.id,
    key: 'apiVersion',
    value: 'v2',
    initial_value: 'v1',
  })
  const gs = await call<{ id: string }>('globalVariable.create', {
    workspace_id: ws.id,
    project_id: pA.id,
    key: 'clientSecret',
    value: `fixture-client-secret-${L}`,
    initial_value: `fixture-client-secret-initial-${L}`,
    secret: true,
  })
  globalSecrets[gs.id] = {
    value: `fixture-client-secret-${L}`,
    initial_value: `fixture-client-secret-initial-${L}`,
  }

  // ── Mocks: HTTP with auth, Mock MCP with a bearer token ────────────────────
  let mockServerId: string | undefined
  const mockAuth = { type: 'bearer', token: `fixture-mock-token-${L}` }
  const mock = await optional<{ id: string }>('mock.server.create', {
    projectId: pA.id,
    name: 'Accounts mock',
    port: 47811,
  })
  if (mock) {
    mockServerId = mock.id
    await call('mock.server.update', mock.id, { authConfig: mockAuth, corsEnabled: true })
    const mep = await call<{ id: string }>('mock.endpoint.create', {
      serverId: mock.id,
      method: 'GET',
      path: '/accounts/:id',
      authOverride: { type: 'basic', username: 'fixture-u', password: `fixture-override-${L}` },
    })
    await call('mock.response.create', {
      endpointId: mep.id,
      name: 'ok',
      statusCode: 200,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      bodyType: 'json',
      body: '{"id":"{{request.params.id}}"}',
    })
  }
  let mockMcpServerId: string | undefined
  const mockMcpBearer = `fixture-mcp-bearer-${L}`
  const mcpMock = await optional<{ id: string }>('mockMcp.server.create', {
    projectId: pA.id,
    name: 'Tools mock',
    port: 47812,
    authMode: 'bearer',
    bearerToken: mockMcpBearer,
  })
  if (mcpMock) mockMcpServerId = mcpMock.id

  // ── Certificate row (disabled, non-local host — see CLAUDE.md cert gotcha) ─
  let certificateId: string | undefined
  const cert = await optional<{ id: string }>('certificate.add', {
    projectId: pA.id,
    kind: 'pem',
    host: 'upgrade-fixture.invalid',
    crtPath: args.certPath,
    keyPath: args.certPath,
    passphrase: `fixture-passphrase-${L}`,
    enabled: false,
  })
  if (cert) certificateId = cert.id

  // ── OTP vault (seed encrypted with safeStorage) ────────────────────────────
  const otpSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  const otp = await optional<{ id: string }>('otp.add', {
    issuer: 'Fixture',
    account: `upgrade-${L}`,
    secret: otpSecret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    type: 'totp',
  })

  // ── History + a runner result ──────────────────────────────────────────────
  await optional('history.add', {
    workspace_id: ws.id,
    project_id: pA.id,
    endpoint_id: http.id,
    protocol: 'http',
    method: 'GET',
    url: `${args.httpBase}/get?q=current-q`,
    status_code: 200,
    duration_ms: 12,
    request_snapshot: JSON.stringify({
      method: 'GET',
      url: `${args.httpBase}/get?q=current-q`,
      headers: {},
    }),
    response_snapshot: JSON.stringify({ status: 200, body: '{"args":{"q":"current-q"}}' }),
  })
  await optional('runner.execute', {
    projectId: pA.id,
    environmentId: env.id,
    endpointIds: [http.id],
  })

  // ── Test suite over the HTTP endpoint ──────────────────────────────────────
  const suite = await optional<{ id: string }>('testSuite.create', {
    project_id: pA.id,
    name: 'Smoke suite',
  })
  if (suite)
    await optional('testSuite.importEndpoints', { suite_id: suite.id, endpoint_ids: [http.id] })

  // ── electron-store settings (incl. a safeStorage-encrypted AI key) ─────────
  const settings: Record<string, unknown> = {
    'ui.theme': 'dark',
    'ui.locale': 'tr',
    'ui.fontSize': 15,
    [`project.${pA.id}.settings`]: {
      requestTimeout: 20000,
      followRedirects: false,
      preScript: "pm.variables.set('fromProject', 'yes')",
      // Machine-local half of project settings: stays in electron-store, and
      // settings:set seals its `password` field with safeStorage.
      proxy: {
        mode: 'manual',
        host: 'proxy.upgrade-fixture.invalid',
        port: 3128,
        username: 'fixture-proxy-user',
        password: `fixture-proxy-pass-${L}`,
      },
    },
  }
  for (const [k, v] of Object.entries(settings)) await call('settings.set', k, v)
  const aiKeyScope = 'openai'
  const aiKey = `fixture-ai-key-${L}`
  const aiSet = fn('aiChat.setKey')
    ? await call('aiChat.setKey', aiKeyScope, aiKey).then(() => true)
    : false
  if (!aiSet) skipped.push('aiChat.setKey')

  return {
    workspaceId: ws.id,
    projectIds: [pA.id, pB.id],
    sendEndpointId: http.id,
    environmentId: env.id,
    baseUrlVarId: baseUrl.id,
    envSecrets,
    globalSecrets,
    mockServerId,
    mockAuth: mock ? mockAuth : undefined,
    mockMcpServerId,
    mockMcpBearer: mcpMock ? mockMcpBearer : undefined,
    certificateId,
    otpId: otp?.id,
    otpSecret: otp ? otpSecret : undefined,
    aiKeyScope: aiSet ? aiKeyScope : undefined,
    aiKey: aiSet ? aiKey : undefined,
    settings,
    skipped,
  }
}
