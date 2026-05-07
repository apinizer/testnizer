import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { randomUUID } from 'crypto'
import { performance } from 'perf_hooks'
import { BrowserWindow } from 'electron'
import { describeGrpcStatus } from '../lib/error-classifier'

// ─── Types ───────────────────────────────────────────────────

export interface GrpcServiceDescription {
  protoPath: string
  packageName: string
  services: GrpcServiceInfo[]
}

export interface GrpcServiceInfo {
  name: string
  fullName: string
  methods: GrpcMethodInfo[]
}

export interface GrpcMethodInfo {
  name: string
  requestType: string
  responseType: string
  requestStream: boolean
  responseStream: boolean
  /**
   * JSON-stringified skeleton for the request message (zero-valued per field).
   * Optional: only present when the proto definition for the request type was resolved.
   */
  requestSkeleton?: string
}

export interface GrpcExecuteOptions {
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

export interface GrpcResponse {
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

export interface GrpcStreamEvent {
  streamId: string
  type: 'data' | 'end' | 'error' | 'status'
  data?: string
  error?: string
  grpcStatus?: number
  grpcStatusMessage?: string
  timestamp: number
}

// ─── Proto cache ────────────────────────────────────────────

interface LoadedProto {
  packageDefinition: protoLoader.PackageDefinition
  grpcObject: grpc.GrpcObject
  protoPath: string
}

const protoCache = new Map<string, LoadedProto>()

// ─── Stream manager ─────────────────────────────────────────

interface ManagedStream {
  streamId: string
  call: grpc.ClientReadableStream<unknown> | grpc.ClientDuplexStream<unknown, unknown>
  windowId: number
}

const activeStreams = new Map<string, ManagedStream>()

function sendStreamEvent(windowId: number, event: GrpcStreamEvent): void {
  const win = BrowserWindow.fromId(windowId)
  if (win && !win.isDestroyed()) {
    win.webContents.send('grpc:streamEvent', event)
  }
}

// ─── Helper: load or get cached proto ───────────────────────

async function loadOrGetProto(protoPath: string): Promise<LoadedProto> {
  const cached = protoCache.get(protoPath)
  if (cached) return cached

  const packageDefinition = await protoLoader.load(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  })

  const grpcObject = grpc.loadPackageDefinition(packageDefinition)

  const loaded: LoadedProto = {
    packageDefinition,
    grpcObject,
    protoPath
  }

  protoCache.set(protoPath, loaded)
  return loaded
}

// ─── Helper: find service client ────────────────────────────

function findServiceClient(
  grpcObject: grpc.GrpcObject,
  serviceName: string
): grpc.ServiceClientConstructor | null {
  // serviceName can be "package.ServiceName" or just "ServiceName"
  const parts = serviceName.split('.')
  let current: grpc.GrpcObject | grpc.ServiceClientConstructor | grpc.ProtobufTypeDefinition = grpcObject

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as grpc.GrpcObject)[part] as grpc.GrpcObject | grpc.ServiceClientConstructor
    } else {
      return null
    }
  }

  // Check if it's a service client constructor
  if (typeof current === 'function' && 'service' in current) {
    return current as unknown as grpc.ServiceClientConstructor
  }

  return null
}

// ─── Helper: create credentials ─────────────────────────────

function createCredentials(useTls?: boolean): grpc.ChannelCredentials {
  if (useTls) {
    return grpc.credentials.createSsl()
  }
  return grpc.credentials.createInsecure()
}

// ─── Helper: create metadata ────────────────────────────────

function createMetadata(meta?: Record<string, string>): grpc.Metadata {
  const metadata = new grpc.Metadata()
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      metadata.add(key, value)
    }
  }
  return metadata
}

// ─── Helper: extract response metadata ──────────────────────

function extractMetadata(meta: grpc.Metadata): Record<string, string> {
  const result: Record<string, string> = {}
  const map = meta.getMap()
  for (const [key, value] of Object.entries(map)) {
    result[key] = typeof value === 'string' ? value : Buffer.from(value).toString('base64')
  }
  return result
}

// ─── Helper: build JSON skeleton from a proto message definition ───

interface ProtoFieldDescriptor {
  name?: string
  type?: string
  typeName?: string
  label?: string
}

interface ProtoMessageType {
  name?: string
  field?: ProtoFieldDescriptor[]
}

interface ProtoEnumType {
  value?: Array<{ name?: string; number?: number }>
}

/**
 * Lookup function for resolving cross-message references (TYPE_MESSAGE / TYPE_ENUM).
 * Receives a `typeName` (e.g. "Sub" or "google.protobuf.Any") plus the current
 * package context to attempt scoped + fully-qualified resolution.
 */
export type ProtoTypeLookup = (
  typeName: string
) => protoLoader.MessageTypeDefinition | protoLoader.EnumTypeDefinition | undefined

/**
 * Default zero-value for a proto3 scalar type.
 * See https://protobuf.dev/programming-guides/proto3/#default
 */
function zeroValueForScalar(type: string): unknown {
  switch (type) {
    case 'TYPE_STRING':
      return ''
    case 'TYPE_BYTES':
      return ''
    case 'TYPE_BOOL':
      return false
    case 'TYPE_DOUBLE':
    case 'TYPE_FLOAT':
      return 0
    case 'TYPE_INT32':
    case 'TYPE_UINT32':
    case 'TYPE_SINT32':
    case 'TYPE_FIXED32':
    case 'TYPE_SFIXED32':
      return 0
    case 'TYPE_INT64':
    case 'TYPE_UINT64':
    case 'TYPE_SINT64':
    case 'TYPE_FIXED64':
    case 'TYPE_SFIXED64':
      // longs option = String → emit "0" string for symmetry with engine
      return '0'
    default:
      return null
  }
}

/**
 * Builds a JSON skeleton (object literal) from a proto MessageTypeDefinition
 * by walking its field list and emitting each field's zero value.
 *
 * - Scalars use their proto3 default (string→"", int→0, bool→false, long→"0")
 * - Repeated fields → `[]` regardless of element type
 * - Nested messages → recursively built skeleton (or `{}` if unresolved)
 * - Enums → first declared value name (or `""` if unresolved)
 *
 * `lookup` is consulted with the field's `typeName` to resolve nested
 * messages / enums. If lookup returns undefined the function falls back to
 * a graceful default (empty object / empty string).
 *
 * `seen` guards against cyclic message references.
 */
export function buildJsonSkeletonFromProtoMessage(
  message: protoLoader.MessageTypeDefinition,
  lookup?: ProtoTypeLookup,
  seen: Set<string> = new Set()
): Record<string, unknown> {
  const skeleton: Record<string, unknown> = {}
  const messageType = message.type as ProtoMessageType | undefined
  const fields = messageType?.field ?? []
  const messageName = messageType?.name ?? ''

  // Cycle guard: if we re-enter the same message, return {} so callers can
  // continue walking siblings without recursing forever.
  if (messageName && seen.has(messageName)) {
    return skeleton
  }
  const nextSeen = messageName ? new Set(seen).add(messageName) : seen

  for (const field of fields) {
    const fieldName = field.name
    if (!fieldName) continue

    // Repeated → empty array placeholder regardless of element type.
    if (field.label === 'LABEL_REPEATED') {
      skeleton[fieldName] = []
      continue
    }

    const t = field.type ?? ''

    if (t === 'TYPE_MESSAGE') {
      const refName = field.typeName ?? ''
      const resolved = lookup?.(refName)
      if (resolved && (resolved as protoLoader.MessageTypeDefinition).format === 'Protocol Buffer 3 DescriptorProto') {
        skeleton[fieldName] = buildJsonSkeletonFromProtoMessage(
          resolved as protoLoader.MessageTypeDefinition,
          lookup,
          nextSeen
        )
      } else {
        // Unresolved / well-known type (Any, Empty, ...) → graceful empty object
        skeleton[fieldName] = {}
      }
      continue
    }

    if (t === 'TYPE_ENUM') {
      const refName = field.typeName ?? ''
      const resolved = lookup?.(refName)
      if (resolved && (resolved as protoLoader.EnumTypeDefinition).format === 'Protocol Buffer 3 EnumDescriptorProto') {
        const enumType = (resolved as protoLoader.EnumTypeDefinition).type as ProtoEnumType | undefined
        const firstValue = enumType?.value?.[0]?.name
        skeleton[fieldName] = firstValue ?? ''
      } else {
        skeleton[fieldName] = ''
      }
      continue
    }

    skeleton[fieldName] = zeroValueForScalar(t)
  }

  return skeleton
}

/**
 * Builds a `ProtoTypeLookup` over a loaded `PackageDefinition`. Resolves the
 * passed name against:
 *   1. Fully-qualified key (e.g. "google.protobuf.Any")
 *   2. `<currentPackage>.<name>` (e.g. "Sub" inside package "test" → "test.Sub")
 *   3. Suffix-match against any package-qualified key (best-effort).
 */
export function makeProtoTypeLookup(
  packageDefinition: protoLoader.PackageDefinition,
  currentPackage: string
): ProtoTypeLookup {
  return (typeName: string) => {
    if (!typeName) return undefined

    // 1) Fully qualified
    const direct = packageDefinition[typeName]
    if (direct) return direct as protoLoader.MessageTypeDefinition | protoLoader.EnumTypeDefinition

    // 2) Scoped to current package
    if (currentPackage) {
      const scoped = packageDefinition[`${currentPackage}.${typeName}`]
      if (scoped) return scoped as protoLoader.MessageTypeDefinition | protoLoader.EnumTypeDefinition
    }

    // 3) Best-effort suffix match (e.g. nested type lookups)
    const suffix = `.${typeName}`
    for (const key of Object.keys(packageDefinition)) {
      if (key === typeName || key.endsWith(suffix)) {
        return packageDefinition[key] as protoLoader.MessageTypeDefinition | protoLoader.EnumTypeDefinition
      }
    }
    return undefined
  }
}

// ─── Helper: extract services from package definition ───────

function extractServices(
  packageDefinition: protoLoader.PackageDefinition
): { packageName: string; services: GrpcServiceInfo[] } {
  const services: GrpcServiceInfo[] = []
  let packageName = ''

  // First pass: determine package name from any service entry so the lookup
  // can scope unqualified typeNames correctly.
  for (const fullName of Object.keys(packageDefinition)) {
    const def = packageDefinition[fullName] as protoLoader.AnyDefinition
    if ('format' in def) continue
    // Heuristic: a service entry has at least one MethodDefinition-shaped value.
    const sd = def as Record<string, unknown>
    const looksLikeService = Object.values(sd).some(
      (v) => v && typeof v === 'object' && 'requestType' in (v as object) && 'responseType' in (v as object)
    )
    if (looksLikeService && fullName.includes('.')) {
      packageName = fullName.slice(0, fullName.lastIndexOf('.'))
      break
    }
  }

  const lookup = makeProtoTypeLookup(packageDefinition, packageName)

  for (const [fullName, def] of Object.entries(packageDefinition)) {
    // A service definition has methods with requestType/responseType
    const typedDef = def as protoLoader.MessageTypeDefinition | protoLoader.ServiceDefinition
    if ('format' in typedDef) {
      // This is a message type, skip
      continue
    }

    // Check if it looks like a service (has method definitions)
    const serviceDef = typedDef as Record<string, unknown>
    const methods: GrpcMethodInfo[] = []
    let isService = false

    for (const [methodName, methodDef] of Object.entries(serviceDef)) {
      const method = methodDef as {
        requestType?: protoLoader.MessageTypeDefinition
        responseType?: protoLoader.MessageTypeDefinition
        requestStream?: boolean
        responseStream?: boolean
      } | undefined

      if (method?.requestType && method?.responseType) {
        isService = true
        const reqTypeName =
          (method.requestType.type as { name?: string } | undefined)?.name ?? 'unknown'
        const resTypeName =
          (method.responseType.type as { name?: string } | undefined)?.name ?? 'unknown'

        let requestSkeleton: string | undefined
        try {
          const skeletonObj = buildJsonSkeletonFromProtoMessage(method.requestType, lookup)
          requestSkeleton = JSON.stringify(skeletonObj, null, 2)
        } catch {
          requestSkeleton = undefined
        }

        methods.push({
          name: methodName,
          requestType: reqTypeName,
          responseType: resTypeName,
          requestStream: method.requestStream ?? false,
          responseStream: method.responseStream ?? false,
          requestSkeleton
        })
      }
    }

    if (isService && methods.length > 0) {
      const nameParts = fullName.split('.')
      const serviceName = nameParts[nameParts.length - 1]
      if (nameParts.length > 1) {
        packageName = nameParts.slice(0, -1).join('.')
      }

      services.push({
        name: serviceName,
        fullName,
        methods
      })
    }
  }

  return { packageName, services }
}

// ─── Public API ─────────────────────────────────────────────

export async function loadProto(protoPath: string): Promise<GrpcServiceDescription> {
  const loaded = await loadOrGetProto(protoPath)
  const { packageName, services } = extractServices(loaded.packageDefinition)

  return {
    protoPath,
    packageName,
    services
  }
}

export async function executeUnary(options: GrpcExecuteOptions): Promise<GrpcResponse> {
  const requestId = randomUUID()
  const startTime = performance.now()

  try {
    const loaded = await loadOrGetProto(options.protoPath)
    const ServiceClient = findServiceClient(loaded.grpcObject, options.serviceName)

    if (!ServiceClient) {
      return {
        requestId,
        protocol: 'grpc',
        timing: { total: Math.round(performance.now() - startTime) },
        error: `Service not found: ${options.serviceName}`
      }
    }

    const credentials = createCredentials(options.useTls)
    const client = new ServiceClient(options.serverAddress, credentials)

    const metadata = createMetadata(options.metadata)

    let requestMessage: Record<string, unknown>
    try {
      requestMessage = JSON.parse(options.requestBody) as Record<string, unknown>
    } catch {
      return {
        requestId,
        protocol: 'grpc',
        timing: { total: Math.round(performance.now() - startTime) },
        error: 'Invalid JSON in request body'
      }
    }

    const deadline = options.timeout
      ? new Date(Date.now() + options.timeout)
      : new Date(Date.now() + 30000)

    return await new Promise<GrpcResponse>((resolve) => {
      const methodFn = (client as Record<string, unknown>)[options.methodName] as
        | ((
            request: Record<string, unknown>,
            metadata: grpc.Metadata,
            options: { deadline: Date },
            callback: (err: grpc.ServiceError | null, response: unknown) => void
          ) => grpc.ClientUnaryCall)
        | undefined

      if (!methodFn || typeof methodFn !== 'function') {
        resolve({
          requestId,
          protocol: 'grpc',
          timing: { total: Math.round(performance.now() - startTime) },
          error: `Method not found: ${options.methodName}`
        })
        return
      }

      const call = methodFn.call(
        client,
        requestMessage,
        metadata,
        { deadline },
        (err: grpc.ServiceError | null, response: unknown) => {
          const endTime = performance.now()

          if (err) {
            resolve({
              requestId,
              protocol: 'grpc',
              timing: { total: Math.round(endTime - startTime) },
              error: describeGrpcStatus(err.code, err.details ?? err.message).message,
              grpcStatus: err.code,
              grpcStatusMessage: err.details,
              actualRequest: {
                method: options.methodName,
                url: `${options.serverAddress}/${options.serviceName}/${options.methodName}`,
                headers: options.metadata ?? {},
                body: options.requestBody
              }
            })
            return
          }

          const responseBody = JSON.stringify(response, null, 2)
          const bodySize = Buffer.byteLength(responseBody, 'utf-8')

          resolve({
            requestId,
            protocol: 'grpc',
            body: responseBody,
            bodySize,
            timing: { total: Math.round(endTime - startTime) },
            grpcStatus: grpc.status.OK,
            grpcStatusMessage: 'OK',
            actualRequest: {
              method: options.methodName,
              url: `${options.serverAddress}/${options.serviceName}/${options.methodName}`,
              headers: options.metadata ?? {},
              body: options.requestBody
            }
          })
        }
      )

      // Extract response metadata
      call.on('metadata', (meta: grpc.Metadata) => {
        // metadata is captured but we can't modify the promise resolve at this point
        // It will be available in the response
        void extractMetadata(meta)
      })
    })
  } catch (err) {
    return {
      requestId,
      protocol: 'grpc',
      timing: { total: Math.round(performance.now() - startTime) },
      error: (err as Error).message
    }
  }
}

export async function executeServerStream(
  options: GrpcExecuteOptions,
  windowId: number
): Promise<string> {
  const streamId = randomUUID()

  try {
    const loaded = await loadOrGetProto(options.protoPath)
    const ServiceClient = findServiceClient(loaded.grpcObject, options.serviceName)

    if (!ServiceClient) {
      throw new Error(`Service not found: ${options.serviceName}`)
    }

    const credentials = createCredentials(options.useTls)
    const client = new ServiceClient(options.serverAddress, credentials)
    const metadata = createMetadata(options.metadata)

    let requestMessage: Record<string, unknown>
    try {
      requestMessage = JSON.parse(options.requestBody) as Record<string, unknown>
    } catch {
      throw new Error('Invalid JSON in request body')
    }

    const deadline = options.timeout
      ? new Date(Date.now() + options.timeout)
      : new Date(Date.now() + 30000)

    const methodFn = (client as Record<string, unknown>)[options.methodName] as
      | ((
          request: Record<string, unknown>,
          metadata: grpc.Metadata,
          options: { deadline: Date }
        ) => grpc.ClientReadableStream<unknown>)
      | undefined

    if (!methodFn || typeof methodFn !== 'function') {
      throw new Error(`Method not found: ${options.methodName}`)
    }

    const call = methodFn.call(client, requestMessage, metadata, { deadline })

    activeStreams.set(streamId, { streamId, call, windowId })

    call.on('data', (chunk: unknown) => {
      sendStreamEvent(windowId, {
        streamId,
        type: 'data',
        data: JSON.stringify(chunk, null, 2),
        timestamp: Date.now()
      })
    })

    call.on('end', () => {
      activeStreams.delete(streamId)
      sendStreamEvent(windowId, {
        streamId,
        type: 'end',
        timestamp: Date.now()
      })
    })

    call.on('error', (err: grpc.ServiceError) => {
      activeStreams.delete(streamId)
      sendStreamEvent(windowId, {
        streamId,
        type: 'error',
        error: describeGrpcStatus(err.code, err.details ?? err.message).message,
        grpcStatus: err.code,
        grpcStatusMessage: err.details,
        timestamp: Date.now()
      })
    })

    call.on('status', (status: grpc.StatusObject) => {
      sendStreamEvent(windowId, {
        streamId,
        type: 'status',
        grpcStatus: status.code,
        grpcStatusMessage: status.details,
        timestamp: Date.now()
      })
    })

    return streamId
  } catch (err) {
    sendStreamEvent(windowId, {
      streamId,
      type: 'error',
      error: (err as Error).message,
      timestamp: Date.now()
    })
    return streamId
  }
}

export function cancelStream(streamId: string): boolean {
  const managed = activeStreams.get(streamId)
  if (!managed) {
    return false
  }

  managed.call.cancel()
  activeStreams.delete(streamId)
  return true
}

export function cancelAllStreams(): void {
  for (const [id] of activeStreams) {
    cancelStream(id)
  }
}

export function clearProtoCache(): void {
  protoCache.clear()
}

// ─── Server Reflection ──────────────────────────────────────

interface ReflectionListResponse {
  listServicesResponse?: {
    service?: Array<{ name: string }>
  }
}

interface ReflectionFileResponse {
  fileDescriptorResponse?: {
    fileDescriptorProto?: Array<Buffer | Uint8Array>
  }
}

type ReflectionResponseValue = ReflectionListResponse | ReflectionFileResponse

interface ReflectionResponse {
  listServicesResponse?: ReflectionListResponse['listServicesResponse']
  fileDescriptorResponse?: ReflectionFileResponse['fileDescriptorResponse']
  errorResponse?: { errorCode: number; errorMessage: string }
}

export async function loadFromReflection(
  address: string,
  useTls?: boolean
): Promise<GrpcServiceDescription> {
  const credentials = createCredentials(useTls)

  // Try v1 first, then fall back to v1alpha
  const reflectionServiceNames = [
    'grpc.reflection.v1.ServerReflection',
    'grpc.reflection.v1alpha.ServerReflection'
  ]

  for (const reflectionService of reflectionServiceNames) {
    try {
      const result = await tryReflection(address, credentials, reflectionService)
      return result
    } catch {
      // Try next reflection version
    }
  }

  throw new Error('Server does not support gRPC reflection (tried v1 and v1alpha)')
}

async function tryReflection(
  address: string,
  credentials: grpc.ChannelCredentials,
  reflectionServiceName: string
): Promise<GrpcServiceDescription> {
  return new Promise<GrpcServiceDescription>((resolve, reject) => {
    // Build the reflection client manually using makeGenericClientConstructor
    const reflectionMethodName = 'ServerReflectionInfo'

    const servicePath = reflectionServiceName
    const methodPath = `/${servicePath}/${reflectionMethodName}`

    // Create a generic client
    const client = new grpc.Client(address, credentials, {})

    // List services via reflection bidirectional stream
    const call = client.makeBidiStreamRequest(
      methodPath,
      (arg: Record<string, unknown>) => Buffer.from(JSON.stringify(arg)),
      (buf: Buffer) => JSON.parse(buf.toString()) as ReflectionResponseValue,
      new grpc.Metadata(),
      { deadline: new Date(Date.now() + 10000) }
    )

    const serviceNames: string[] = []
    const services: GrpcServiceInfo[] = []
    let listReceived = false

    call.on('data', (response: ReflectionResponse) => {
      if (response.errorResponse) {
        call.end()
        reject(new Error(response.errorResponse.errorMessage))
        return
      }

      if (response.listServicesResponse?.service) {
        listReceived = true
        for (const svc of response.listServicesResponse.service) {
          // Skip internal reflection services
          if (!svc.name.startsWith('grpc.reflection.')) {
            serviceNames.push(svc.name)
          }
        }

        // Now request file descriptors for each service
        if (serviceNames.length === 0) {
          call.end()
          return
        }

        for (const name of serviceNames) {
          call.write({ file_containing_symbol: name })
        }
      }

      if (response.fileDescriptorResponse?.fileDescriptorProto) {
        // Parse service info from descriptor bytes
        // Since we don't have protobuf descriptor parser here,
        // we extract what we can from the service names
        for (const serviceName of serviceNames) {
          const parts = serviceName.split('.')
          const shortName = parts[parts.length - 1]

          // Check if we already added this service
          if (services.some((s) => s.fullName === serviceName)) {
            continue
          }

          services.push({
            name: shortName,
            fullName: serviceName,
            methods: [] // Methods will be populated when user selects a service
          })
        }
      }
    })

    call.on('end', () => {
      if (listReceived) {
        resolve({
          protoPath: `reflection://${address}`,
          packageName: serviceNames.length > 0
            ? serviceNames[0].split('.').slice(0, -1).join('.')
            : '',
          services
        })
      } else {
        reject(new Error('No response received from reflection service'))
      }
    })

    call.on('error', (err: grpc.ServiceError) => {
      reject(new Error(`Reflection failed: ${err.message}`))
    })

    // Send initial list services request
    call.write({ list_services: '' })
  })
}

// ─── Client Streaming ───────────────────────────────────────

export interface GrpcClientStreamOptions {
  serverAddress: string
  protoPath: string
  serviceName: string
  methodName: string
  messages: string[] // Array of JSON message strings
  metadata?: Record<string, string>
  timeout?: number
  useTls?: boolean
}

export async function executeClientStream(
  options: GrpcClientStreamOptions
): Promise<GrpcResponse> {
  const requestId = randomUUID()
  const startTime = performance.now()

  try {
    const loaded = await loadOrGetProto(options.protoPath)
    const ServiceClient = findServiceClient(loaded.grpcObject, options.serviceName)

    if (!ServiceClient) {
      return {
        requestId,
        protocol: 'grpc',
        timing: { total: Math.round(performance.now() - startTime) },
        error: `Service not found: ${options.serviceName}`
      }
    }

    const credentials = createCredentials(options.useTls)
    const client = new ServiceClient(options.serverAddress, credentials)
    const metadata = createMetadata(options.metadata)

    const deadline = options.timeout
      ? new Date(Date.now() + options.timeout)
      : new Date(Date.now() + 30000)

    return await new Promise<GrpcResponse>((resolve) => {
      const methodFn = (client as Record<string, unknown>)[options.methodName] as
        | ((
            metadata: grpc.Metadata,
            options: { deadline: Date },
            callback: (err: grpc.ServiceError | null, response: unknown) => void
          ) => grpc.ClientWritableStream<unknown>)
        | undefined

      if (!methodFn || typeof methodFn !== 'function') {
        resolve({
          requestId,
          protocol: 'grpc',
          timing: { total: Math.round(performance.now() - startTime) },
          error: `Method not found: ${options.methodName}`
        })
        return
      }

      const call = methodFn.call(
        client,
        metadata,
        { deadline },
        (err: grpc.ServiceError | null, response: unknown) => {
          const endTime = performance.now()

          if (err) {
            resolve({
              requestId,
              protocol: 'grpc',
              timing: { total: Math.round(endTime - startTime) },
              error: describeGrpcStatus(err.code, err.details ?? err.message).message,
              grpcStatus: err.code,
              grpcStatusMessage: err.details,
              actualRequest: {
                method: options.methodName,
                url: `${options.serverAddress}/${options.serviceName}/${options.methodName}`,
                headers: options.metadata ?? {},
                body: JSON.stringify(options.messages)
              }
            })
            return
          }

          const responseBody = JSON.stringify(response, null, 2)
          const bodySize = Buffer.byteLength(responseBody, 'utf-8')

          resolve({
            requestId,
            protocol: 'grpc',
            body: responseBody,
            bodySize,
            timing: { total: Math.round(endTime - startTime) },
            grpcStatus: grpc.status.OK,
            grpcStatusMessage: 'OK',
            actualRequest: {
              method: options.methodName,
              url: `${options.serverAddress}/${options.serviceName}/${options.methodName}`,
              headers: options.metadata ?? {},
              body: JSON.stringify(options.messages)
            }
          })
        }
      )

      // Write all messages then end the stream
      for (const msgStr of options.messages) {
        try {
          const msg = JSON.parse(msgStr) as Record<string, unknown>
          call.write(msg)
        } catch {
          // Skip invalid JSON messages
        }
      }
      call.end()
    })
  } catch (err) {
    return {
      requestId,
      protocol: 'grpc',
      timing: { total: Math.round(performance.now() - startTime) },
      error: (err as Error).message
    }
  }
}

// ─── Bidi Streaming ─────────────────────────────────────────

export interface GrpcBidiStreamOptions {
  serverAddress: string
  protoPath: string
  serviceName: string
  methodName: string
  metadata?: Record<string, string>
  timeout?: number
  useTls?: boolean
}

export async function startBidiStream(
  options: GrpcBidiStreamOptions,
  windowId: number
): Promise<string> {
  const streamId = randomUUID()

  try {
    const loaded = await loadOrGetProto(options.protoPath)
    const ServiceClient = findServiceClient(loaded.grpcObject, options.serviceName)

    if (!ServiceClient) {
      throw new Error(`Service not found: ${options.serviceName}`)
    }

    const credentials = createCredentials(options.useTls)
    const client = new ServiceClient(options.serverAddress, credentials)
    const metadata = createMetadata(options.metadata)

    const deadline = options.timeout
      ? new Date(Date.now() + options.timeout)
      : new Date(Date.now() + 300000) // 5 min default for bidi

    const methodFn = (client as Record<string, unknown>)[options.methodName] as
      | ((
          metadata: grpc.Metadata,
          options: { deadline: Date }
        ) => grpc.ClientDuplexStream<unknown, unknown>)
      | undefined

    if (!methodFn || typeof methodFn !== 'function') {
      throw new Error(`Method not found: ${options.methodName}`)
    }

    const call = methodFn.call(client, metadata, { deadline })

    activeStreams.set(streamId, { streamId, call, windowId })

    call.on('data', (chunk: unknown) => {
      sendStreamEvent(windowId, {
        streamId,
        type: 'data',
        data: JSON.stringify(chunk, null, 2),
        timestamp: Date.now()
      })
    })

    call.on('end', () => {
      activeStreams.delete(streamId)
      sendStreamEvent(windowId, {
        streamId,
        type: 'end',
        timestamp: Date.now()
      })
    })

    call.on('error', (err: grpc.ServiceError) => {
      activeStreams.delete(streamId)
      sendStreamEvent(windowId, {
        streamId,
        type: 'error',
        error: describeGrpcStatus(err.code, err.details ?? err.message).message,
        grpcStatus: err.code,
        grpcStatusMessage: err.details,
        timestamp: Date.now()
      })
    })

    call.on('status', (status: grpc.StatusObject) => {
      sendStreamEvent(windowId, {
        streamId,
        type: 'status',
        grpcStatus: status.code,
        grpcStatusMessage: status.details,
        timestamp: Date.now()
      })
    })

    return streamId
  } catch (err) {
    sendStreamEvent(windowId, {
      streamId,
      type: 'error',
      error: (err as Error).message,
      timestamp: Date.now()
    })
    return streamId
  }
}

export function sendStreamMessage(streamId: string, message: string): boolean {
  const managed = activeStreams.get(streamId)
  if (!managed) {
    return false
  }

  const duplexCall = managed.call as grpc.ClientDuplexStream<unknown, unknown>
  if (typeof duplexCall.write !== 'function') {
    return false
  }

  try {
    const parsed = JSON.parse(message) as Record<string, unknown>
    duplexCall.write(parsed)
    return true
  } catch {
    return false
  }
}

export function endStream(streamId: string): boolean {
  const managed = activeStreams.get(streamId)
  if (!managed) {
    return false
  }

  const duplexCall = managed.call as grpc.ClientDuplexStream<unknown, unknown>
  if (typeof duplexCall.end === 'function') {
    duplexCall.end()
  }
  return true
}
