// src/renderer/types/index.ts
// Testnizer — TypeScript tip referansi

// ─── Enums ───────────────────────────────────────────────────

export type Protocol =
  | 'http'
  | 'soap'
  | 'websocket'
  | 'graphql'
  | 'grpc'
  | 'sse'
  | 'ai'
  | 'mcp'
  | 'socketio'
  | 'runner'
  | 'mockServer'
  | 'tools.jwt'
  | 'tools.jsonFormat'
  | 'tools.xmlFormat'
  | 'tools.encode'
  | 'tools.diff'
  | 'tools.jsonpath'
  | 'tools.xpath'
  | 'tools.xslt'
  | 'tools.jolt'
  | 'tools.wsSecurity'
  | 'tools.hash'
  | 'tools.hmac'
  | 'tools.jsonSchema'
  | 'tools.jsonXml'
  | 'tools.epoch'
  | 'tools.httpStatus'
  | 'tools.base'
  | 'tools.uuid'
  | 'tools.regex'
  | 'tools.yamlJson'
  | 'tools.passwordGen'
  | 'tools.otp'
  | 'tools.qr'
  | 'tools.keystore'
  | 'tools.tlsInspect'
  | 'tools.jwk'
  | 'tools.saml'

export const TOOL_PROTOCOLS = [
  'tools.jwt',
  'tools.jsonFormat',
  'tools.xmlFormat',
  'tools.encode',
  'tools.diff',
  'tools.jsonpath',
  'tools.xpath',
  'tools.xslt',
  'tools.jolt',
  'tools.wsSecurity',
  'tools.hash',
  'tools.hmac',
  'tools.jsonSchema',
  'tools.jsonXml',
  'tools.epoch',
  'tools.httpStatus',
  'tools.base',
  'tools.uuid',
  'tools.regex',
  'tools.yamlJson',
  'tools.passwordGen',
  'tools.otp',
  'tools.qr',
  'tools.keystore',
  'tools.tlsInspect',
  'tools.jwk',
  'tools.saml',
] as const satisfies readonly Protocol[]
export type ToolProtocol = (typeof TOOL_PROTOCOLS)[number]
export function isToolProtocol(p: Protocol): p is ToolProtocol {
  return (TOOL_PROTOCOLS as readonly string[]).includes(p)
}

// ─── OTP authenticator vault (Tools panel) ──────────────────────────
export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'
export type OtpType = 'totp' | 'hotp'

/** Renderer-facing OTP entry — never carries the secret. */
export interface OtpEntry {
  id: string
  label: string | null
  issuer: string | null
  account: string | null
  algorithm: OtpAlgorithm
  digits: number
  period: number
  type: OtpType
  counter: number
  enabled: boolean
  hasSecret: boolean
}

export interface OtpCode {
  id: string
  code: string | null
  secondsRemaining: number
  error?: string
}

export interface OtpDraft {
  type: OtpType
  label: string
  issuer: string
  account: string
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
  counter: number
}

export interface OtpAddInput {
  label?: string | null
  issuer?: string | null
  account?: string | null
  secret: string
  algorithm?: OtpAlgorithm
  digits?: number
  period?: number
  type?: OtpType
  counter?: number
  enabled?: boolean
}
// ─── Keystore Studio (renderer-safe DTOs; structural mirror of the preload
// bridge — public metadata only, never keystore bytes / keys / passwords) ────
export type KeystoreType = 'JKS' | 'PKCS12'
export type KeystoreEntryType = 'KEY' | 'CERTIFICATE'

export interface KeystoreAliasSummary {
  alias: string
  entryType: KeystoreEntryType
  hasPrivateKey: boolean
  subjectDN?: string
  issuerDN?: string
  notBefore?: string
  notAfter?: string
  keyAlgorithm?: string
  chainLength: number
}

export interface KeystoreMeta {
  type: KeystoreType
  aliasCount: number
  aliases: KeystoreAliasSummary[]
  /**
   * Unsaved-changes flag (Faz B4 dirty-guard, design §9.7). Set by any mutation
   * in main, cleared on Save-As. Absent on read-only projections — callers treat
   * `undefined` as `false`.
   */
  dirty?: boolean
}

/** Export / Save-As result — a written path, or a cancelled dialog. Never bytes. */
export type KeystoreWriteResult = { path: string } | { canceled: true }

export interface KeystoreCertificateInfo {
  subjectDN: string
  issuerDN: string
  serialNumber: string
  version: number
  sigAlgName: string
  notBefore: string
  notAfter: string
  publicKeyAlgorithm: string
  keySize: number
  sha1Fingerprint: string
  sha256Fingerprint: string
  subjectAlternativeNames: string[]
  pem: string
}

export interface KeystoreAliasDetail {
  alias: string
  entryType: KeystoreEntryType
  hasPrivateKey: boolean
  chain: KeystoreCertificateInfo[]
}

// ─── TLS Inspector (#64, Faz F) ──────────────────────────────────────────────
// Renderer-facing mirrors of the main-process DTOs (preload `TlsApi`). Kept
// structurally identical to the preload interfaces so `window.api.tls.inspect`
// accepts a `TlsInspectRequest` and returns a `TlsInspectResult`. Also
// structurally identical to `KeystoreCertificateInfo`, so a TLS chain can reuse
// the keystore `CertificateDetailDialog` atom without a conversion layer.

/** One presented certificate — PUBLIC material only (no private key bytes). */
export interface TlsCertificateInfo {
  subjectDN: string
  issuerDN: string
  serialNumber: string
  version: number
  sigAlgName: string
  notBefore: string
  notAfter: string
  publicKeyAlgorithm: string
  keySize: number
  sha1Fingerprint: string
  sha256Fingerprint: string
  subjectAlternativeNames: string[]
  pem: string
}

export type TlsCipherPreset = 'modern' | 'intermediate' | 'legacy'

/** Inline (pasted) mTLS client-cert material — carried as strings over IPC. */
export interface TlsClientCertInline {
  kind: 'inline'
  certPem?: string
  keyPem?: string
  /** PFX/P12 bytes, base64-encoded. */
  pfxBase64?: string
  passphrase?: string
}

/** File-path mTLS client-cert material — the paths are read in MAIN. */
export interface TlsClientCertFile {
  kind: 'file'
  certPath?: string
  keyPath?: string
  pfxPath?: string
  passphrase?: string
}

export type TlsClientCert = TlsClientCertInline | TlsClientCertFile

export interface TlsInspectRequest {
  host: string
  port?: number
  servername?: string
  alpnProtocols?: string[]
  minVersion?: string
  maxVersion?: string
  ciphers?: string
  cipherPreset?: TlsCipherPreset
  timeoutMs?: number
  /** Extra trust anchors — base64-encoded PEM or DER (merged with system roots in main). */
  caCerts?: string[]
  clientCert?: TlsClientCert
}

/** What was probed — present whether or not the probe got anywhere. */
export interface TlsProbeTarget {
  host: string
  port: number
  servername: string
}

/**
 * The probe never completed a handshake: DNS, TCP, TLS negotiation or a timeout.
 *
 * Nothing about a certificate exists here, and that is the point. The old shape
 * was one flat interface with `ok: boolean`, so a failed probe still carried
 * `hostnameValid`, `expired`, `daysToExpiry` and a `validityStatus` — filled
 * with placeholders by the engine. The result pane rendered them, and a DNS
 * failure produced a confident "Hostname mismatch · Expired · in 0 days" report
 * about a server that was never reached (TLS-1/TLS-6). A render guard fixed the
 * symptom; splitting the type makes the mistake unwriteable.
 */
export interface TlsProbeFailure extends TlsProbeTarget {
  ok: false
  error: string
}

/**
 * The handshake completed. Transport facts are real; the certificate verdicts
 * describe `chain[0]` and mean nothing when `chain` is empty — a server may
 * complete a handshake without presenting one (TLS-5). Use `resultVisibility`
 * rather than reading them unconditionally.
 */
export interface TlsProbeSuccess extends TlsProbeTarget {
  ok: true
  protocol: string | null
  cipher: { name: string; standardName: string; version: string } | null
  alpnProtocol: string | false
  /** Independently VALIDATED by the system trust store (present ≠ trusted). */
  authorized: boolean
  authorizationError?: string
  hostnameValid: boolean
  /** Presented, leaf-first — NOT proof of trust. */
  chain: TlsCertificateInfo[]
  selfSigned: boolean
  expired: boolean
  notYetValid: boolean
  daysToExpiry: number
  validityStatus: 'valid' | 'expiring' | 'expired'
}

export type TlsInspectResult = TlsProbeFailure | TlsProbeSuccess

/** Library row — metadata only; never carries blob or store password. */
export interface KeystoreLibraryEntry {
  id: string
  name: string
  type: KeystoreType
  alias_count: number
  size_bytes: number
  created_at: number
  updated_at: number
  /**
   * Whether a store password is persisted for this entry. Derived from
   * `store_password != null` — the password value itself never leaves main.
   * When `false`, the open flow must prompt the user for the password.
   */
  remembered: boolean
}

export interface KeystorePickFileResult {
  path: string
  fileName: string
  type: KeystoreType
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type BodyType =
  | 'none'
  | 'json'
  | 'xml'
  | 'text'
  | 'html'
  | 'javascript'
  | 'form-data'
  | 'urlencoded'
  | 'binary'
export type AuthType =
  | 'none'
  // Inherit auth from the nearest ancestor folder, else the project. The Send +
  // Runner paths resolve this to a concrete type before the engine sees it.
  | 'inherit'
  | 'basic'
  | 'bearer'
  | 'api-key'
  | 'oauth2'
  | 'digest'
  | 'ntlm'
  | 'aws-signature'
  | 'hawk'
  | 'wsse'
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
  /**
   * Form-data field type. Defaults to 'text' when undefined for backwards
   * compatibility. When set to 'file', `value` holds the original file name
   * for display purposes and `filePath` holds the absolute disk path used
   * by the main process to stream the file during multipart upload.
   */
  type?: 'text' | 'file'
  filePath?: string
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
  display_name?: string | null
  description?: string
  type: 'http' | 'grpc' | 'websocket'
  save_mode: 'local' | 'git' | 'both'
  local_path?: string | null
  icon_emoji?: string | null
  icon_color?: string | null
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
  /** Folder-level auth — JSON-encoded AuthConfig string as stored in the DB
   *  (parse before use). Descendant requests whose own auth is 'inherit' fall
   *  back to the nearest folder that sets one, then the project. */
  auth?: string | null
  /** Folder-level pre-request / test scripts. These cascade (Postman-style):
   *  project → outer folder → inner folder → request, all run in order. */
  pre_script?: string | null
  post_script?: string | null
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
  request_schema?: string // JSON serialized
  response_schemas?: string // JSON serialized
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
  metadata?: SoapMetadata | GrpcMetadata | Record<string, unknown>
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
  wsse?: {
    username: string
    password: string
    passwordType: 'PasswordText' | 'PasswordDigest'
    addTimestamp: boolean
  }
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
  /** Resource-owner credentials — only used when `grantType` is 'password'. */
  username?: string
  password?: string
  /** Where client credentials go in the token request: HTTP Basic header
   *  (default) or in the form body. */
  clientAuth?: 'header' | 'body'
}

// ─── SOAP ────────────────────────────────────────────────────

export interface SoapMetadata {
  wsdlUrl: string
  serviceName?: string
  portName?: string
  operationName?: string
  soapVersion?: 'soap11' | 'soap12'
  namespace?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  wsSecurity?: WsSecurityConfig
}

export type WsSecurityMode = 'username-token' | 'timestamp' | 'sign' | 'encrypt'
export type WsSignAlgorithm = 'RSA-SHA1' | 'RSA-SHA256' | 'RSA-SHA512'
export type WsEncryptAlgorithm = 'AES-128-CBC' | 'AES-256-CBC' | 'AES-128-GCM' | 'AES-256-GCM'
export type WsKeyWrapAlgorithm = 'RSA-OAEP' | 'RSA-1.5'
export type WsKeyInfoStrategy = 'BinarySecurityToken' | 'IssuerSerial'
export type WsSignReference = 'Body' | 'Timestamp' | 'UsernameToken'

export interface WsUsernameTokenConfig {
  username: string
  password: string
  passwordType: 'PasswordText' | 'PasswordDigest'
  nonce: boolean
  created: boolean
}

export interface WsTimestampConfig {
  ttlSeconds: number
}

/**
 * Renderer-side mirror of the main-process `MaterialSource`
 * (`src/main/lib/keystore-bridge.ts`) — the Key Material Provider (#60).
 *
 * OPAQUE by construction: ids, filesystem paths and user-pasted PEM only. NO
 * resolved key bytes ever live in this shape, so the renderer can hold and
 * persist it. The password fields are WRITE-ONLY: they may be sent to main once,
 * and are never persisted, echoed back, or read out of a stored config.
 *
 * Keep structurally mirrored with the main-process union (the two type trees are
 * hand-kept in sync, like `WsSignConfig` ↔ engine `SignConfig`).
 */
export type MaterialSource =
  | { kind: 'inline'; certPem: string; keyPem?: string; chainPem?: string[]; passphrase?: string }
  | { kind: 'file'; certPath?: string; keyPath?: string; pfxPath?: string; passphrase?: string }
  | {
      kind: 'keystore'
      keystoreId: string
      alias: string
      /** Per-alias ENTRY password (R11). WRITE-ONLY. */
      keyPassword?: string
      /** STORE password — required when the keystore row's is NULL. WRITE-ONLY. */
      storePassword?: string
    }
  | { kind: 'certRow'; certificateId: string }

export interface WsSignConfig {
  /**
   * Pasted private-key PEM — the DEFAULT path, unchanged. OPTIONAL since #60:
   * a `keySource` may stand in for it, in which case MAIN resolves the PEM and
   * the renderer never sees it.
   */
  privateKeyPem?: string
  /** Pasted certificate PEM. OPTIONAL for the same reason as `privateKeyPem`. */
  certPem?: string
  algorithm: WsSignAlgorithm
  references: WsSignReference[]
  keyInfoStrategy: WsKeyInfoStrategy
  /**
   * "Use from keystore / Security" — one ADDED option (#60). When absent the
   * behaviour is byte-for-byte the old pasted-PEM path. Resolved in MAIN only.
   */
  keySource?: MaterialSource
}

export interface WsEncryptConfig {
  recipientCertPem: string
  algorithm: WsEncryptAlgorithm
  keyWrap: WsKeyWrapAlgorithm
  targetXpath?: string
}

/**
 * Multi-mode WS-Security configuration.
 *
 * For backward compatibility with persisted projects, the legacy single-mode
 * fields (`type`, `username`, `password`, `passwordType`, `addTimestamp`) are
 * still accepted. The main-process engine auto-migrates them to `modes`.
 */
export interface WsSecurityConfig {
  enabled: boolean
  /** New multi-mode shape — Sprint 4+ */
  modes?: WsSecurityMode[]
  signFirst?: boolean
  usernameToken?: WsUsernameTokenConfig
  timestamp?: WsTimestampConfig
  sign?: WsSignConfig
  encrypt?: WsEncryptConfig

  /** @deprecated legacy single-mode fields (auto-migrated) */
  type?: 'username-token' | 'timestamp'
  /** @deprecated legacy single-mode fields (auto-migrated) */
  username?: string
  /** @deprecated legacy single-mode fields (auto-migrated) */
  password?: string
  /** @deprecated legacy single-mode fields (auto-migrated) */
  passwordType?: 'PasswordText' | 'PasswordDigest'
  /** @deprecated legacy single-mode fields (auto-migrated) */
  addTimestamp?: boolean
}

// ─── SAML (#65, Faz E) ───────────────────────────────────────

/**
 * Renderer-side mirror of the SAML engine contracts
 * (`src/main/protocols/saml.engine.ts`). Hand-kept in sync, exactly like
 * `WsSignConfig` ↔ the engine's `SignConfig`.
 *
 * NOTE the deliberate asymmetry: the engine accepts `string | Date` for
 * instants and `Date` attribute values; the renderer only ever sends strings
 * (its forms are text inputs), so the mirror narrows to `string`.
 */
export type SamlSignAlgorithm = 'RSA-SHA256' | 'RSA-SHA512' | 'ECDSA-SHA256' | 'ECDSA-SHA512'

export type SamlSignatureTarget = 'assertion' | 'response' | 'root'

export type SamlBinding = 'redirect' | 'post'

export interface SamlAttributeInput {
  name: string
  nameFormat?: string
  friendlyName?: string
  values: (string | number | boolean)[]
  valueType?: string
}

export interface SamlSubjectConfig {
  nameId: string
  nameIdFormat?: string
  nameQualifier?: string
  spNameQualifier?: string
  recipient?: string
  inResponseTo?: string
  confirmationMethod?: string
  confirmationNotOnOrAfterSeconds?: number
}

interface SamlDeterministicFields {
  id?: string
  issueInstant?: string
  now?: string
}

export interface SamlAuthnRequestConfig extends SamlDeterministicFields {
  issuer: string
  destination?: string
  assertionConsumerServiceURL?: string
  protocolBinding?: string
  nameIdFormat?: string
  allowCreate?: boolean
  forceAuthn?: boolean
  isPassive?: boolean
  authnContextClassRef?: string
  comparison?: 'exact' | 'minimum' | 'maximum' | 'better'
}

export interface SamlAssertionConfig extends SamlDeterministicFields {
  issuer: string
  subject: SamlSubjectConfig
  audience?: string | string[]
  notBeforeSkewSeconds?: number
  notOnOrAfterSeconds?: number
  sessionIndex?: string
  authnInstant?: string
  authnContextClassRef?: string
  includeAuthnStatement?: boolean
  attributes?: SamlAttributeInput[]
}

export interface SamlResponseConfig extends SamlDeterministicFields {
  issuer: string
  destination?: string
  inResponseTo?: string
  statusCode?: string
  statusSubCode?: string
  statusMessage?: string
  /** Pre-built (possibly already signed) assertion XML — embedded verbatim. */
  assertionXml?: string
  assertion?: SamlAssertionConfig
}

export interface SamlDocument {
  xml: string
  id: string
  issueInstant: string
  assertionId?: string
}

/**
 * The ONE key-material shape every key-bearing SAML IPC payload uses.
 * `inline` (pasted PEM) is the DEFAULT; `source` is one ADDED arm resolved in
 * MAIN — the renderer never sees a resolved key.
 */
export type SamlKeyInput =
  | { inline: { certPem?: string; privateKeyPem?: string; passphrase?: string } }
  | { source: MaterialSource }

export interface SamlVerifyOptions {
  requireSignedId?: string
  requireAssertionSigned?: boolean
  now?: string
  clockSkewSeconds?: number
  validateConditions?: boolean
  expectedAudience?: string
  expectedInResponseTo?: string
}

export interface SamlVerifyCheck {
  name: string
  ok: boolean
  detail?: string
}

export interface SamlVerifyResult {
  valid: boolean
  reason?: string
  signedReferences: string[]
  signedContent: string[]
  signedElement?: { id: string; localName: string }
  signatureMethod?: string
  digestMethod?: string
  canonicalizationMethod?: string
  certInfo?: {
    subject?: string
    issuer?: string
    notBefore?: string
    notAfter?: string
  }
  conditions?: { notBefore?: string; notOnOrAfter?: string; audiences: string[] }
  subject?: { nameId?: string; format?: string }
  /** Every check that ran, in order — the "why did it fail" report. */
  checks: SamlVerifyCheck[]
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
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
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
  /**
   * Set to 'base64' when `body` holds a base64-encoded binary payload (image /
   * PDF / octet-stream) rather than text — the response viewer then previews
   * or offers it for download instead of rendering it in the text editor
   * (issue #25). Absent for ordinary text responses.
   */
  bodyEncoding?: 'base64'
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
  // 'pm_script' is an internal synthetic type used to label results coming
  // out of post-response pm.test() calls — it is never offered in the UI
  // "add assertion" menu.
  | 'pm_script'

export interface TestAssertion {
  id: string
  name: string
  type: AssertionType
  enabled: boolean
  expected?: string | number
  jsonPath?: string
  xPath?: string
  headerName?: string
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
  | 'openapi3'
  | 'openapi2'
  | 'postman'
  | 'insomnia'
  | 'curl'
  | 'apidog'
  | 'har'
  | 'jmeter'
  | 'apidoc'
  | 'raml'
  | 'io-doc'
  | 'wsdl'
  | 'wadl'
  | 'google-discovery'
  | 'proto'
  | 'soapui'
  | 'hoppscotch'

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
  /** Mock server ID — used by mockServer tab to identify which server is open */
  mockServerId?: string
  /**
   * Test suite item ID — when set, the tab represents an inline request
   * inside a test suite. Save / load routes to `testSuiteItem.*` IPCs
   * rather than `savedRequest.*` / `endpoint.*`. Mutually exclusive with
   * `endpointId` / `savedRequestId`.
   */
  testSuiteItemId?: string
  /** Folder/module ID — used by runner tab to scope endpoints */
  folderId?: string
  /** Opaque key — changing this forces the runner tab to re-read sessionStorage */
  sessionKey?: string
  isDirty: boolean
  isLoading: boolean
  /** Preview tabs are replaced when another item is single-clicked. Double-click pins them. */
  isPreview?: boolean
}

export interface UIState {
  theme: Theme
  leftPanelWidth: number
  splitPosition: number // %
  isLeftPanelCollapsed: boolean
  activeProjectId: string | null
  activeWorkspaceId: string | null
}

// ─── Code Generation ─────────────────────────────────────────

export type CodeLanguage =
  | 'curl'
  | 'js-fetch'
  | 'js-axios'
  | 'python-requests'
  | 'java-okhttp'
  | 'go'
  | 'php'
  | 'ruby'
  | 'swift'
  | 'kotlin'
  | 'csharp'

// ─── Branch ─────────────────────────────────────────────────

export interface Branch {
  id: string
  project_id: string
  name: string
  parent_branch_id: string | null
  created_at: number
  /** SQLite stores boolean as int (0/1). */
  is_default: number
}

// ─── Save / Git ─────────────────────────────────────────────

export type SaveMode = 'local' | 'git'

export interface SaveLocalOptions {
  projectId: string
  directoryPath: string
}

export interface SaveGitOptions {
  projectId: string
  repoUrl: string
  branch: string
  username: string
  token: string
  commitMessage: string
}

export interface GitOpenOptions {
  repoUrl: string
  branch: string
  username: string
  token: string
}

export interface SaveHistoryEntry {
  id: string
  mode: SaveMode
  path: string
  message: string
  timestamp: number
}

export interface GitRepoFile {
  name: string
  path: string
  size: number
}

// ─── Mock Server ────────────────────────────────────────────────

export type MockHost = '127.0.0.1' | '0.0.0.0'

export type MockAuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; tokens: string[] }
  | { type: 'basic'; users: { username: string; password: string }[] }
  | { type: 'apiKey'; in: 'header' | 'query'; name: string; keys: string[] }

export type MockFailureMode = 'status' | 'timeout' | 'random'

export interface MockFailureConfig {
  enabled: boolean
  probability: number
  mode: MockFailureMode
  status?: number
  timeoutMs?: number
}

export interface MockRateLimitConfig {
  enabled: boolean
  requestsPerWindow: number
  windowMs: number
  scope: 'global' | 'ip'
}

export interface MockSchemaValidation {
  enabled: boolean
  schema: Record<string, unknown>
}

export interface MockServer {
  id: string
  projectId: string
  name: string
  description: string
  host: MockHost
  port: number
  basePath: string
  autoStart: boolean
  corsEnabled: boolean
  corsAllowOrigins: string
  corsAllowMethods: string
  corsAllowHeaders: string
  corsAllowCredentials: boolean
  corsMaxAge: number
  authConfig: MockAuthConfig
  failureConfig: MockFailureConfig
  rateLimitConfig: MockRateLimitConfig
  /** When enabled, requests to GET /__echo (or any method) reflect the request as the response body. */
  echoEnabled: boolean
  /** When enabled, requests not matched by any endpoint forward to `proxyTarget`. */
  proxyEnabled: boolean
  proxyTarget: string
  /** When enabled together with proxy, captured upstream responses are saved as new mock endpoints. */
  proxyRecord: boolean
  createdAt: number
  updatedAt: number
}

export type MockMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ANY'

export type MockPathMode = 'exact' | 'param' | 'wildcard' | 'regex'

export interface MockEndpoint {
  id: string
  serverId: string
  method: MockMethod
  path: string
  pathMode: MockPathMode
  description: string
  priority: number
  enabled: boolean
  sortOrder: number
  /** When set, overrides server-level auth for this endpoint. */
  authOverride: MockAuthConfig | null
  /** When enabled, the request body must match this JSON Schema. */
  schemaValidation: MockSchemaValidation | null
  createdAt: number
  updatedAt: number
}

export type MockBodyType = 'json' | 'xml' | 'text' | 'html'

export type MockConditionOp = 'eq' | 'neq' | 'contains' | 'regex' | 'exists'

export type MockCondition =
  | { type: 'always' }
  | { type: 'header'; name: string; op: MockConditionOp; value: string }
  | { type: 'query'; name: string; op: MockConditionOp; value: string }
  | { type: 'pathParam'; name: string; op: MockConditionOp; value: string }
  | { type: 'jsonPath'; path: string; op: MockConditionOp; value?: string }
  | { type: 'xpath'; expression: string; op: MockConditionOp; value?: string }
  | { type: 'method'; method: string }
  | { type: 'and'; conditions: MockCondition[] }
  | { type: 'or'; conditions: MockCondition[] }

export interface MockResponseHeader {
  name: string
  value: string
}

export interface MockResponse {
  id: string
  endpointId: string
  name: string
  statusCode: number
  headers: MockResponseHeader[]
  bodyType: MockBodyType
  body: string
  delayMs: number
  condition: MockCondition
  /** Optional pre-response JS executed in a sandbox. May mutate `state`/`response`. */
  script: string
  order: number
  enabled: boolean
}

// ─── Test Suite (renderer-facing row shapes) ─────────────────

export interface TestSuiteRow {
  id: string
  project_id: string
  name: string
  description: string | null
  sort_order: number
  created_at: number
  updated_at: number
}

export interface TestSuiteItemRow {
  id: string
  suite_id: string
  folder_id: string | null
  protocol: string
  name: string
  method: string | null
  url: string | null
  request_schema: string
  assertions: string | null
  source_endpoint_id: string | null
  sort_order: number
  created_at?: number
  updated_at?: number
}

export interface TestSuiteFolderRow {
  id: string
  suite_id: string
  parent_id: string | null
  name: string
  sort_order: number
}

export interface TestSuiteContents {
  items: TestSuiteItemRow[]
  folders: TestSuiteFolderRow[]
}

export type MockServerStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface MockServerRuntimeInfo {
  serverId: string
  status: MockServerStatus
  port: number | null
  startedAt: number | null
  errorMessage: string | null
}

export interface MockLogEntry {
  id: string
  serverId: string
  ts: number
  method: string
  path: string
  query: string
  statusCode: number
  latencyMs: number
  matchedEndpointId: string | null
  matchedResponseId: string | null
  request: { headers: Record<string, string>; body: string }
  response: { headers: Record<string, string>; body: string }
  error: string | null
}
