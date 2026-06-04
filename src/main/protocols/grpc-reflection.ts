/**
 * gRPC Server Reflection client.
 *
 * Talks the standard `grpc.reflection.v1` (and `v1alpha`) protocol with a real
 * protobuf wire format — earlier versions of this code used `JSON.stringify`
 * for the message body, which never matched what compliant servers expect, so
 * any server (including `demo.connectrpc.com:443`, which DOES support
 * reflection) replied with an error and we fell back to the
 * "Server does not support gRPC reflection" branch.
 *
 * Flow:
 *   1. Send `ListServices` → receive service names.
 *   2. For each non-internal service, send `FileContainingSymbol`.
 *   3. Walk the `dependency` field of each returned `FileDescriptorProto` and
 *      pull in any imports we have not yet seen via `FileByFilename`.
 *   4. Concatenate all unique `FileDescriptorProto` bytes into a wire-encoded
 *      `FileDescriptorSet` and hand it to `@grpc/proto-loader`'s
 *      `loadFileDescriptorSetFromBuffer`, which gives us a `PackageDefinition`
 *      identical to the one a local `.proto` file would produce.
 */

import * as grpc from '@grpc/grpc-js'
import * as protobuf from 'protobufjs'

// ─── Inline reflection.proto (subset we actually use) ─────────
//
// Kept inline so the build + packaging pipeline does not need to ship an
// extra resource file. Only the messages we exchange are declared.
const REFLECTION_PROTO = `
syntax = "proto3";

package grpc.reflection.v1;

service ServerReflection {
  rpc ServerReflectionInfo(stream ServerReflectionRequest) returns (stream ServerReflectionResponse);
}

message ServerReflectionRequest {
  string host = 1;
  oneof message_request {
    string file_by_filename = 3;
    string file_containing_symbol = 4;
    ExtensionRequest file_containing_extension = 5;
    string all_extension_numbers_of_type = 6;
    string list_services = 7;
  }
}

message ExtensionRequest {
  string containing_type = 1;
  int32 extension_number = 2;
}

message ServerReflectionResponse {
  string valid_host = 1;
  ServerReflectionRequest original_request = 2;
  oneof message_response {
    FileDescriptorResponse file_descriptor_response = 4;
    ExtensionNumberResponse all_extension_numbers_response = 5;
    ListServiceResponse list_services_response = 6;
    ErrorResponse error_response = 7;
  }
}

message FileDescriptorResponse {
  repeated bytes file_descriptor_proto = 1;
}

message ExtensionNumberResponse {
  string base_type_name = 1;
  repeated int32 extension_number = 2;
}

message ListServiceResponse {
  repeated ServiceResponse service = 1;
}

message ServiceResponse {
  string name = 1;
}

message ErrorResponse {
  int32 error_code = 1;
  string error_message = 2;
}
`

let reflectionRoot: protobuf.Root | null = null
let RequestType: protobuf.Type | null = null
let ResponseType: protobuf.Type | null = null

function ensureProtoTypes(): void {
  if (!reflectionRoot) {
    reflectionRoot = protobuf.parse(REFLECTION_PROTO, { keepCase: true }).root
    RequestType = reflectionRoot.lookupType('grpc.reflection.v1.ServerReflectionRequest')
    ResponseType = reflectionRoot.lookupType('grpc.reflection.v1.ServerReflectionResponse')
  }
}

/**
 * Minimal hand-rolled `FileDescriptorProto` parser. We only need the `name`
 * (field 1) and `dependency` (field 3) entries to walk the import graph;
 * decoding the full proto via `protobufjs.loadSync('descriptor.proto')` would
 * require the descriptor file at runtime, which is not bundled into the
 * Electron build (`require.resolve(...)` returns null and crashes inside
 * `readFileSync`).
 */
function parseFileDescriptorMinimal(buf: Buffer): { name?: string; dependency: string[] } {
  const result: { name?: string; dependency: string[] } = { dependency: [] }
  let offset = 0
  while (offset < buf.length) {
    const tagInfo = readVarintBuf(buf, offset)
    offset += tagInfo.length
    const fieldNumber = tagInfo.value >>> 3
    const wireType = tagInfo.value & 0x7

    if (wireType === 2) {
      const lenInfo = readVarintBuf(buf, offset)
      offset += lenInfo.length
      const end = offset + lenInfo.value
      if (fieldNumber === 1) {
        result.name = buf.subarray(offset, end).toString('utf-8')
      } else if (fieldNumber === 3) {
        result.dependency.push(buf.subarray(offset, end).toString('utf-8'))
      }
      offset = end
    } else if (wireType === 0) {
      const v = readVarintBuf(buf, offset)
      offset += v.length
    } else if (wireType === 1) {
      offset += 8
    } else if (wireType === 5) {
      offset += 4
    } else {
      // Unsupported wire type — bail out rather than risk reading past EOF.
      break
    }
  }
  return result
}

function readVarintBuf(buf: Buffer, offset: number): { value: number; length: number } {
  let value = 0
  let shift = 0
  let length = 0
  while (offset + length < buf.length) {
    const byte = buf[offset + length]
    value |= (byte & 0x7f) << shift
    length++
    if ((byte & 0x80) === 0) return { value: value >>> 0, length }
    shift += 7
    if (shift > 35) throw new Error('Varint too long')
  }
  throw new Error('Unexpected end of buffer reading varint')
}

// Re-export for the engine to build a FileDescriptorSet.
export interface ReflectionResult {
  /** Wire-encoded FileDescriptorSet (suitable for `loadFileDescriptorSetFromBuffer`). */
  fileDescriptorSetBuffer: Buffer
  /** Fully-qualified service names returned by ListServices, minus the reflection ones. */
  serviceNames: string[]
}

interface ParsedDescriptor {
  name: string
  dependency: string[]
  bytes: Buffer
}

/**
 * Wraps a list of pre-encoded `FileDescriptorProto` byte chunks into the
 * `FileDescriptorSet` wire format. We do this by hand instead of using
 * protobufjs so we never re-encode descriptor messages we already have on
 * the wire — this keeps the bytes byte-identical to what the server sent
 * (avoids any field-ordering surprises).
 */
function buildFileDescriptorSet(fileBuffers: Buffer[]): Buffer {
  const parts: Buffer[] = []
  for (const buf of fileBuffers) {
    // tag = (field_number << 3) | wire_type. file is field 1, wire type 2 (length-delimited)
    parts.push(Buffer.from([0x0a]), encodeVarint(buf.length), buf)
  }
  return Buffer.concat(parts)
}

function encodeVarint(n: number): Buffer {
  const bytes: number[] = []
  let value = n
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  bytes.push(value & 0x7f)
  return Buffer.from(bytes)
}

/**
 * Performs a single bidi-streaming `ServerReflectionInfo` call and returns
 * a fully resolved FileDescriptorSet covering every service the server
 * exposes (plus their imports).
 */
export async function fetchReflection(
  address: string,
  credentials: grpc.ChannelCredentials,
  reflectionService = 'grpc.reflection.v1.ServerReflection',
): Promise<ReflectionResult> {
  ensureProtoTypes()
  if (!RequestType || !ResponseType) {
    throw new Error('Failed to bootstrap reflection proto types')
  }

  const methodPath = `/${reflectionService}/ServerReflectionInfo`
  const client = new grpc.Client(address, credentials, {})

  // protobuf-encoded serializer/deserializer (replaces the old broken JSON impl)
  const serializeRequest = (msg: object): Buffer => {
    const err = RequestType!.verify(msg)
    if (err) throw new Error(`Reflection request invalid: ${err}`)
    return Buffer.from(RequestType!.encode(RequestType!.create(msg)).finish())
  }
  const deserializeResponse = (buf: Buffer): Record<string, unknown> => {
    return ResponseType!.toObject(ResponseType!.decode(buf), {
      bytes: Buffer,
      arrays: true,
      defaults: false,
      enums: String,
      longs: String,
    }) as Record<string, unknown>
  }

  return new Promise<ReflectionResult>((resolve, reject) => {
    const call = client.makeBidiStreamRequest(
      methodPath,
      serializeRequest,
      deserializeResponse,
      new grpc.Metadata(),
      { deadline: new Date(Date.now() + 15000) },
    )

    const fetchedFiles = new Map<string, ParsedDescriptor>()
    const fetchedSymbols = new Set<string>()
    const requestedSymbols = new Set<string>()
    const requestedFiles = new Set<string>()
    let serviceNames: string[] = []
    let listReceived = false
    let pending = 0
    let closed = false

    function maybeFinish(): void {
      if (closed) return
      if (!listReceived) return
      if (pending > 0) return
      closed = true
      try {
        call.end()
      } catch {
        /* noop */
      }
      const allBuffers = Array.from(fetchedFiles.values()).map((f) => f.bytes)
      resolve({
        fileDescriptorSetBuffer: buildFileDescriptorSet(allBuffers),
        serviceNames,
      })
    }

    function fail(err: Error): void {
      if (closed) return
      closed = true
      try {
        call.cancel()
      } catch {
        /* noop */
      }
      reject(err)
    }

    function requestFileBySymbol(symbol: string): void {
      if (requestedSymbols.has(symbol) || fetchedSymbols.has(symbol)) return
      requestedSymbols.add(symbol)
      pending++
      call.write({ file_containing_symbol: symbol })
    }

    function requestFileByFilename(filename: string): void {
      if (requestedFiles.has(filename) || fetchedFiles.has(filename)) return
      requestedFiles.add(filename)
      pending++
      call.write({ file_by_filename: filename })
    }

    call.on('data', (response: Record<string, unknown>) => {
      // ── error returned by the server ─────────────
      const errorResponse = response.error_response as
        | { error_code?: number; error_message?: string }
        | undefined
      if (errorResponse) {
        const msg = errorResponse.error_message || `Reflection error ${errorResponse.error_code}`
        fail(new Error(msg))
        return
      }

      // ── ListServices response ────────────────────
      const listResp = response.list_services_response as
        | { service?: Array<{ name?: string }> }
        | undefined
      if (listResp?.service) {
        listReceived = true
        serviceNames = []
        for (const svc of listResp.service) {
          if (!svc.name) continue
          if (svc.name.startsWith('grpc.reflection.')) continue
          serviceNames.push(svc.name)
        }
        if (serviceNames.length === 0) {
          maybeFinish()
          return
        }
        for (const sym of serviceNames) {
          requestFileBySymbol(sym)
        }
        return
      }

      // ── FileDescriptor response ──────────────────
      const fileResp = response.file_descriptor_response as
        | { file_descriptor_proto?: Array<Buffer | Uint8Array | string> }
        | undefined
      if (fileResp?.file_descriptor_proto) {
        // The original request — we use its kind to decrement `pending` exactly once
        const original = response.original_request as
          | { file_containing_symbol?: string; file_by_filename?: string }
          | undefined

        for (const raw of fileResp.file_descriptor_proto) {
          const buf = Buffer.isBuffer(raw)
            ? raw
            : typeof raw === 'string'
              ? Buffer.from(raw, 'base64')
              : Buffer.from(raw as Uint8Array)
          const decoded = parseFileDescriptorMinimal(buf)
          const fileName = decoded.name ?? `unknown-${fetchedFiles.size}.proto`

          if (!fetchedFiles.has(fileName)) {
            fetchedFiles.set(fileName, {
              name: fileName,
              dependency: decoded.dependency ?? [],
              bytes: buf,
            })
            // Pull in any imports we have not yet seen
            for (const dep of decoded.dependency ?? []) {
              requestFileByFilename(dep)
            }
          }
        }

        if (original?.file_containing_symbol) {
          fetchedSymbols.add(original.file_containing_symbol)
        }
        pending = Math.max(0, pending - 1)
        maybeFinish()
        return
      }
    })

    call.on('error', (err: Error) => fail(err))

    call.on('end', () => {
      // The peer closed — if we still have outstanding requests it's an
      // incomplete/inconsistent stream; surface that as an error.
      if (!listReceived) fail(new Error('No response received from reflection service'))
    })

    // Kick the conversation off
    pending++
    call.write({ list_services: '*' })
    pending = Math.max(0, pending - 1)
  })
}
