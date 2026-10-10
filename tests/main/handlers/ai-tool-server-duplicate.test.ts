/**
 * Issue #180 — Duplicate project / Import as new: an AI Chat request's Tools
 * config references saved MCP requests by row id. The copy must point at the
 * COPY's MCP requests (fresh ids); a reference with no counterpart is dropped
 * and the server marked `missing` — never left pointing at the source.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { makeElectronMock, createTestDb, seedWorkspace, seedProject } from './helpers'

let testDb: Database.Database
vi.mock('electron', () => makeElectronMock())
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { exportProjectData, importProjectAsNew } = await import('../../../src/main/ipc/save.handler')
const { remapAiToolServerRefs } = await import('../../../src/main/lib/ai-tool-server-remap')

let wsId: string
let projectId: string

beforeEach(() => {
  testDb = createTestDb()
  wsId = seedWorkspace(testDb)
  projectId = seedProject(testDb, wsId)
})

const now = Date.now()
function endpoint(id: string, protocol: string, schema: unknown): void {
  testDb
    .prepare(
      `INSERT INTO endpoints (id, project_id, name, protocol, method, path, request_schema, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'POST', 'u', ?, ?, ?)`,
    )
    .run(id, projectId, id, protocol, JSON.stringify(schema), now, now)
}
function savedRequest(id: string, protocol: string, metadata: unknown): void {
  testDb
    .prepare(
      `INSERT INTO saved_requests (id, project_id, name, protocol, method, url, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'POST', 'u', ?, ?, ?)`,
    )
    .run(id, projectId, id, protocol, JSON.stringify(metadata), now, now)
}

const servers = [
  {
    id: 'a',
    source: 'saved',
    name: 'E',
    enabled: true,
    requestId: 'mcp-ep',
    requestKind: 'endpoint',
    disabledTools: [],
  },
  {
    id: 'b',
    source: 'saved',
    name: 'S',
    enabled: true,
    requestId: 'mcp-sr',
    requestKind: 'request',
    disabledTools: ['x'],
  },
  {
    id: 'c',
    source: 'saved',
    name: 'Ghost',
    enabled: true,
    requestId: 'not-in-project',
    requestKind: 'endpoint',
    disabledTools: [],
  },
  {
    id: 'd',
    source: 'adhoc',
    name: 'Adhoc',
    enabled: true,
    transport: 'http',
    url: 'http://h',
    disabledTools: [],
  },
]

describe('Duplicate project remaps AI tool server references', () => {
  it('endpoint + saved-request AI rows point at the copy; unmapped → missing', () => {
    endpoint('mcp-ep', 'mcp', { metadata: { mcp: { transport: 'http', url: 'http://e' } } })
    savedRequest('mcp-sr', 'mcp', { mcp: { transport: 'http', url: 'http://s' } })
    endpoint('ai-ep', 'ai', {
      url: 'x',
      metadata: { ai: { provider: 'openai', toolServers: servers } },
    })
    savedRequest('ai-sr', 'ai', { ai: { provider: 'openai', toolServers: servers }, timeout: 5 })

    const { projectId: copyId } = importProjectAsNew(exportProjectData(projectId), wsId, {
      name: 'copy',
    })

    const copyEp = (name: string): { id: string; request_schema: string } =>
      testDb
        .prepare('SELECT id, request_schema FROM endpoints WHERE project_id = ? AND name = ?')
        .get(copyId, name) as { id: string; request_schema: string }
    const copySr = (name: string): { id: string; metadata: string } =>
      testDb
        .prepare('SELECT id, metadata FROM saved_requests WHERE project_id = ? AND name = ?')
        .get(copyId, name) as { id: string; metadata: string }
    const newMcpEp = copyEp('mcp-ep').id
    const newMcpSr = copySr('mcp-sr').id
    expect(newMcpEp).not.toBe('mcp-ep')

    const fromEp = JSON.parse(copyEp('ai-ep').request_schema).metadata.ai.toolServers
    const fromSr = JSON.parse(copySr('ai-sr').metadata).ai.toolServers
    for (const list of [fromEp, fromSr]) {
      expect(list[0]).toMatchObject({ id: 'a', requestId: newMcpEp, requestKind: 'endpoint' })
      expect(list[1]).toMatchObject({ id: 'b', requestId: newMcpSr, disabledTools: ['x'] })
      expect(list[2]).toMatchObject({ id: 'c', missing: true })
      expect(list[2].requestId).toBeUndefined()
      expect(list[3]).toEqual(servers[3])
    }
    expect(JSON.parse(copySr('ai-sr').metadata).timeout).toBe(5)

    // The source project is untouched.
    const src = testDb
      .prepare('SELECT request_schema FROM endpoints WHERE id = ?')
      .get('ai-ep') as {
      request_schema: string
    }
    expect(JSON.parse(src.request_schema).metadata.ai.toolServers[0].requestId).toBe('mcp-ep')
  })

  it('a row without tool servers is copied byte-for-byte', () => {
    const json = JSON.stringify({ metadata: { ai: { provider: 'openai' } }, url: 'x' })
    expect(remapAiToolServerRefs(json, () => 'n')).toBe(json)
    expect(remapAiToolServerRefs(null, () => 'n')).toBeNull()
    expect(remapAiToolServerRefs('{not json toolServers', () => 'n')).toBe('{not json toolServers')
  })
})
