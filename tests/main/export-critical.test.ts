/**
 * Issue #304 — the per-request Critical flag in collection exports.
 *
 * Postman has no equivalent field. Rule followed (same as the request timeout,
 * issue #185): Postman v2.1 carries it in `x-apinizer` and the v2 importer
 * reads it back; Postman v3 has no extension carrier, so the export reports it
 * in `notes` instead of dropping it silently. Testnizer project export / git
 * need nothing: `critical` is a key of the opaque `request_schema` /
 * `metadata` JSON those carry verbatim.
 *
 * Real schema (`initDatabase`) in a temp userData dir; the IPC channels the
 * renderer calls.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-export-critical-'))

type Handler = (event: unknown, ...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => tmpDir },
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      ipcHandlers.set(channel, fn)
    },
  },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))

vi.mock('../../src/main/protocols/grpc.engine', () => ({
  loadProto: () => Promise.resolve({}),
}))

import { initDatabase, getDb } from '../../src/main/db/database'
import { createSavedRequest } from '../../src/main/db/endpoint.repo'
import { registerImportExportHandlers } from '../../src/main/ipc/import-export.handler'
import { readRequestSettingsJson } from '../../src/shared/request-settings'

let workspaceId: string
let projectId: string

beforeAll(() => {
  initDatabase()
  registerImportExportHandlers()
})

function newProject(name: string): string {
  const now = Date.now()
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'http', 0, ?, ?)`,
    )
    .run(id, workspaceId, name, now, now)
  return id
}

function seedEndpoint(name: string, critical: boolean): void {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'http', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(
      randomUUID(),
      projectId,
      name,
      'https://api.example.com/x',
      JSON.stringify({
        method: 'GET',
        url: 'https://api.example.com/x',
        ...(critical ? { critical: true } : {}),
      }),
      now,
      now,
    )
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return (await handler({}, ...args)) as T
}

beforeEach(() => {
  workspaceId = (getDb().prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
  projectId = newProject('Critical Export')
  seedEndpoint('Login', true)
  seedEndpoint('List', false)
  createSavedRequest({
    project_id: projectId,
    folder_id: null,
    name: 'Saved login',
    protocol: 'http',
    method: 'POST',
    url: 'https://api.example.com/login',
    metadata: JSON.stringify({ critical: true }),
  })
})

interface V21Item {
  name: string
  'x-apinizer'?: { critical?: boolean }
}

describe('issue #304 — Critical in Postman exports', () => {
  it('v2.1: carried in x-apinizer only on critical rows, and the importer reads it back', async () => {
    const res = await call<{ success: boolean; data?: string }>('export:postman', projectId)
    expect(res.success).toBe(true)
    const col = JSON.parse(res.data ?? '{}') as { item: V21Item[] }
    const byName = new Map(col.item.map((i) => [i.name, i]))
    expect(byName.get('Login')?.['x-apinizer']?.critical).toBe(true)
    expect(byName.get('Saved login')?.['x-apinizer']?.critical).toBe(true)
    // An unmarked request stays a clean Postman item.
    expect(byName.get('List')?.['x-apinizer']).toBeUndefined()

    const target = newProject('Critical Import')
    const imp = await call<{ success: boolean; error?: string }>('import:postman', {
      projectId: target,
      content: res.data,
      format: 'postman',
    })
    expect(imp.error).toBeUndefined()
    const rows = getDb()
      .prepare('SELECT name, request_schema FROM endpoints WHERE project_id = ?')
      .all(target) as Array<{ name: string; request_schema: string }>
    const critical = Object.fromEntries(
      rows.map((r) => [r.name, readRequestSettingsJson(r.request_schema).critical === true]),
    )
    expect(critical).toEqual({ Login: true, List: false, 'Saved login': true })
  })

  it('v3: no carrier — reported in notes, not dropped silently', async () => {
    const res = await call<{ success: boolean; notes?: string[] }>(
      'export:postmanV3Json',
      projectId,
    )
    expect(res.success).toBe(true)
    const notes = (res.notes ?? []).filter((n) => n.includes('Critical'))
    expect(notes).toHaveLength(2)
    expect(notes.join('\n')).toContain('"Login"')
    expect(notes.join('\n')).toContain('"Saved login"')
  })
})
