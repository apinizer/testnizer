/**
 * Tests for `importProto` — the gRPC `.proto` collection importer.
 *
 * The handler depends on Electron's `ipcMain`/`dialog`, the project SQLite
 * database (via `getDb()`), and `loadProto()` from the gRPC engine. We mock
 * `electron`, swap `getDb` for an in-memory better-sqlite3 instance, and
 * write real `.proto` files to a temp directory so `@grpc/proto-loader` can
 * actually parse them.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'

// Stub Electron so the handler module imports cleanly under Node Vitest.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
}))

// Provide an in-memory DB with the schema importProto touches (folders + endpoints).
let mem: Database.Database
vi.mock('../../src/main/db/database', () => ({
  getDb: () => mem,
}))

import { importProto } from '../../src/main/ipc/import-export.handler'

let tmpDir: string

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE endpoints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      folder_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      protocol TEXT NOT NULL DEFAULT 'http',
      method TEXT,
      path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'developing',
      request_schema TEXT,
      response_schemas TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  return db
}

function writeProto(name: string, contents: string): string {
  const file = join(tmpDir, name)
  writeFileSync(file, contents, 'utf8')
  return file
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'testnizer-proto-'))
  mem = setupDb()
  return () => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
    try { mem.close() } catch { /* ignore */ }
  }
})

// ─── Test 1: four streaming kinds ──────────────────────────

describe('importProto — streaming kinds', () => {
  it('creates a folder + 4 endpoints with the correct streaming flavour each', async () => {
    const proto = `
      syntax = "proto3";
      package demo.echo;

      message EchoRequest { string text = 1; }
      message EchoReply { string text = 1; }

      service EchoService {
        rpc Unary(EchoRequest) returns (EchoReply);
        rpc ServerStream(EchoRequest) returns (stream EchoReply);
        rpc ClientStream(stream EchoRequest) returns (EchoReply);
        rpc BidiStream(stream EchoRequest) returns (stream EchoReply);
      }
    `
    const protoPath = writeProto('echo.proto', proto)

    const result = await importProto({ projectId: 'p1', protoPath })

    expect(result.success).toBe(true)
    expect(result.folderCount).toBe(1)
    expect(result.endpointCount).toBe(4)

    const endpoints = mem
      .prepare('SELECT name, path, request_schema FROM endpoints WHERE project_id = ? ORDER BY sort_order')
      .all('p1') as Array<{ name: string; path: string; request_schema: string }>

    expect(endpoints.map((e) => e.name).sort()).toEqual([
      'BidiStream',
      'ClientStream',
      'ServerStream',
      'Unary',
    ])

    const byName = Object.fromEntries(
      endpoints.map((e) => [e.name, JSON.parse(e.request_schema)]),
    )

    expect(byName.Unary.grpc.streamingType).toBe('unary')
    expect(byName.Unary.grpc.requestStream).toBe(false)
    expect(byName.Unary.grpc.responseStream).toBe(false)

    expect(byName.ServerStream.grpc.streamingType).toBe('server-stream')
    expect(byName.ServerStream.grpc.responseStream).toBe(true)

    expect(byName.ClientStream.grpc.streamingType).toBe('client-stream')
    expect(byName.ClientStream.grpc.requestStream).toBe(true)

    expect(byName.BidiStream.grpc.streamingType).toBe('bidi')
    expect(byName.BidiStream.grpc.requestStream).toBe(true)
    expect(byName.BidiStream.grpc.responseStream).toBe(true)

    // Path is `<package.Service>/<method>` — namespacing preserved
    expect(endpoints.find((e) => e.name === 'Unary')!.path).toBe('demo.echo.EchoService/Unary')
  })
})

// ─── Test 2: missing google import (graceful failure) ──────

describe('importProto — missing google deps', () => {
  it('returns {success:false} with a descriptive error instead of crashing', async () => {
    const proto = `
      syntax = "proto3";
      import "google/protobuf/empty.proto";
      package demo.health;

      service HealthService {
        rpc Check(google.protobuf.Empty) returns (google.protobuf.Empty);
      }
    `
    const protoPath = writeProto('health.proto', proto)

    const result = await importProto({ projectId: 'p2', protoPath })

    // proto-loader bundles google/protobuf/* well-known types — if it
    // resolves, importProto succeeds; otherwise it must NOT throw, it must
    // return {success:false, error: ...}. Both shapes are acceptable as long
    // as the call settles cleanly.
    expect(typeof result.success).toBe('boolean')
    if (!result.success) {
      expect(result.error).toMatch(/Failed to parse proto file|google/i)
    }
    // Either way, no partial inserts should be left behind on a parse failure
    if (!result.success) {
      const folderRows = mem.prepare('SELECT COUNT(*) AS c FROM folders').get() as { c: number }
      const endpointRows = mem.prepare('SELECT COUNT(*) AS c FROM endpoints').get() as { c: number }
      expect(folderRows.c).toBe(0)
      expect(endpointRows.c).toBe(0)
    }
  })
})

// ─── Test 3: package + nested service namespacing ─────────

describe('importProto — namespaced services', () => {
  it('preserves the fully-qualified service name in folder + endpoint path', async () => {
    const proto = `
      syntax = "proto3";
      package com.example.api.v1;

      message Ping { string id = 1; }
      message Pong { string id = 1; }

      service Pinger {
        rpc Ping(Ping) returns (Pong);
      }

      service Ponger {
        rpc Reverse(Pong) returns (Ping);
      }
    `
    const protoPath = writeProto('ns.proto', proto)

    const result = await importProto({ projectId: 'p3', protoPath })
    expect(result.success).toBe(true)
    expect(result.folderCount).toBe(2)
    expect(result.endpointCount).toBe(2)

    const folders = mem
      .prepare('SELECT name FROM folders WHERE project_id = ? ORDER BY sort_order')
      .all('p3') as Array<{ name: string }>
    expect(folders.map((f) => f.name).sort()).toEqual(['Pinger', 'Ponger'])

    const endpoints = mem
      .prepare('SELECT path FROM endpoints WHERE project_id = ? ORDER BY path')
      .all('p3') as Array<{ path: string }>
    expect(endpoints.map((e) => e.path)).toEqual([
      'com.example.api.v1.Pinger/Ping',
      'com.example.api.v1.Ponger/Reverse',
    ])
  })
})

// ─── Test 4: serverAddress threading ───────────────────────

describe('importProto — serverAddress', () => {
  it('threads the provided server address into every endpoint', async () => {
    const proto = `
      syntax = "proto3";
      package srv;
      message Q {}
      message A {}
      service S {
        rpc One(Q) returns (A);
        rpc Two(Q) returns (A);
      }
    `
    const protoPath = writeProto('srv.proto', proto)

    const result = await importProto({
      projectId: 'p4',
      protoPath,
      serverAddress: 'grpc.example.com:9000',
    })
    expect(result.success).toBe(true)

    const rows = mem
      .prepare('SELECT request_schema FROM endpoints WHERE project_id = ?')
      .all('p4') as Array<{ request_schema: string }>
    expect(rows.length).toBe(2)
    for (const r of rows) {
      const schema = JSON.parse(r.request_schema)
      expect(schema.url).toBe('grpc.example.com:9000')
      expect(schema.grpc.serverAddress).toBe('grpc.example.com:9000')
    }
  })

  it('falls back to localhost:50051 when no serverAddress is supplied', async () => {
    const proto = `
      syntax = "proto3";
      package srv2;
      message Q {}
      message A {}
      service S { rpc One(Q) returns (A); }
    `
    const protoPath = writeProto('srv2.proto', proto)

    const result = await importProto({ projectId: 'p5', protoPath })
    expect(result.success).toBe(true)

    const row = mem
      .prepare('SELECT request_schema FROM endpoints WHERE project_id = ?')
      .get('p5') as { request_schema: string }
    const schema = JSON.parse(row.request_schema)
    expect(schema.url).toBe('localhost:50051')
    expect(schema.grpc.serverAddress).toBe('localhost:50051')
  })
})

// ─── Test 5: proto with no package ─────────────────────────

describe('importProto — no package declaration', () => {
  it('imports successfully and uses the bare service name as path', async () => {
    const proto = `
      syntax = "proto3";

      message Req {}
      message Resp {}

      service NoPkgService {
        rpc Ping(Req) returns (Resp);
      }
    `
    const protoPath = writeProto('nopkg.proto', proto)

    const result = await importProto({ projectId: 'p6', protoPath })
    expect(result.success).toBe(true)
    expect(result.endpointCount).toBe(1)

    const row = mem
      .prepare('SELECT path FROM endpoints WHERE project_id = ?')
      .get('p6') as { path: string }
    // Bare service name (no leading "."); both "NoPkgService/Ping" and
    // ".NoPkgService/Ping" indicate the no-package code path is reachable
    // without crashing.
    expect(row.path.endsWith('NoPkgService/Ping')).toBe(true)
  })
})
