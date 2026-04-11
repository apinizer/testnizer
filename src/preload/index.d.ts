import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  IpcResult,
  Workspace,
  Project,
  Folder,
  Endpoint,
  EndpointCase,
  SavedRequest,
  Environment,
  EnvironmentVariable,
  GlobalVariable,
  HistoryEntry,
  ApiResponse,
  AppSettings,
  ImportResult,
  WsdlParseResult,
  SoapMetadata,
  WsSecurityConfig,
  WsMessage,
  Branch
} from '../renderer/types'

interface WorkspaceApi {
  list(): Promise<IpcResult<Workspace[]>>
  get(id: string): Promise<IpcResult<Workspace | undefined>>
  create(payload: { name: string; description?: string; color?: string }): Promise<IpcResult<Workspace>>
  update(id: string, payload: { name?: string; description?: string; color?: string }): Promise<IpcResult<Workspace | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface ProjectApi {
  list(workspaceId: string): Promise<IpcResult<Project[]>>
  get(id: string): Promise<IpcResult<Project | undefined>>
  create(payload: { workspace_id: string; name: string; description?: string; type?: string; save_mode?: string; local_path?: string; icon_emoji?: string | null; icon_color?: string | null }): Promise<IpcResult<Project>>
  update(id: string, payload: { name?: string; description?: string; type?: string; save_mode?: string; local_path?: string | null; sort_order?: number; icon_emoji?: string | null; icon_color?: string | null }): Promise<IpcResult<Project | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface FolderApi {
  list(projectId: string): Promise<IpcResult<Folder[]>>
  create(payload: { project_id: string; parent_id?: string | null; name: string }): Promise<IpcResult<Folder>>
  update(id: string, payload: { name?: string; parent_id?: string | null; sort_order?: number }): Promise<IpcResult<Folder | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface EndpointApi {
  listByProject(projectId: string): Promise<IpcResult<Endpoint[]>>
  listByFolder(folderId: string): Promise<IpcResult<Endpoint[]>>
  get(id: string): Promise<IpcResult<Endpoint | undefined>>
  create(payload: {
    project_id: string
    folder_id?: string | null
    name: string
    description?: string
    protocol?: string
    method?: string
    path: string
    status?: string
  }): Promise<IpcResult<Endpoint>>
  update(id: string, payload: Partial<Omit<Endpoint, 'id' | 'project_id' | 'created_at'>>): Promise<IpcResult<Endpoint | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface EndpointCaseApi {
  list(endpointId: string): Promise<IpcResult<EndpointCase[]>>
  get(id: string): Promise<IpcResult<EndpointCase | undefined>>
  create(payload: {
    endpoint_id: string
    name: string
    params?: string
    headers?: string
    body?: string
    auth?: string
    assertions?: string
    is_default?: boolean
  }): Promise<IpcResult<EndpointCase>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface SavedRequestApi {
  list(projectId: string): Promise<IpcResult<SavedRequest[]>>
  get(id: string): Promise<IpcResult<SavedRequest | undefined>>
  create(payload: {
    project_id?: string | null
    folder_id?: string | null
    name: string
    protocol?: string
    method?: string
    url: string
    params?: string
    headers?: string
    body?: string
    auth?: string
    pre_script?: string
    post_script?: string
    assertions?: string
    metadata?: string
  }): Promise<IpcResult<SavedRequest>>
  update(id: string, payload: Partial<Omit<SavedRequest, 'id' | 'created_at'>>): Promise<IpcResult<SavedRequest | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface EnvironmentApi {
  list(workspaceId: string): Promise<IpcResult<Environment[]>>
  listByProject(projectId: string): Promise<IpcResult<Environment[]>>
  get(id: string): Promise<IpcResult<Environment | undefined>>
  create(payload: { workspace_id: string; project_id?: string | null; name: string; is_active?: boolean }): Promise<IpcResult<Environment>>
  update(id: string, payload: { name?: string; is_active?: boolean }): Promise<IpcResult<Environment | undefined>>
  setActive(workspaceId: string, environmentId: string): Promise<IpcResult<boolean>>
  setActiveForProject(projectId: string, environmentId: string): Promise<IpcResult<boolean>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface EnvVariableApi {
  list(environmentId: string): Promise<IpcResult<EnvironmentVariable[]>>
  create(payload: {
    environment_id: string
    key: string
    value: string
    description?: string
    enabled?: boolean
    secret?: boolean
    initial_value?: string
  }): Promise<IpcResult<EnvironmentVariable>>
  update(id: string, payload: Partial<EnvironmentVariable>): Promise<IpcResult<EnvironmentVariable | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface GlobalVariableApi {
  list(workspaceId: string): Promise<IpcResult<GlobalVariable[]>>
  listByProject(projectId: string): Promise<IpcResult<GlobalVariable[]>>
  create(payload: {
    workspace_id: string
    project_id?: string | null
    key: string
    value: string
    description?: string
    enabled?: boolean
    secret?: boolean
    initial_value?: string
  }): Promise<IpcResult<GlobalVariable>>
  update(id: string, payload: {
    key?: string
    value?: string
    description?: string
    enabled?: boolean
    secret?: boolean
    initial_value?: string
  }): Promise<IpcResult<GlobalVariable | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface HistoryApi {
  list(options: { workspace_id?: string; project_id?: string; limit?: number; offset?: number }): Promise<IpcResult<HistoryEntry[]>>
  get(id: string): Promise<IpcResult<HistoryEntry | undefined>>
  add(payload: {
    workspace_id?: string
    project_id?: string
    endpoint_id?: string
    protocol: string
    method?: string
    url: string
    status_code?: number
    duration_ms?: number
    request_snapshot: string
    response_snapshot?: string
  }): Promise<IpcResult<HistoryEntry>>
  clear(workspaceId?: string): Promise<IpcResult<number>>
  delete(id: string): Promise<IpcResult<boolean>>
  prune(limit: number, workspaceId?: string): Promise<IpcResult<number>>
}

interface SettingsApi {
  getAll(): Promise<IpcResult<AppSettings>>
  get(key: string): Promise<IpcResult<unknown>>
  set(key: string, value: unknown): Promise<IpcResult<boolean>>
  setAll(settings: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
  reset(): Promise<IpcResult<AppSettings>>
}

interface RequestApi {
  send(options: {
    method: string
    url: string
    params?: unknown[]
    headers?: unknown[]
    body?: unknown
    auth?: unknown
    timeout?: number
    followRedirects?: boolean
    sslVerification?: boolean
    proxy?: unknown
    _workspaceId?: string
    _projectId?: string
    _endpointId?: string
    _protocol?: string
  }): Promise<IpcResult<ApiResponse>>
  cancel(requestId: string): Promise<IpcResult<boolean>>
}

interface ImportExportApi {
  openFile(): Promise<IpcResult<{ filePath: string; content: string } | null>>
  importOpenApi(payload: { projectId: string; content: string; format: string }): Promise<IpcResult<ImportResult>>
  exportOpenApi(projectId: string): Promise<IpcResult<string>>
  saveFile(content: string, defaultName: string): Promise<IpcResult<string | null>>
  importPostman(payload: { projectId: string; content: string }): Promise<IpcResult<ImportResult>>
  exportPostman(projectId: string): Promise<IpcResult<string>>
  importHar(payload: { projectId: string; content: string }): Promise<IpcResult<ImportResult>>
  importInsomnia(payload: { projectId: string; content: string }): Promise<IpcResult<ImportResult>>
  importCurl(payload: { projectId: string; curlCommand: string }): Promise<IpcResult<ImportResult>>
  exportCurl(request: CurlExportRequest): Promise<IpcResult<string>>
  importWsdl(payload: {
    projectId: string
    targetFolderId?: string | null
    createNewFolder?: boolean
    newFolderName?: string
    wsdlUrl?: string
    wsdlContent?: string
    parsedWsdl?: WsdlParseResult
  }): Promise<IpcResult<ImportResult>>
  parseWsdlForImport(url: string): Promise<IpcResult<WsdlParseResult>>
  parseWsdlFileForImport(content: string): Promise<IpcResult<WsdlParseResult>>
}

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

interface SoapExecutePayload {
  wsdlUrl: string
  endpointUrl: string
  operationName: string
  serviceName?: string
  portName?: string
  soapVersion: 'soap11' | 'soap12'
  params: Record<string, unknown>
  headers?: Record<string, string>
  wsSecurity?: WsSecurityConfig
  timeout?: number
  sslVerification?: boolean
}

interface GenerateEnvelopePayload {
  operationName: string
  params: Record<string, unknown>
  soapVersion: 'soap11' | 'soap12'
  soapAction?: string
  namespace?: string
}

interface SoapApi {
  parseWsdl(url: string): Promise<IpcResult<WsdlParseResult>>
  parseWsdlFile(content: string): Promise<IpcResult<WsdlParseResult>>
  execute(options: SoapExecutePayload): Promise<IpcResult<ApiResponse>>
  generateEnvelope(options: GenerateEnvelopePayload): Promise<IpcResult<string>>
}

interface WsConnectOptions {
  url: string
  headers?: Record<string, string>
  protocols?: string[]
  rejectUnauthorized?: boolean
}

interface WsConnectionInfo {
  connectionId: string
  url: string
  readyState: number
  connectedAt: number
}

interface WsEventPayload {
  connectionId: string
  type: 'open' | 'message' | 'close' | 'error'
  data?: string
  code?: number
  reason?: string
  timestamp: number
  messageId?: string
  contentType?: 'text' | 'json' | 'binary'
}

interface WsApi {
  connect(options: WsConnectOptions): Promise<IpcResult<WsConnectionInfo>>
  disconnect(connectionId: string): Promise<IpcResult<boolean>>
  send(connectionId: string, message: string): Promise<IpcResult<boolean>>
  onEvent(callback: (event: WsEventPayload) => void): () => void
}

// ─── Collection Runner ──────────────────────────────────────────

interface RunnerExecuteOptions {
  projectId: string
  endpointIds: string[]
  environmentId?: string
  delay?: number
}

interface EndpointRunResult {
  endpointId: string
  endpointName: string
  method: string
  url: string
  status: number | null
  statusText: string
  duration: number
  passed: number
  failed: number
  skipped: number
  assertions: RunnerAssertionResult[]
  error?: string
}

interface RunnerAssertionResult {
  name: string
  passed: boolean
  actual?: string | number
  error?: string
}

interface RunnerProgress {
  current: number
  total: number
  endpointId: string
  result: EndpointRunResult
}

interface RunnerReport {
  projectId: string
  startedAt: number
  completedAt: number
  totalEndpoints: number
  passedEndpoints: number
  failedEndpoints: number
  totalAssertions: number
  passedAssertions: number
  failedAssertions: number
  results: EndpointRunResult[]
}

interface RunnerExportOptions {
  results: EndpointRunResult[]
  format: 'json' | 'html'
}

interface RunnerApi {
  execute(options: RunnerExecuteOptions): Promise<IpcResult<RunnerReport>>
  stop(): Promise<IpcResult<boolean>>
  export(options: RunnerExportOptions): Promise<IpcResult<string>>
  onProgress(callback: (progress: RunnerProgress) => void): () => void
}

// ─── GraphQL ─────────────────────────────────────────────────────

interface GraphqlExecutePayload {
  url: string
  query: string
  variables?: string
  operationName?: string
  headers?: Array<{
    id: string
    key: string
    value: string
    description?: string
    enabled: boolean
  }>
  auth?: {
    type: string
    basic?: { username: string; password: string }
    bearer?: { token: string; prefix?: string }
    apiKey?: { key: string; value: string; in: 'header' | 'query' }
    oauth2?: { token?: string }
  }
  timeout?: number
  sslVerification?: boolean
}

interface GraphqlApiResponse {
  requestId: string
  protocol: 'graphql'
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  bodySize?: number
  timing: { total: number; dns?: number; tcp?: number; tls?: number; ttfb?: number; download?: number }
  error?: string
  actualRequest?: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
  }
}

interface GraphqlIntrospectionResult {
  types: Array<{
    name: string
    kind: string
    fields: Array<{
      name: string
      type: {
        name: string | null
        kind: string
        ofType: { name: string | null; kind: string } | null
      }
    }> | null
  }>
  queryType: string | null
  mutationType: string | null
  subscriptionType: string | null
}

interface GraphqlSubscribePayload {
  url: string
  wsUrl?: string
  query: string
  variables?: string
  operationName?: string
  headers?: Record<string, string>
  sslVerification?: boolean
}

interface GraphqlSubscriptionEvent {
  subscriptionId: string
  type: 'data' | 'error' | 'complete'
  data?: string
  error?: string
  timestamp: number
}

interface GraphqlApi {
  execute(options: GraphqlExecutePayload): Promise<IpcResult<GraphqlApiResponse>>
  introspect(url: string, headers?: Record<string, string>): Promise<IpcResult<GraphqlIntrospectionResult>>
  subscribe(options: GraphqlSubscribePayload): Promise<IpcResult<{ subscriptionId: string }>>
  unsubscribe(subscriptionId: string): Promise<IpcResult<boolean>>
  onSubscriptionEvent(callback: (event: GraphqlSubscriptionEvent) => void): () => void
}

// ─── gRPC ────────────────────────────────────────────────────────

interface GrpcServiceDescription {
  protoPath: string
  packageName: string
  services: Array<{
    name: string
    fullName: string
    methods: Array<{
      name: string
      requestType: string
      responseType: string
      requestStream: boolean
      responseStream: boolean
    }>
  }>
}

interface GrpcExecutePayload {
  serverAddress: string
  protoPath: string
  serviceName: string
  methodName: string
  requestBody: string
  metadata?: Record<string, string>
  timeout?: number
  useTls?: boolean
  sslVerification?: boolean
}

interface GrpcResponse {
  requestId: string
  protocol: 'grpc'
  body?: string
  bodySize?: number
  timing: { total: number }
  error?: string
  grpcStatus?: number
  grpcStatusMessage?: string
  responseMetadata?: Record<string, string>
  actualRequest?: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
  }
}

interface GrpcStreamEvent {
  streamId: string
  type: 'data' | 'end' | 'error' | 'status'
  data?: string
  error?: string
  grpcStatus?: number
  grpcStatusMessage?: string
  timestamp: number
}

interface GrpcClientStreamPayload {
  serverAddress: string
  protoPath: string
  serviceName: string
  methodName: string
  messages: string[]
  metadata?: Record<string, string>
  timeout?: number
  useTls?: boolean
}

interface GrpcBidiStreamPayload {
  serverAddress: string
  protoPath: string
  serviceName: string
  methodName: string
  metadata?: Record<string, string>
  timeout?: number
  useTls?: boolean
}

interface GrpcApi {
  loadProto(): Promise<IpcResult<GrpcServiceDescription | null>>
  execute(options: GrpcExecutePayload): Promise<IpcResult<GrpcResponse>>
  serverStream(options: GrpcExecutePayload): Promise<IpcResult<{ streamId: string }>>
  reflect(address: string, useTls?: boolean): Promise<IpcResult<GrpcServiceDescription>>
  clientStream(options: GrpcClientStreamPayload): Promise<IpcResult<GrpcResponse>>
  bidiStream(options: GrpcBidiStreamPayload): Promise<IpcResult<{ streamId: string }>>
  sendStreamMessage(streamId: string, message: string): Promise<IpcResult<boolean>>
  endStream(streamId: string): Promise<IpcResult<boolean>>
  cancelStream(streamId: string): Promise<IpcResult<boolean>>
  onStreamEvent(callback: (event: GrpcStreamEvent) => void): () => void
}

// ─── SSE ─────────────────────────────────────────────────────────

interface SseConnectPayload {
  url: string
  headers?: Record<string, string>
  lastEventId?: string
  withCredentials?: boolean
}

interface SseConnectionInfo {
  connectionId: string
  url: string
  readyState: number
  connectedAt: number
}

interface SseEventPayload {
  connectionId: string
  type: 'open' | 'event' | 'error'
  eventType?: string
  data?: string
  id?: string
  retry?: number
  timestamp: number
}

interface SseApi {
  connect(options: SseConnectPayload): Promise<IpcResult<SseConnectionInfo>>
  disconnect(connectionId: string): Promise<IpcResult<boolean>>
  onEvent(callback: (event: SseEventPayload) => void): () => void
}

// ─── Updater ──────────────────────────────────────────────────────

interface UpdaterEventPayload {
  type: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string | Array<{ version: string; note: string }>
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  error?: string
}

interface UpdaterApi {
  check(): Promise<IpcResult<null>>
  download(): Promise<IpcResult<null>>
  install(): Promise<IpcResult<null>>
  onEvent(callback: (event: UpdaterEventPayload) => void): () => void
}

interface WindowApi {
  toggleMaximize(): Promise<IpcResult<boolean>>
}

// ─── Branch ──────────────────────────────────────────────────────

interface BranchApi {
  list(projectId: string): Promise<IpcResult<Branch[]>>
  get(id: string): Promise<IpcResult<Branch | undefined>>
  create(payload: { project_id: string; name: string; parent_branch_id?: string | null }): Promise<IpcResult<Branch>>
  rename(id: string, name: string): Promise<IpcResult<Branch | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
  ensureDefault(projectId: string): Promise<IpcResult<Branch>>
}

// ─── Save ────────────────────────────────────────────────────────

interface SaveLocalResult {
  path: string
  fileName: string
}

interface SaveGitResult {
  repoUrl: string
  branch: string
}

interface SaveGitListResult {
  tmpDir: string
  files: Array<{ name: string; path: string; size: number }>
}

interface SaveHistoryRow {
  id: string
  project_id: string
  mode: string
  path: string
  message: string
  timestamp: number
}

interface GitPushResult {
  repoUrl: string
  branch: string
  message?: string
  noChanges?: boolean
}

interface GitPullResult {
  imported: {
    folders: number
    endpoints: number
    savedRequests: number
    environments: number
    environmentVariables: number
    globalVariables: number
  }
}

interface GitConfigResult {
  repoUrl: string
  username: string
  branch: string
  hasToken: boolean
}

interface SaveApi {
  local(payload: { projectId: string; directoryPath?: string }): Promise<IpcResult<SaveLocalResult>>
  selectDirectory(): Promise<IpcResult<string>>
  git(payload: {
    projectId: string
    repoUrl: string
    branch: string
    username: string
    token: string
    commitMessage: string
  }): Promise<IpcResult<SaveGitResult>>
  storeGitToken(payload: { repoUrl: string; username: string; token: string }): Promise<IpcResult<boolean>>
  gitPush(payload: { projectId: string; commitMessage?: string }): Promise<IpcResult<GitPushResult>>
  gitPull(payload: { projectId: string }): Promise<IpcResult<GitPullResult>>
  gitConfig(projectId: string): Promise<IpcResult<GitConfigResult | null>>
  gitListFiles(payload: {
    repoUrl: string
    branch: string
    username: string
    token: string
  }): Promise<IpcResult<SaveGitListResult>>
  gitReadFile(filePath: string): Promise<IpcResult<unknown>>
  gitCleanup(tmpDir: string): Promise<IpcResult<undefined>>
  getGitCredentials(): Promise<IpcResult<Record<string, unknown>>>
  history(projectId: string): Promise<IpcResult<SaveHistoryRow[]>>
}

interface ApiBridge {
  window: WindowApi
  request: RequestApi
  workspace: WorkspaceApi
  project: ProjectApi
  folder: FolderApi
  endpoint: EndpointApi
  endpointCase: EndpointCaseApi
  savedRequest: SavedRequestApi
  environment: EnvironmentApi
  envVariable: EnvVariableApi
  globalVariable: GlobalVariableApi
  history: HistoryApi
  settings: SettingsApi
  importExport: ImportExportApi
  soap: SoapApi
  ws: WsApi
  runner: RunnerApi
  graphql: GraphqlApi
  grpc: GrpcApi
  sse: SseApi
  updater: UpdaterApi
  branch: BranchApi
  save: SaveApi
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ApiBridge
  }
}
