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
  WsSecurityConfig,
  WsMessage,
  Branch,
  MockServer,
  MockEndpoint,
  MockResponse,
  MockServerStatus,
  MockLogEntry,
  SaveHistoryEntry,
  TestSuiteRow,
  TestSuiteItemRow,
  TestSuiteFolderRow,
  TestSuiteContents,
} from '../renderer/types'

// ─── Auth ────────────────────────────────────────────────────────

interface AuthUser {
  id: string
  email: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  authProvider: string
  recoveryEmail: string | null
  createdAt: number
  updatedAt: number
}

interface AuthSession {
  token: string
  userId: string
  createdAt?: number
  expiresAt?: number
}

interface AuthSessionInfo {
  user: AuthUser
  session: AuthSession
}

interface AuthApi {
  hasPassword(): Promise<IpcResult<{ hasPassword: boolean }>>
  setPassword(payload: {
    password: string
    recoveryEmail?: string
  }): Promise<IpcResult<AuthSessionInfo>>
  login(payload: { password: string }): Promise<IpcResult<AuthSessionInfo>>
  getSession(token: string): Promise<IpcResult<AuthSessionInfo | null>>
  logout(token: string): Promise<IpcResult<boolean>>
  changePassword(payload: {
    userId: string
    currentPassword: string
    newPassword: string
  }): Promise<IpcResult<boolean>>
  disablePassword(payload: { userId: string; currentPassword: string }): Promise<IpcResult<boolean>>
  recoverPassword(payload: {
    osPassword: string
    newPassword: string
  }): Promise<IpcResult<AuthSessionInfo>>
  listUsers(): Promise<IpcResult<AuthUser[]>>
}

// ─── EULA / Privacy ──────────────────────────────────────────────

interface EulaConsentRecord {
  accepted: boolean
  acceptedAt: number
  acceptedVersion: string
  acceptedDocsHash: string
}

interface EulaStateData {
  state: EulaConsentRecord
  currentDocsHash: string
  currentVersion: string
  consentValid: boolean
  warning?: string
}

interface EulaApi {
  state(): Promise<IpcResult<EulaStateData>>
  accept(): Promise<IpcResult<EulaConsentRecord>>
  decline(): Promise<IpcResult<{ quitting: boolean }>>
  reset(): Promise<IpcResult<boolean>>
}

// ─── Workspace / Project / Folder ────────────────────────────────

interface WorkspaceApi {
  list(): Promise<IpcResult<Workspace[]>>
  get(id: string): Promise<IpcResult<Workspace | undefined>>
  create(payload: {
    name: string
    description?: string
    color?: string
  }): Promise<IpcResult<Workspace>>
  update(
    id: string,
    payload: { name?: string; description?: string; color?: string },
  ): Promise<IpcResult<Workspace | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface ProjectApi {
  list(workspaceId: string): Promise<IpcResult<Project[]>>
  get(id: string): Promise<IpcResult<Project | undefined>>
  create(payload: {
    workspace_id: string
    name: string
    description?: string
    type?: string
    save_mode?: string
    local_path?: string
    icon_emoji?: string | null
    icon_color?: string | null
    display_name?: string | null
  }): Promise<IpcResult<Project>>
  update(
    id: string,
    payload: {
      name?: string
      description?: string
      type?: string
      save_mode?: string
      local_path?: string | null
      sort_order?: number
      icon_emoji?: string | null
      icon_color?: string | null
      display_name?: string | null
    },
  ): Promise<IpcResult<Project | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
  duplicate(payload: {
    projectId: string
    workspaceId: string
    name?: string
  }): Promise<IpcResult<{ projectId: string }>>
}

interface FolderApi {
  list(projectId: string, branchId?: string | null): Promise<IpcResult<Folder[]>>
  create(payload: {
    project_id: string
    parent_id?: string | null
    name: string
    branch_id?: string | null
  }): Promise<IpcResult<Folder>>
  update(
    id: string,
    payload: { name?: string; parent_id?: string | null; sort_order?: number },
  ): Promise<IpcResult<Folder | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
  duplicate(id: string): Promise<IpcResult<{ newFolderId: string }>>
}

interface EndpointApi {
  listByProject(projectId: string, branchId?: string | null): Promise<IpcResult<Endpoint[]>>
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
  update(
    id: string,
    payload: Partial<Omit<Endpoint, 'id' | 'project_id' | 'created_at'>>,
  ): Promise<IpcResult<Endpoint | undefined>>
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
  list(projectId: string, branchId?: string | null): Promise<IpcResult<SavedRequest[]>>
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
    branch_id?: string | null
  }): Promise<IpcResult<SavedRequest>>
  update(
    id: string,
    payload: Partial<{
      project_id: string | null
      folder_id: string | null
      name: string
      protocol: string
      method: string
      url: string
      params: string
      headers: string
      body: string
      auth: string
      pre_script: string
      post_script: string
      assertions: string
      metadata: string
      sort_order: number
      updated_at: number
    }>,
  ): Promise<IpcResult<SavedRequest | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface EnvironmentApi {
  list(workspaceId: string): Promise<IpcResult<Environment[]>>
  listByProject(projectId: string): Promise<IpcResult<Environment[]>>
  get(id: string): Promise<IpcResult<Environment | undefined>>
  create(payload: {
    workspace_id: string
    project_id?: string | null
    name: string
    is_active?: boolean
  }): Promise<IpcResult<Environment>>
  update(
    id: string,
    payload: { name?: string; is_active?: boolean },
  ): Promise<IpcResult<Environment | undefined>>
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
  update(
    id: string,
    payload: Partial<EnvironmentVariable> & { initial_value?: string },
  ): Promise<IpcResult<EnvironmentVariable | undefined>>
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
  update(
    id: string,
    payload: {
      key?: string
      value?: string
      description?: string
      enabled?: boolean
      secret?: boolean
      initial_value?: string
    },
  ): Promise<IpcResult<GlobalVariable | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface HistoryApi {
  list(options: {
    workspace_id?: string
    project_id?: string
    limit?: number
    offset?: number
  }): Promise<IpcResult<HistoryEntry[]>>
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
  clear(scope?: string | { workspace_id?: string; project_id?: string }): Promise<IpcResult<number>>
  delete(id: string): Promise<IpcResult<boolean>>
  prune(limit: number, workspaceId?: string): Promise<IpcResult<number>>
}

// ─── Settings ────────────────────────────────────────────────────

interface SettingsApi {
  getAll(): Promise<IpcResult<AppSettings>>
  get(key: string): Promise<IpcResult<unknown>>
  set(key: string, value: unknown): Promise<IpcResult<boolean>>
  setAll(settings: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
  reset(): Promise<IpcResult<AppSettings>>
}

// ─── Request ─────────────────────────────────────────────────────

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
    maxRedirects?: number
    sslVerification?: boolean
    proxy?: unknown
    /**
     * Per-project TLS overrides (resolved into engine-shape `tls` in the
     * request handler). The renderer sends preset names; the main process
     * maps them to the actual OpenSSL cipher string.
     */
    tls?: {
      minVersion?: string
      maxVersion?: string
      cipherPreset?: 'modern' | 'intermediate' | 'legacy' | 'custom'
      ciphersCustom?: string
    }
    _workspaceId?: string
    _projectId?: string
    _endpointId?: string
    _protocol?: string
    _requestId?: string
    _tabId?: string
  }): Promise<IpcResult<ApiResponse>>
  cancel(requestId: string): Promise<IpcResult<boolean>>
}

// ─── Console (Postman-style streaming logs) ──────────────────────

interface ConsoleLogEntryDto {
  id: string
  timestamp: number
  protocol: 'http' | 'soap' | 'grpc' | 'websocket' | 'graphql' | 'sse'
  level: 'info' | 'success' | 'warning' | 'error'
  category: 'request' | 'response' | 'event' | 'connection' | 'system'
  tabId?: string
  method?: string
  url?: string
  status?: number
  statusText?: string
  durationMs?: number
  sizeBytes?: number
  message?: string
  details?: {
    requestHeaders?: Record<string, string>
    requestBody?: string
    responseHeaders?: Record<string, string>
    responseBody?: string
    error?: { message: string; stack?: string }
    direction?: 'in' | 'out'
    eventName?: string
    meta?: Record<string, string | number | boolean>
  }
}

interface ConsoleApi {
  /**
   * Subscribe to streaming console:log events emitted by the main
   * process. Returns a teardown function.
   */
  onLog(callback: (entry: ConsoleLogEntryDto) => void): () => void
}

// ─── Import / Export ─────────────────────────────────────────────

interface ImportExportApi {
  openFile(): Promise<IpcResult<{ filePath: string; content: string } | null>>
  importOpenApi(payload: {
    projectId: string
    content: string
    format: string
    folderId?: string | null
    sourceUrl?: string
  }): Promise<IpcResult<ImportResult>>
  exportOpenApi(projectId: string): Promise<IpcResult<string>>
  saveFile(content: string, defaultName: string): Promise<IpcResult<string | null>>
  importPostman(payload: {
    projectId: string
    content: string
    folderId?: string | null
  }): Promise<IpcResult<ImportResult>>
  importPostmanEnvironment(payload: {
    projectId: string
    content: string
  }): Promise<IpcResult<ImportResult>>
  exportPostman(projectId: string): Promise<IpcResult<string>>
  importHar(payload: {
    projectId: string
    content: string
    folderId?: string | null
  }): Promise<IpcResult<ImportResult>>
  importInsomnia(payload: {
    projectId: string
    content: string
    folderId?: string | null
  }): Promise<IpcResult<ImportResult>>
  importInsomniaEnvironment(payload: {
    projectId: string
    content: string
  }): Promise<IpcResult<ImportResult>>
  exportInsomnia(projectId: string): Promise<IpcResult<string>>
  importCurl(payload: {
    projectId: string
    curlCommand: string
    folderId?: string | null
  }): Promise<IpcResult<ImportResult>>
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
  importSoapUi(payload: {
    projectId: string
    content: string
    folderId?: string | null
  }): Promise<IpcResult<ImportResult>>
  importRaml(payload: {
    projectId: string
    content: string
    folderId?: string | null
  }): Promise<IpcResult<ImportResult>>
  parseWsdlForImport(url: string): Promise<IpcResult<WsdlParseResult>>
  parseWsdlFileForImport(content: string): Promise<IpcResult<WsdlParseResult>>
  importProto(payload: {
    projectId: string
    protoPath: string
    folderId?: string | null
    serverAddress?: string
  }): Promise<IpcResult<ImportResult>>
  fetchUrl(url: string): Promise<IpcResult<string | Record<string, unknown>>>
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

// ─── SOAP ────────────────────────────────────────────────────────

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

// ─── WebSocket ───────────────────────────────────────────────────

interface WsConnectOptions {
  url: string
  headers?: Record<string, string>
  protocols?: string[]
  rejectUnauthorized?: boolean
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
  _pendingId?: string
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
  cancelConnect(pendingId: string): Promise<IpcResult<{ canceled: boolean }>>
  disconnect(connectionId: string): Promise<IpcResult<boolean>>
  send(connectionId: string, message: string): Promise<IpcResult<boolean>>
  onEvent(callback: (event: WsEventPayload) => void): () => void
}

// ─── Collection Runner ───────────────────────────────────────────

interface RunnerExecuteOptions {
  projectId: string
  endpointIds: string[]
  environmentId?: string
  workspaceId?: string
  delay?: number
  iterations?: number
  iterationData?: Record<string, string>[]
  stopOnError?: boolean
  /** Persist requestHeaders/requestBody/responseHeaders/responseBody on each
   *  result. Default true; set false to keep memory low for very large runs. */
  persistResponses?: boolean
  /** Postman "Keep variable values" — persist script-written env/global
   *  variables back to the active environment after the run. Default true. */
  keepVariableValues?: boolean
  folderName?: string
  sourceLabel?: string
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
  responseSize?: number
  responseBody?: string
  responseHeaders?: Record<string, string>
  requestHeaders?: Record<string, string>
  requestBody?: string
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
  /** Variables written by scripts during the run (and persisted when
   *  keepVariableValues is on) — renderer refreshes its env store from these. */
  envUpdates?: Record<string, string>
  globalUpdates?: Record<string, string>
}

interface RunnerExportOptions {
  results: EndpointRunResult[]
  format: 'json' | 'html'
}

/**
 * Row shape returned by `runner:history`. Mirrors the `runner_history` DB
 * table; assertion counters use the legacy `*_tests` field names because
 * the underlying SQLite schema predates the renaming.
 */
interface RunnerHistoryEntry {
  id: string
  project_id: string
  environment_name: string | null
  source: string
  source_label: string | null
  iterations: number
  duration_ms: number
  total_endpoints: number
  passed_endpoints: number
  failed_endpoints: number
  total_tests: number
  passed_tests: number
  failed_tests: number
  skipped_tests: number
  avg_resp_time: number
  results_json: string | null
  started_at: number
  folder_name?: string | null
}

interface RunnerHistoryPage {
  rows: RunnerHistoryEntry[]
  total: number
}

interface RunnerHistoryStats {
  runs: number
  totalEndpoints: number
  passedEndpoints: number
  failedEndpoints: number
}

interface RunnerApi {
  execute(options: RunnerExecuteOptions): Promise<IpcResult<RunnerReport>>
  stop(): Promise<IpcResult<boolean>>
  export(options: RunnerExportOptions): Promise<IpcResult<string>>
  onProgress(callback: (progress: RunnerProgress) => void): () => void
  /**
   * String argument → returns a flat `RunnerHistoryEntry[]` (legacy shape).
   * Object argument → returns `{ rows, total }` for paginated views.
   */
  history(arg: string): Promise<IpcResult<RunnerHistoryEntry[]>>
  history(arg: {
    projectId: string
    limit?: number
    offset?: number
    tab?: 'Functional' | 'Scheduled'
  }): Promise<IpcResult<RunnerHistoryPage>>
  historyStats(projectId: string): Promise<IpcResult<RunnerHistoryStats>>
  deleteHistory(ids: string | string[]): Promise<IpcResult<boolean>>
}

// ─── Scheduler ───────────────────────────────────────────────────

type SchedulerScheduleType = 'interval' | 'daily' | 'weekly' | 'cron'

interface ScheduledTaskRow {
  id: string
  project_id: string
  name: string
  endpoint_ids: string
  folder_id: string | null
  environment_id: string | null
  interval_value: number
  interval_unit: string
  delay_ms: number
  enabled: number
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
  schedule_type: SchedulerScheduleType | null
  schedule_time: string | null
  schedule_days: string | null
  schedule_cron: string | null
  suite_id: string | null
}

interface SchedulerCreatePayload {
  projectId: string
  name: string
  endpointIds: string[]
  folderId?: string
  environmentId?: string
  intervalValue: number
  intervalUnit: 'minutes' | 'hours' | 'days'
  delayMs?: number
  scheduleType?: SchedulerScheduleType
  scheduleTime?: string
  scheduleDays?: number[]
  scheduleCron?: string
  suiteId?: string
}

interface SchedulerUpdatePayload extends SchedulerCreatePayload {
  id: string
}

interface SchedulerRunCompletedEvent {
  taskId: string
  taskName: string
  report: RunnerReport
}

interface SchedulerHistoryRow {
  id: string
  project_id: string
  environment_name: string | null
  source: string
  source_label: string | null
  scheduled_task_id: string | null
  iterations: number
  duration_ms: number
  total_endpoints: number
  passed_endpoints: number
  failed_endpoints: number
  total_tests: number
  passed_tests: number
  failed_tests: number
  skipped_tests: number
  avg_resp_time: number
  results_json: string | null
  started_at: number
  folder_name: string | null
}

interface SchedulerApi {
  create(payload: SchedulerCreatePayload): Promise<IpcResult<ScheduledTaskRow>>
  update(payload: SchedulerUpdatePayload): Promise<IpcResult<ScheduledTaskRow>>
  list(projectId: string): Promise<IpcResult<ScheduledTaskRow[]>>
  delete(taskId: string): Promise<IpcResult<boolean>>
  toggle(taskId: string): Promise<IpcResult<{ enabled: number }>>
  history(taskId: string): Promise<IpcResult<SchedulerHistoryRow[]>>
  taskEndpoints(taskId: string): Promise<
    IpcResult<{
      items: Array<{ id: string; name: string; method: string | null; url: string | null }>
      source: 'suite' | 'apis' | 'empty'
    }>
  >
  runNow(taskId: string): Promise<IpcResult<boolean>>
  validateCron(expr: string): Promise<IpcResult<{ valid: boolean }>>
  onRunCompleted(callback: (event: SchedulerRunCompletedEvent) => void): () => void
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
  timing: {
    total: number
    dns?: number
    tcp?: number
    tls?: number
    ttfb?: number
    download?: number
  }
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
  introspect(
    url: string,
    headers?: Record<string, string>,
  ): Promise<IpcResult<GraphqlIntrospectionResult>>
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
      requestSkeleton?: string
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
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
  _requestId?: string
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
  /**
   * `false` for `client_streaming` (unary response delivered via callback);
   * `true` (or omitted) for `bidi_streaming` (server emits a stream).
   */
  responseStream?: boolean
}

interface GrpcApi {
  loadProto(): Promise<IpcResult<GrpcServiceDescription | null>>
  loadProtoFromUrl(url: string): Promise<IpcResult<GrpcServiceDescription>>
  execute(options: GrpcExecutePayload): Promise<IpcResult<GrpcResponse>>
  serverStream(options: GrpcExecutePayload): Promise<IpcResult<{ streamId: string }>>
  reflect(address: string, useTls?: boolean): Promise<IpcResult<GrpcServiceDescription>>
  clientStream(options: GrpcClientStreamPayload): Promise<IpcResult<GrpcResponse>>
  bidiStream(options: GrpcBidiStreamPayload): Promise<IpcResult<{ streamId: string }>>
  sendStreamMessage(streamId: string, message: string): Promise<IpcResult<boolean>>
  endStream(streamId: string): Promise<IpcResult<boolean>>
  cancelStream(streamId: string): Promise<IpcResult<boolean>>
  cancelUnary(requestId: string): Promise<IpcResult<{ canceled: boolean }>>
  onStreamEvent(callback: (event: GrpcStreamEvent) => void): () => void
}

// ─── SSE ─────────────────────────────────────────────────────────

interface SseConnectPayload {
  url: string
  headers?: Record<string, string>
  lastEventId?: string
  withCredentials?: boolean
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: string
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
  _pendingId?: string
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
  httpStatus?: number
  timestamp: number
}

interface SseApi {
  connect(options: SseConnectPayload): Promise<IpcResult<SseConnectionInfo>>
  cancelConnect(pendingId: string): Promise<IpcResult<{ canceled: boolean }>>
  disconnect(connectionId: string): Promise<IpcResult<boolean>>
  onEvent(callback: (event: SseEventPayload) => void): () => void
}

// ─── AI Chat ─────────────────────────────────────────────────────

type AiProviderId =
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'google'
  | 'deepseek'
  | 'xai'
  | 'mistral'
  | 'groq'
  | 'perplexity'
  | 'cerebras'
  | 'cohere'
  | 'fireworks'
  | 'deepinfra'
  | 'together'
  | 'custom'

interface AiChatSendPayload {
  provider: AiProviderId
  url?: string
  apiKey: string
  model: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  temperature?: number
  maxTokens?: number
}

interface AiChatChunkEvent {
  messageId: string
  delta: string
}

interface AiChatDoneEvent {
  messageId: string
}

interface AiChatErrorEvent {
  messageId: string
  error: string
}

interface AiChatApi {
  send(payload: AiChatSendPayload): Promise<IpcResult<{ messageId: string }>>
  cancel(messageId: string): Promise<IpcResult<{ cancelled: boolean }>>
  onChunk(callback: (event: AiChatChunkEvent) => void): () => void
  onDone(callback: (event: AiChatDoneEvent) => void): () => void
  onError(callback: (event: AiChatErrorEvent) => void): () => void
  onCancelled(callback: (event: AiChatDoneEvent) => void): () => void
}

// ─── MCP ─────────────────────────────────────────────────────────

interface McpConnectOptions {
  transport: 'http' | 'sse' | 'stdio'
  url: string
  _pendingId?: string
}

interface McpToolDto {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

interface McpApi {
  connect(
    options: McpConnectOptions,
  ): Promise<IpcResult<{ connectionId: string; serverName?: string }>>
  cancelConnect(pendingId: string): Promise<IpcResult<{ canceled: boolean }>>
  disconnect(connectionId: string): Promise<IpcResult<boolean>>
  listTools(connectionId: string): Promise<IpcResult<McpToolDto[]>>
  callTool(
    connectionId: string,
    toolName: string,
    args: unknown,
    ctx?: { workspaceId?: string; projectId?: string; endpointId?: string },
  ): Promise<IpcResult<unknown>>
}

// ─── Socket.IO ───────────────────────────────────────────────────

interface SocketIOConnectOptions {
  url: string
  namespace?: string
  bearerToken?: string
  /** Socket.IO `auth.*` payload sent during the namespace handshake. */
  auth?: Record<string, unknown>
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
  _pendingId?: string
}

interface SocketIOEventPayload {
  connectionId: string
  direction: 'in' | 'out'
  event: string
  data: unknown
  timestamp: number
}

interface SocketIOApi {
  connect(options: SocketIOConnectOptions): Promise<IpcResult<{ connectionId: string }>>
  cancelConnect(pendingId: string): Promise<IpcResult<{ canceled: boolean }>>
  disconnect(connectionId: string): Promise<IpcResult<boolean>>
  emit(connectionId: string, eventName: string, data: unknown): Promise<IpcResult<boolean>>
  subscribe(connectionId: string, eventName: string): Promise<IpcResult<boolean>>
  unsubscribe(connectionId: string, eventName: string): Promise<IpcResult<boolean>>
  onEvent(callback: (event: SocketIOEventPayload) => void): () => void
}

// ─── Updater ─────────────────────────────────────────────────────

interface UpdaterEventPayload {
  type: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string | Array<{ version: string; note: string }>
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  error?: string
  message?: string
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

interface AppApi {
  version(): Promise<IpcResult<{ version: string; name: string }>>
  openExternal(url: string): Promise<IpcResult<null>>
  onOpenAbout(callback: () => void): () => void
  onMenuCommand(callback: (command: string) => void): () => void
}

// ─── Branch (DB-backed, non-Git) ─────────────────────────────────

interface BranchApi {
  list(projectId: string): Promise<IpcResult<Branch[]>>
  get(id: string): Promise<IpcResult<Branch | undefined>>
  create(payload: {
    project_id: string
    name: string
    parent_branch_id?: string | null
  }): Promise<IpcResult<Branch>>
  rename(id: string, name: string): Promise<IpcResult<Branch | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
  ensureDefault(projectId: string): Promise<IpcResult<Branch>>
}

// ─── Git (real Git operations) ───────────────────────────────────

interface GitBranchInfo {
  name: string
  current: boolean
  isRemote: boolean
}

interface GitConflictInfo {
  file: string
  stats: {
    ours: GitConflictStats
    theirs: GitConflictStats
  }
}

interface GitConflictStats {
  endpoints: number
  savedRequests: number
  folders: number
  testSuites: number
  mockServers: number
  mockEndpoints: number
  environments: number
  certificates: number
  parsable: boolean
}

interface GitListBranchesResult {
  branches: GitBranchInfo[]
  current: string
}

interface GitMergeResult {
  merged: boolean
  state: 'clean' | 'conflicted'
  currentBranch: string
  sourceBranch: string
  conflicts?: GitConflictInfo[]
}

interface GitPullOutcome {
  pulled: boolean
  state: 'clean' | 'conflicted'
  branch: string
  conflicts?: GitConflictInfo[]
}

interface GitPushOutcome {
  branch: string
  pushed: boolean
}

interface GitStatusResult {
  branch: string
  modified: string[]
  not_added: string[]
  created: string[]
  deleted: string[]
  staged: string[]
  conflicted: string[]
  commits: Array<{
    hash: string
    message: string
    date: string
    author: string
  }>
}

interface GitResolveConflictResult {
  file: string
  side: 'ours' | 'theirs'
  stillConflicted: boolean
  committed: boolean
  remainingConflicts: string[]
}

interface GitLogEntry {
  hash: string
  fullHash: string
  message: string
  date: string
  author: string
}

interface GitHasConfigResult {
  hasGit: boolean
}

interface GitApi {
  hasConfig(projectId: string): Promise<IpcResult<GitHasConfigResult>>
  listBranches(projectId: string): Promise<IpcResult<GitListBranchesResult>>
  currentBranch(projectId: string): Promise<IpcResult<string>>
  createBranch(payload: {
    projectId: string
    branchName: string
    baseBranch?: string
  }): Promise<IpcResult<{ branch: string }>>
  switchBranch(payload: {
    projectId: string
    branchName: string
  }): Promise<IpcResult<{ branch: string }>>
  merge(payload: { projectId: string; sourceBranch: string }): Promise<IpcResult<GitMergeResult>>
  push(projectId: string): Promise<IpcResult<GitPushOutcome>>
  pull(projectId: string): Promise<IpcResult<GitPullOutcome>>
  status(projectId: string): Promise<IpcResult<GitStatusResult>>
  deleteBranch(payload: {
    projectId: string
    branchName: string
  }): Promise<IpcResult<{ deleted: string }>>
  log(payload: { projectId: string; count?: number }): Promise<IpcResult<GitLogEntry[]>>
  listCommits(payload: {
    projectId: string
    branch?: string
    limit?: number
    skip?: number
  }): Promise<
    IpcResult<{
      commits: Array<{
        hash: string
        shortHash: string
        message: string
        date: string
        author: string
        email: string
        refs?: string
      }>
      total: number
    }>
  >
  resolveConflict(payload: {
    projectId: string
    file: string
    side: 'ours' | 'theirs'
    commitMessage?: string
  }): Promise<IpcResult<GitResolveConflictResult>>
  abortMerge(projectId: string): Promise<IpcResult<{ aborted: boolean }>>
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
  selectFile(): Promise<IpcResult<{ filePath: string; project: unknown }>>
  importLocal(payload: { filePath: string; projectId: string }): Promise<IpcResult<unknown>>
  selectDirectory(): Promise<IpcResult<string>>
  git(payload: {
    projectId: string
    repoUrl: string
    branch: string
    username: string
    token: string
    commitMessage: string
  }): Promise<IpcResult<SaveGitResult>>
  storeGitToken(payload: {
    repoUrl: string
    username: string
    token: string
  }): Promise<IpcResult<boolean>>
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
  gitDiff(payload: { projectId: string; direction: 'push' | 'pull' }): Promise<IpcResult<unknown>>
  history(projectId: string): Promise<IpcResult<SaveHistoryEntry[]>>
  exportProject(projectId: string): Promise<IpcResult<{ path: string }>>
  exportFolder(folderId: string): Promise<IpcResult<{ path: string }>>
  exportTestSuite(suiteId: string): Promise<IpcResult<{ path: string }>>
  importProject(payload: {
    workspaceId: string
    name?: string
  }): Promise<IpcResult<{ projectId: string }>>
  importProjectFromContent(payload: {
    workspaceId: string
    content: string
    name?: string
  }): Promise<IpcResult<{ projectId: string }>>
  importFolder(payload: {
    projectId: string
    parentFolderId?: string | null
    content?: string
  }): Promise<IpcResult<{ foldersImported: number; endpointsImported: number }>>
  importTestSuite(payload: {
    projectId: string
    content?: string
    suiteName?: string
  }): Promise<IpcResult<{ suiteId: string; itemsImported: number }>>
}

// ─── Test Suite ──────────────────────────────────────────────────

interface CreateTestSuitePayload {
  project_id: string
  name: string
  description?: string | null
}

interface UpdateTestSuitePayload {
  name?: string
  description?: string | null
  sort_order?: number
}

interface ImportEndpointsPayload {
  suite_id: string
  endpoint_ids: string[]
  folder_id?: string | null
}

interface RemoveEndpointPayload {
  suite_id: string
  item_id: string
}

interface TestSuiteApi {
  list(projectId: string): Promise<IpcResult<TestSuiteRow[]>>
  get(id: string): Promise<IpcResult<TestSuiteRow | undefined>>
  create(payload: CreateTestSuitePayload): Promise<IpcResult<TestSuiteRow>>
  update(id: string, payload: UpdateTestSuitePayload): Promise<IpcResult<TestSuiteRow | undefined>>
  delete(id: string): Promise<IpcResult<boolean>>
  duplicate(id: string): Promise<IpcResult<TestSuiteRow>>
  /** Returns `{ items, folders }` — both arrays of repo rows. */
  listEndpoints(suiteId: string): Promise<IpcResult<TestSuiteContents>>
  /** Snapshots endpoints from APIs tree and writes them as suite items. */
  importEndpoints(payload: ImportEndpointsPayload): Promise<IpcResult<{ added: number }>>
  removeEndpoint(payload: RemoveEndpointPayload): Promise<IpcResult<boolean>>
}

interface CreateTestSuiteItemInput {
  suite_id: string
  folder_id?: string | null
  protocol: string
  name: string
  method?: string | null
  url?: string | null
  request_schema?: string
  assertions?: string | null
  source_endpoint_id?: string | null
}

interface UpdateTestSuiteItemInput {
  name?: string
  protocol?: string
  method?: string | null
  url?: string | null
  request_schema?: string
  assertions?: string | null
  folder_id?: string | null
  sort_order?: number
}

interface MoveTestSuiteItemPayload {
  id: string
  targetSuiteId: string
  targetFolderId: string | null
  insertBeforeId: string | null
}

interface TestSuiteItemApi {
  list(suiteId: string): Promise<IpcResult<TestSuiteItemRow[]>>
  get(id: string): Promise<IpcResult<TestSuiteItemRow | undefined>>
  create(input: CreateTestSuiteItemInput): Promise<IpcResult<TestSuiteItemRow>>
  update(id: string, patch: UpdateTestSuiteItemInput): Promise<IpcResult<TestSuiteItemRow>>
  delete(id: string): Promise<IpcResult<{ deleted: boolean }>>
  move(payload: MoveTestSuiteItemPayload): Promise<IpcResult<TestSuiteItemRow>>
}

interface CreateTestSuiteFolderInput {
  suite_id: string
  parent_id?: string | null
  name: string
}

interface MoveTestSuiteFolderPayload {
  id: string
  targetSuiteId: string
  targetParentId: string | null
  insertBeforeId: string | null
}

interface TestSuiteFolderApi {
  create(input: CreateTestSuiteFolderInput): Promise<IpcResult<TestSuiteFolderRow>>
  rename(id: string, name: string): Promise<IpcResult<TestSuiteFolderRow>>
  delete(id: string): Promise<IpcResult<{ deleted: boolean }>>
  move(payload: MoveTestSuiteFolderPayload): Promise<IpcResult<TestSuiteFolderRow>>
}

// ─── Tree drag-drop ──────────────────────────────────────────────

interface TreeApi {
  move(payload: {
    nodeId: string
    nodeType: 'folder' | 'endpoint' | 'request'
    targetFolderId: string | null
    insertBeforeId?: string | null
  }): Promise<IpcResult<true>>
}

// ─── Mock Server ─────────────────────────────────────────────────

interface MockServerStatusInfo {
  status: MockServerStatus
  port?: number | null
  errorMessage?: string | null
  startedAt?: number | null
}

interface MockServerStatusEvent {
  serverId: string
  status: MockServerStatus
  errorMessage: string | null
}

interface MockImportResult {
  ok: boolean
  endpointsCreated: number
  responsesCreated: number
  warnings: string[]
  error?: string
}

interface MockServerCreatePayload {
  projectId: string
  name: string
  port: number
  host?: string
  basePath?: string
  description?: string
  autoStart?: boolean
}

interface MockServerSubApi {
  list(projectId: string): Promise<IpcResult<MockServer[]>>
  get(id: string): Promise<IpcResult<MockServer | undefined>>
  create(input: MockServerCreatePayload): Promise<IpcResult<MockServer>>
  update(id: string, patch: Partial<MockServer>): Promise<IpcResult<MockServer>>
  delete(id: string): Promise<IpcResult<boolean>>
  start(id: string): Promise<IpcResult<MockServerStatusInfo>>
  stop(id: string): Promise<IpcResult<MockServerStatusInfo>>
  status(id: string): Promise<IpcResult<MockServerStatusInfo>>
}

interface MockEndpointCreatePayload {
  serverId: string
  path: string
  /** Loose string since renderer may pass any HTTP method label. */
  method?: string
  pathMode?: 'exact' | 'param' | 'wildcard' | 'regex'
  description?: string
  priority?: number
  enabled?: boolean
  sortOrder?: number
}

interface MockEndpointSubApi {
  list(serverId: string): Promise<IpcResult<MockEndpoint[]>>
  get(id: string): Promise<IpcResult<MockEndpoint | undefined>>
  create(input: MockEndpointCreatePayload): Promise<IpcResult<MockEndpoint>>
  update(id: string, patch: Partial<MockEndpoint>): Promise<IpcResult<MockEndpoint>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface MockResponseSubApi {
  list(endpointId: string): Promise<IpcResult<MockResponse[]>>
  create(input: Partial<MockResponse> & { endpointId: string }): Promise<IpcResult<MockResponse>>
  update(id: string, patch: Partial<MockResponse>): Promise<IpcResult<MockResponse>>
  delete(id: string): Promise<IpcResult<boolean>>
}

interface MockLogsSubApi {
  get(serverId: string): Promise<IpcResult<MockLogEntry[]>>
  clear(serverId: string): Promise<IpcResult<boolean>>
}

interface MockApi {
  server: MockServerSubApi
  endpoint: MockEndpointSubApi
  response: MockResponseSubApi
  logs: MockLogsSubApi
  importOpenApi(serverId: string, source: string): Promise<IpcResult<MockImportResult>>
  importPostman(serverId: string, source: string): Promise<IpcResult<MockImportResult>>
  onLog(callback: (entry: MockLogEntry) => void): () => void
  onStatus(callback: (info: MockServerStatusEvent) => void): () => void
}

// ─── Dialog ──────────────────────────────────────────────────────

interface DialogFileResult {
  filePath: string
  fileName: string
  size: number
}

interface DialogApi {
  openFile(options?: {
    title?: string
    filters?: Array<{ name: string; extensions: string[] }>
    multiSelections?: boolean
  }): Promise<IpcResult<DialogFileResult | DialogFileResult[]>>
}

// ─── Certificate ─────────────────────────────────────────────────

interface CertificateRowDto {
  id: string
  project_id: string
  kind: 'ca' | 'client'
  host: string | null
  crt_path: string | null
  key_path: string | null
  pfx_path: string | null
  passphrase: string | null
  enabled: number
  created_at: number
}

interface CertificateApi {
  list(projectId: string): Promise<IpcResult<CertificateRowDto[]>>
  add(payload: {
    projectId: string
    kind: 'ca' | 'client'
    host?: string
    crtPath?: string
    keyPath?: string
    pfxPath?: string
    passphrase?: string
    enabled?: boolean
  }): Promise<IpcResult<CertificateRowDto>>
  update(payload: {
    id: string
    host?: string
    crtPath?: string
    keyPath?: string
    pfxPath?: string
    passphrase?: string
    enabled?: boolean
  }): Promise<IpcResult<CertificateRowDto>>
  delete(id: string): Promise<IpcResult<boolean>>
  pickFile(kind: 'crt' | 'key' | 'pfx' | 'ca'): Promise<IpcResult<string>>
}

// ─── WSSE ────────────────────────────────────────────────────────

interface WsseVerifyResultDto {
  valid: boolean
  reason?: string
  signedReferences: string[]
  certInfo?: {
    subject?: string
    issuer?: string
    notAfter?: string
    notBefore?: string
  }
}

interface WsseApi {
  apply(payload: { envelope: string; config: WsSecurityConfig }): Promise<IpcResult<string>>
  verify(payload: { envelope: string; certPem: string }): Promise<IpcResult<WsseVerifyResultDto>>
  decrypt(payload: {
    envelope: string
    privateKeyPem: string
    passphrase?: string
  }): Promise<IpcResult<string>>
}

// ─── Diagnostics ─────────────────────────────────────────────────

interface ThirdPartyLicenseEntry {
  name: string
  version: string
  license: string
  repository: string | null
  publisher: string | null
  url: string | null
}

interface ThirdPartyLicensesManifest {
  generatedAt: string
  count: number
  entries: ThirdPartyLicenseEntry[]
}

interface DiagnosticsApi {
  export(): Promise<IpcResult<{ path: string; size: number }>>
  revealLogs(): Promise<IpcResult<null>>
  thirdPartyLicenses(): Promise<IpcResult<ThirdPartyLicensesManifest>>
}

// ─── Aggregate bridge ────────────────────────────────────────────

interface ApiBridge {
  auth: AuthApi
  eula: EulaApi
  window: WindowApi
  app: AppApi
  request: RequestApi
  console: ConsoleApi
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
  wsse: WsseApi
  diagnostics: DiagnosticsApi
  ws: WsApi
  runner: RunnerApi
  scheduler: SchedulerApi
  graphql: GraphqlApi
  grpc: GrpcApi
  sse: SseApi
  aiChat: AiChatApi
  mcp: McpApi
  socketio: SocketIOApi
  updater: UpdaterApi
  branch: BranchApi
  git: GitApi
  save: SaveApi
  certificate: CertificateApi
  testSuite: TestSuiteApi
  testSuiteItem: TestSuiteItemApi
  testSuiteFolder: TestSuiteFolderApi
  tree: TreeApi
  mock: MockApi
  dialog: DialogApi
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ApiBridge
  }
}
