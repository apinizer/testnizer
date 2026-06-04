import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as protoLoader from '@grpc/proto-loader'
import {
  buildJsonSkeletonFromProtoMessage,
  makeProtoTypeLookup,
  loadProto,
} from '../../src/main/protocols/grpc.engine'

// ─── Helpers ────────────────────────────────────────────────

function writeProto(dir: string, filename: string, contents: string): string {
  const file = path.join(dir, filename)
  writeFileSync(file, contents, 'utf-8')
  return file
}

async function loadPackage(file: string): Promise<protoLoader.PackageDefinition> {
  return await protoLoader.load(file, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
}

let workDir: string
beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'testnizer-proto-skeleton-'))
})
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

// ─── Skeleton from scalar fields ────────────────────────────

describe('buildJsonSkeletonFromProtoMessage — simple scalar types', () => {
  it('produces zero values for string / int32 / bool / double / int64 / float', async () => {
    const proto = [
      'syntax = "proto3";',
      'package test;',
      'message ScalarReq {',
      '  string name = 1;',
      '  int32 id = 2;',
      '  bool active = 3;',
      '  double score = 4;',
      '  int64 big = 5;',
      '  float ratio = 6;',
      '  bytes blob = 7;',
      '}',
    ].join('\n')
    const file = writeProto(workDir, 'scalar.proto', proto)
    const pkg = await loadPackage(file)
    const messageDef = pkg['test.ScalarReq'] as protoLoader.MessageTypeDefinition
    const lookup = makeProtoTypeLookup(pkg, 'test')

    const skeleton = buildJsonSkeletonFromProtoMessage(messageDef, lookup)

    expect(skeleton).toEqual({
      name: '',
      id: 0,
      active: false,
      score: 0,
      big: '0', // longs option = String
      ratio: 0,
      blob: '',
    })
  })
})

// ─── Nested message skeletons ───────────────────────────────

describe('buildJsonSkeletonFromProtoMessage — nested message', () => {
  it('produces a recursively zero-valued object for nested messages', async () => {
    const proto = [
      'syntax = "proto3";',
      'package test;',
      'message Inner {',
      '  string label = 1;',
      '  int32 weight = 2;',
      '}',
      'message Outer {',
      '  string title = 1;',
      '  Inner inner = 2;',
      '}',
    ].join('\n')
    const file = writeProto(workDir, 'nested.proto', proto)
    const pkg = await loadPackage(file)
    const messageDef = pkg['test.Outer'] as protoLoader.MessageTypeDefinition
    const lookup = makeProtoTypeLookup(pkg, 'test')

    const skeleton = buildJsonSkeletonFromProtoMessage(messageDef, lookup)

    expect(skeleton).toEqual({
      title: '',
      inner: { label: '', weight: 0 },
    })
  })

  it('falls back to empty {} when the nested type cannot be resolved', async () => {
    const proto = [
      'syntax = "proto3";',
      'package test;',
      'message Wrap {',
      '  Stub stub = 1;',
      '}',
      'message Stub { string ok = 1; }',
    ].join('\n')
    const file = writeProto(workDir, 'nested-fallback.proto', proto)
    const pkg = await loadPackage(file)
    const messageDef = pkg['test.Wrap'] as protoLoader.MessageTypeDefinition
    // Lookup that intentionally returns nothing → graceful empty {}
    const skeleton = buildJsonSkeletonFromProtoMessage(messageDef, () => undefined)
    expect(skeleton).toEqual({ stub: {} })
  })
})

// ─── Repeated fields ────────────────────────────────────────

describe('buildJsonSkeletonFromProtoMessage — repeated', () => {
  it('emits [] for repeated scalars and repeated messages', async () => {
    const proto = [
      'syntax = "proto3";',
      'package test;',
      'message Item { string id = 1; }',
      'message Bag {',
      '  repeated string tags = 1;',
      '  repeated int32 numbers = 2;',
      '  repeated Item items = 3;',
      '}',
    ].join('\n')
    const file = writeProto(workDir, 'repeated.proto', proto)
    const pkg = await loadPackage(file)
    const messageDef = pkg['test.Bag'] as protoLoader.MessageTypeDefinition
    const lookup = makeProtoTypeLookup(pkg, 'test')

    const skeleton = buildJsonSkeletonFromProtoMessage(messageDef, lookup)

    expect(skeleton).toEqual({
      tags: [],
      numbers: [],
      items: [],
    })
  })
})

// ─── Enum fields ────────────────────────────────────────────

describe('buildJsonSkeletonFromProtoMessage — enum', () => {
  it('uses the first declared enum value name', async () => {
    const proto = [
      'syntax = "proto3";',
      'package test;',
      'enum Color { RED = 0; GREEN = 1; BLUE = 2; }',
      'message Paint { Color color = 1; string label = 2; }',
    ].join('\n')
    const file = writeProto(workDir, 'enum.proto', proto)
    const pkg = await loadPackage(file)
    const messageDef = pkg['test.Paint'] as protoLoader.MessageTypeDefinition
    const lookup = makeProtoTypeLookup(pkg, 'test')

    const skeleton = buildJsonSkeletonFromProtoMessage(messageDef, lookup)

    expect(skeleton).toEqual({ color: 'RED', label: '' })
  })

  it('falls back to "" when the enum cannot be resolved', async () => {
    const proto = [
      'syntax = "proto3";',
      'package test;',
      'enum Mode { OFF = 0; ON = 1; }',
      'message Cfg { Mode mode = 1; }',
    ].join('\n')
    const file = writeProto(workDir, 'enum-fallback.proto', proto)
    const pkg = await loadPackage(file)
    const messageDef = pkg['test.Cfg'] as protoLoader.MessageTypeDefinition
    const skeleton = buildJsonSkeletonFromProtoMessage(messageDef, () => undefined)
    expect(skeleton).toEqual({ mode: '' })
  })
})

// ─── Well-known types & graceful behavior ───────────────────

describe('buildJsonSkeletonFromProtoMessage — google.protobuf well-known types', () => {
  it('handles google.protobuf.Empty (no fields) gracefully', async () => {
    const proto = [
      'syntax = "proto3";',
      'import "google/protobuf/empty.proto";',
      'package test;',
      'message Wrap { google.protobuf.Empty empty = 1; string note = 2; }',
    ].join('\n')
    const file = writeProto(workDir, 'wkt-empty.proto', proto)
    const pkg = await loadPackage(file)
    const messageDef = pkg['test.Wrap'] as protoLoader.MessageTypeDefinition
    const lookup = makeProtoTypeLookup(pkg, 'test')

    const skeleton = buildJsonSkeletonFromProtoMessage(messageDef, lookup)

    // Empty has no fields → resolves to {}; note is a scalar string → ''
    expect(skeleton).toEqual({ empty: {}, note: '' })
  })

  it('handles google.protobuf.Any by emitting its field skeleton', async () => {
    const proto = [
      'syntax = "proto3";',
      'import "google/protobuf/any.proto";',
      'package test;',
      'message Holder { google.protobuf.Any payload = 1; }',
    ].join('\n')
    const file = writeProto(workDir, 'wkt-any.proto', proto)
    const pkg = await loadPackage(file)
    const messageDef = pkg['test.Holder'] as protoLoader.MessageTypeDefinition
    const lookup = makeProtoTypeLookup(pkg, 'test')

    const skeleton = buildJsonSkeletonFromProtoMessage(messageDef, lookup) as {
      payload: Record<string, unknown>
    }

    // Any has type_url (string) + value (bytes) → both default to ''
    expect(skeleton.payload).toEqual({ type_url: '', value: '' })
  })
})

// ─── End-to-end: loadProto attaches requestSkeleton ─────────

describe('loadProto — attaches requestSkeleton on each method', () => {
  it('returns a JSON skeleton string for each gRPC method request type', async () => {
    const proto = [
      'syntax = "proto3";',
      'package test;',
      'message EchoRequest {',
      '  string name = 1;',
      '  int32 id = 2;',
      '  bool active = 3;',
      '}',
      'message EchoResponse { string echo = 1; }',
      'service EchoService {',
      '  rpc Echo (EchoRequest) returns (EchoResponse);',
      '}',
    ].join('\n')
    const file = writeProto(workDir, 'echo.proto', proto)

    const description = await loadProto(file)

    expect(description.services).toHaveLength(1)
    const service = description.services[0]
    expect(service.name).toBe('EchoService')
    expect(service.methods).toHaveLength(1)

    const echo = service.methods[0]
    expect(echo.name).toBe('Echo')
    expect(echo.requestType).toBe('EchoRequest')
    expect(echo.requestSkeleton).toBeTypeOf('string')

    const parsed = JSON.parse(echo.requestSkeleton!) as Record<string, unknown>
    expect(parsed).toEqual({ name: '', id: 0, active: false })
  })

  it('produces an empty object skeleton for a request type with no fields', async () => {
    const proto = [
      'syntax = "proto3";',
      'import "google/protobuf/empty.proto";',
      'package test;',
      'message PingResponse { string pong = 1; }',
      'service Pinger {',
      '  rpc Ping (google.protobuf.Empty) returns (PingResponse);',
      '}',
    ].join('\n')
    const file = writeProto(workDir, 'pinger.proto', proto)

    const description = await loadProto(file)

    const ping = description.services[0].methods[0]
    expect(ping.name).toBe('Ping')
    expect(ping.requestSkeleton).toBeTypeOf('string')
    expect(JSON.parse(ping.requestSkeleton!)).toEqual({})
  })
})
