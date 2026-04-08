// src/renderer/types/index.ts
// Apinizer API Tester — TypeScript tip referansı

// ─── Enums ───────────────────────────────────────────────────

export type Protocol = 'http' | 'soap' | 'websocket' | 'graphql' | 'grpc' | 'sse'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type BodyType = 'none' | 'json' | 'xml' | 'text' | 'html' | 'javascript' | 'form-data' | 'urlencoded' | 'binary'
export type AuthType = 'none' | 'basic' | 'bearer' | 'api-key' | 'oauth2' | 'digest' | 'ntlm' | 'aws-signature' | 'hawk'
export type EndpointStatus = 'developing' | 'testing' | 'released' | 'deprecated'
export type Theme = 'light' | 'dark' | 'system'
export type Language = 'tr' | 'en'

// ─── Primitives ──────────────────────────────────────────────

export interface KeyValuePair {
  id: string
  key: string
  value: string
  description?: string
  enabled: boolean
}

export interface SecretKeyValuePair extends KeyValuePair {
  secret: boolean
  initialValue?: string
}

// ─── IPC Result ──────────────────────────────────────────────

export interface IpcResult<T = undefined> {
  success: boolean
  data?: T
  error?: string
}

// ─── Workspace & Project ─────────────────────────────────────

export interface Workspace {
  id: string
  name: string
  description?: string
  color?: string
  created_at: number
  updated_at: number
}

export interface Project {
  id: string
  workspace_id: string
  name: string
  description?: string
  type: 'http' | 'grpc' | 'websocket'
  sort_order: number
  created_at: number
  updated_at: number
}

export interface Folder {
  id: string
  project_id: string
  parent_id: string | null
  name: string
  sort_order: number
}

// ─── Tree Node (UI) ──────────────────────────────────────────

export interface TreeNode {
  id: string
  type: 'module' | 'folder' | 'endpoint' | 'schema' | 'component' | 'request'
  label: string
  method?: HttpMethod | string
  path?: string
  icon?: string
  count?: number
  countColor?: string
  countBg?: string
  italic?: boolean
  children?: TreeNode[]
}

// ─── Endpoint & Request ──────────────────────────────────────

export interface Endpoint {
  id: string
  project_id: string
  folder_id: string | null
  name: string
  description?: string
  protocol: Protocol
  method?: HttpMethod | string
  path: string
  status: EndpointStatus
  request_schema?: string     // JSON serialized
  response_schemas?: string   // JSON serialized
  sort_order: number
  created_at: number
  updated_at: number
}

export interface EndpointCase {
  id: string
  endpoint_id: string
  name: string
  params?: KeyValuePair[]
  headers?: KeyValuePair[]
  body?: RequestBody
  auth?: AuthConfig
  assertions?: TestAssertion[]
  is_default: boolean
  created_at: number
}

export interface SavedRequest {
  id: string
  project_id: string | null
  folder_id: string | null
  name: string
  protocol: Protocol
  method?: HttpMethod | string
  url: string
  params: KeyValuePair[]
  headers: KeyValuePair[]
  body?: RequestBody
  auth?: AuthConfig
  pre_script?: string
  post_script?: string
  assertions: TestAssertion[]
  metadata?: SoapMetadata | GrpcMetadata | Record<string, any>
  sort_order: number
  created_at: number
  updated_at: number
}

// ─── Request Body & Auth ─────────────────────────────────────

export interface RequestBody {
  type: BodyType
  content?: string
  formData?: KeyValuePair[]
  urlEncoded?: KeyValuePair[]
  binaryPath?: string
}

export interface AuthConfig {
  type: AuthType
  basic?: { username: string; password: string }
  bearer?: { token: string; prefix?: string }
  apiKey?: { key: string; value: string; in: 'header' | 'query' }
  oauth2?: OAuth2Config
  digest?: { username: string; password: string }
  ntlm?: { username: string; password: string; domain?: string; workstation?: string }
  hawk?: { authId: string; authKey: string; algorithm: 'sha1' | 'sha256' }
  awsSignature?: { accessKey: string; secretKey: string; region: string; service: string }
}

export interface OAuth2Config {
  grantType: 'authorization_code' | 'client_credentials' | 'password' | 'implicit'
  tokenUrl: string
  authUrl?: string
  clientId: string
  clientSecret?: string
  scope?: string
  token?: string
  refreshToken?: string
  tokenExpiry?: number
}

// ─── SOAP ────────────────────────────────────────────────────

export interface SoapMetadata {
  wsdlUrl: string
  serviceName?: string
  portName?: string
  operationName?: string
  soapVersion?: 'soap11' | 'soap12'
  namespace?: string
  inputSchema?: Record<string, any>
  outputSchema?: Record<string, any>
  wsSecurity?: WsSecurityConfig
}

export interface WsSecurityConfig {
  enabled: boolean
  type: 'username-token' | 'timestamp'
  username?: string
  password?: string
  passwordType?: 'PasswordText' | 'PasswordDigest'
  addTimestamp?: boolean
}

export interface WsdlParseResult {
  services: WsdlService[]
  endpointUrl: string
  soapVersion: 'soap11' | 'soap12'
  rawWsdl: string
}

export interface WsdlService {
  name: string
  ports: WsdlPort[]
}

export interface WsdlPort {
  name: string
  endpointUrl: string
  operations: WsdlOperation[]
}

export interface WsdlOperation {
  name: string
  soapAction: string
  inputSchema: Record<string, any>
  outputSchema: Record<string, any>
  exampleRequest: string
  exampleResponse: string
}

// ─── gRPC ────────────────────────────────────────────────────

export interface GrpcMetadata {
  protoPath?: string
  serverReflection?: boolean
  serviceName?: string
  methodName?: string
  useTls?: boolean
}

// ─── Response ────────────────────────────────────────────────

export interface ResponseTiming {
  total: number
  dns?: number
  tcp?: number
  tls?: number
  ttfb?: number
  download?: number
}

export interface ApiResponse {
  requestId: string
  protocol: Protocol
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  bodySize?: number
  timing: ResponseTiming
  error?: string
  cookies?: ResponseCookie[]
  actualRequest?: ActualRequestInfo
  consoleLogs?: ConsoleLog[]
  testResults?: TestResult[]
  wsMessages?: WsMessage[]
  sseEvents?: SseEvent[]
}

export interface ResponseCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
}

export interface ActualRequestInfo {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface ConsoleLog {
  level: 'log' | 'warn' | 'error'
  message: string
  timestamp: number
}

// ─── WebSocket ───────────────────────────────────────────────

export interface WsMessage {
  id: string
  direction: 'sent' | 'received'
  content: string
  contentType: 'text' | 'json' | 'binary'
  timestamp: number
}

// ─── SSE ─────────────────────────────────────────────────────

export interface SseEvent {
  id?: string
  type: string
  data: string
  timestamp: number
  retry?: number
}

// ─── Environment & Variables ─────────────────────────────────

export interface Environment {
  id: string
  workspace_id: string
  name: string
  is_active: boolean
  variables: EnvironmentVariable[]
  created_at: number
  updated_at: number
}

export interface EnvironmentVariable extends SecretKeyValuePair {}
export interface GlobalVariable extends SecretKeyValuePair {
  workspace_id: string
}

// ─── Testing ─────────────────────────────────────────────────

export type AssertionType =
  | 'status_equals'
  | 'status_in_range'
  | 'body_contains'
  | 'body_equals_json'
  | 'body_jsonpath'
  | 'body_xpath'
  | 'header_exists'
  | 'header_equals'
  | 'header_contains'
  | 'response_time_under'
  | 'response_size_under'
  | 'custom_script'

export interface TestAssertion {
  id: string
  name: string
  type: AssertionType
  enabled: boolean
  expected?: string | number
  jsonPath?: string
  xPath?: string
  headerName?: string
  script?: string
  rangeMin?: number
  rangeMax?: number
}

export interface TestResult {
  assertion: TestAssertion
  passed: boolean
  actual?: string | number
  error?: string
}

// ─── History ─────────────────────────────────────────────────

export interface HistoryEntry {
  id: string
  workspace_id?: string
  project_id?: string
  endpoint_id?: string
  protocol: Protocol
  method?: string
  url: string
  status_code?: number
  duration_ms?: number
  request_snapshot: Partial<SavedRequest>
  response_snapshot?: Partial<ApiResponse>
  executed_at: number
}

// ─── Import/Export ───────────────────────────────────────────

export type ImportFormat =
  | 'openapi3' | 'openapi2' | 'postman' | 'insomnia'
  | 'curl' | 'apidog' | 'har' | 'jmeter'
  | 'apidoc' | 'raml' | 'io-doc' | 'wsdl'
  | 'wadl' | 'google-discovery' | 'proto' | 'soapui' | 'hoppscotch'

export interface ImportResult {
  success: boolean
  collectionId?: string
  endpointCount?: number
  folderCount?: number
  suggestedEnvVars?: Record<string, string>
  warnings?: string[]
  error?: string
}

// ─── App Settings ────────────────────────────────────────────

export interface AppSettings {
  theme: Theme
  language: Language
  fontSize: number
  defaultTimeout: number
  sslVerification: boolean
  followRedirects: boolean
  historyLimit: number
  proxy: {
    mode: 'system' | 'none' | 'custom'
    host?: string
    port?: number
    auth?: { username: string; password: string }
    ntlm?: { domain?: string }
  }
  autoUpdate: boolean
}

// ─── UI State ────────────────────────────────────────────────

export interface Tab {
  id: string
  name: string
  protocol: Protocol
  method?: string
  url?: string
  endpointId?: string
  savedRequestId?: string
  isDirty: boolean
  isLoading: boolean
}

export interface UIState {
  theme: Theme
  leftPanelWidth: number
  splitPosition: number      // %
  isLeftPanelCollapsed: boolean
  activeProjectId: string | null
  activeWorkspaceId: string | null
}

// ─── Code Generation ─────────────────────────────────────────

export type CodeLanguage =
  | 'curl' | 'js-fetch' | 'js-axios'
  | 'python-requests' | 'java-okhttp'
  | 'go' | 'php' | 'ruby' | 'swift' | 'kotlin' | 'csharp'
