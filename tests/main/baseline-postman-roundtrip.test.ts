/**
 * BASELINE / CHARACTERIZATION — Postman v2.1 import -> DB rows -> export, plus
 * the Postman environment import. Pins today's behaviour (right or wrong) before
 * the import/export rewrite; regenerate the snapshots deliberately when the
 * rewrite changes them.
 *
 * Fixture: tests/fixtures/postman/baseline-v21.json (constructed for this test).
 * Real production schema (`initDatabase` in a temp userData dir); the IPC
 * channels the renderer calls (`import:postman`, `export:postman`,
 * `import:postmanEnvironment`) are captured from `registerImportExportHandlers`.
 * Ids and timestamps are normalised (ids -> ordinal labels / "<id>").
 *
 * Observed gaps pinned on purpose (look for them in the snapshots):
 *  - GraphQL body mode imports as `type: 'json'` (query + variables re-serialised
 *    as one JSON text); the exporter re-detects the {query,variables} shape and
 *    writes `mode: 'graphql'` again, so this one round-trips by inference.
 *  - KNOWN-BUG: OAuth2 always imports as grantType 'client_credentials' (the
 *    fixture's grant_type is ignored); only token/URLs/clientId/secret/scope survive
 *    and the export drops key `type`s and writes an empty `accessToken`.
 *  - KNOWN-BUG: Bearer prefix is always forced to 'Bearer' on import.
 *  - KNOWN-BUG: collection `info.description` is dropped on import, and the export
 *    names the collection after the PROJECT ("Baseline Project"), not the original
 *    collection name; there is no collection-level `auth` in the export.
 *  - KNOWN-BUG: export item ORDER differs from the import: sub-folders are emitted
 *    before a folder's requests and root-level requests come last (the
 *    "second export" snapshot records `sameItems: false`).
 *  - KNOWN-BUG: collection variable types other than `secret` come back as
 *    'string'; the `secret` variable value is blanked ('') on export (#177).
 *  - KNOWN-BUG: endpoints.path for a URL with a query string keeps the query
 *    (`/{{apiVersion}}/users?page=1&trace=x`) — the column is documented as a path.
 *  - Collection-level auth is baked onto every request lacking its own auth
 *    (no collection-auth object survives the round trip); folder auth is both
 *    stored on the folder row AND baked onto its children.
 *  - Collection `variable[]` becomes an environment named "<collection> (imported)".
 *  - Per-request params keep disabled rows; headers keep disabled rows.
 *  - The Postman environment EXPORT lives inline in
 *    src/renderer/components/modals/EnvironmentModal.tsx (renderer-only, no
 *    handler), so only the environment IMPORT shape is pinned here.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-baseline-postman-'))

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
import { registerImportExportHandlers } from '../../src/main/ipc/import-export.handler'
import { readSharedProjectSettings } from '../../src/main/lib/project-settings'

const FIXTURE = readFileSync(
  path.join(__dirname, '..', 'fixtures', 'postman', 'baseline-v21.json'),
  'utf-8',
)

let workspaceId: string

function newProject(id: string, name: string): string {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'http', 0, ?, ?)`,
    )
    .run(id, workspaceId, name, now, now)
  return id
}

async function ipc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const h = ipcHandlers.get(channel)
  if (!h) throw new Error(`no handler ${channel}`)
  return (await h({}, ...args)) as T
}

/** Recursively replace random `id` fields with "<id>". */
function stripIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripIds)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      o[k] = k === 'id' ? '<id>' : stripIds(val)
    }
    return o
  }
  return v
}

function parseJson(s: string | null): unknown {
  if (s === null || s === undefined) return null
  try {
    return stripIds(JSON.parse(s))
  } catch {
    return s
  }
}

interface FolderRow {
  id: string
  parent_id: string | null
  name: string
  sort_order: number
  auth: string | null
  pre_script: string | null
  post_script: string | null
}

/** Snapshot-friendly dump of a project's folders / endpoints / environments / settings. */
function dumpProject(pid: string): Record<string, unknown> {
  const db = getDb()
  const folders = db
    .prepare('SELECT * FROM folders WHERE project_id = ? ORDER BY sort_order, rowid')
    .all(pid) as FolderRow[]
  const label = new Map<string, string>(folders.map((f, i) => [f.id, `F${i + 1}`]))
  const lab = (id: string | null): string | null => (id ? (label.get(id) ?? '<unknown>') : null)

  const endpoints = db
    .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order, rowid')
    .all(pid) as Array<Record<string, unknown>>

  const envs = db
    .prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY created_at, rowid')
    .all(pid) as Array<{ id: string; name: string; is_active: number }>

  return {
    folders: folders.map((f) => ({
      label: label.get(f.id),
      parent: lab(f.parent_id),
      name: f.name,
      sort_order: f.sort_order,
      auth: parseJson(f.auth),
      pre_script: f.pre_script,
      post_script: f.post_script,
    })),
    endpoints: endpoints.map((e) => ({
      name: e.name,
      folder: lab(e.folder_id as string | null),
      protocol: e.protocol,
      method: e.method,
      path: e.path,
      status: e.status,
      description: e.description,
      sort_order: e.sort_order,
      request_schema: parseJson(e.request_schema as string | null),
      response_schemas: e.response_schemas,
    })),
    environments: envs.map((env) => ({
      name: env.name,
      is_active: env.is_active,
      variables: (
        db
          .prepare(
            'SELECT key, value, initial_value, description, enabled, secret FROM environment_variables WHERE environment_id = ? ORDER BY rowid',
          )
          .all(env.id) as Array<Record<string, unknown>>
      ).map((v) => ({ ...v })),
    })),
    project_shared_settings: readSharedProjectSettings(pid) ?? null,
  }
}

beforeAll(() => {
  initDatabase()
  registerImportExportHandlers()
  workspaceId = (getDb().prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
})

describe('baseline Postman v2.1 — import -> DB -> export', () => {
  let exported = ''

  it('import:postman result envelope', async () => {
    newProject('pm-baseline-1', 'Baseline Project')
    const res = await ipc<{ success: boolean; data?: Record<string, unknown>; error?: string }>(
      'import:postman',
      { projectId: 'pm-baseline-1', content: FIXTURE },
    )
    const data = { ...(res.data ?? {}) }
    const ids = data.endpointIds as string[] | undefined
    expect({
      success: res.success,
      error: res.error,
      data: { ...data, endpointIds: ids ? `<${ids.length} ids>` : undefined },
    }).toMatchSnapshot()
  })

  it('DB rows after import (folders, endpoints, environments, project scripts)', () => {
    expect(dumpProject('pm-baseline-1')).toMatchSnapshot()
  })

  it('export:postman output', async () => {
    const res = await ipc<{ success: boolean; data?: string; skipped?: unknown; error?: string }>(
      'export:postman',
      'pm-baseline-1',
    )
    expect(res.success).toBe(true)
    exported = res.data ?? ''
    expect({ skipped: res.skipped, collection: JSON.parse(exported) }).toMatchSnapshot()
  })

  it('re-importing the export into a fresh project (round-trip fidelity)', async () => {
    expect(exported.length).toBeGreaterThan(0)
    newProject('pm-baseline-2', 'Roundtrip Project')
    const res = await ipc<{ success: boolean; error?: string }>('import:postman', {
      projectId: 'pm-baseline-2',
      content: exported,
    })
    expect(res.success).toBe(true)
    expect(dumpProject('pm-baseline-2')).toMatchSnapshot()
  })

  it('second export is stable relative to the first (export(import(export)))', async () => {
    const res = await ipc<{ data?: string }>('export:postman', 'pm-baseline-2')
    // Differences vs. the first export (collection name) are pinned, not asserted equal.
    const first = JSON.parse(exported) as Record<string, unknown>
    const second = JSON.parse(res.data ?? '{}') as Record<string, unknown>
    expect({
      sameItems: JSON.stringify(first.item) === JSON.stringify(second.item),
      sameVariables: JSON.stringify(first.variable) === JSON.stringify(second.variable),
      sameEvents: JSON.stringify(first.event) === JSON.stringify(second.event),
      firstInfoName: (first.info as { name: string }).name,
      secondInfoName: (second.info as { name: string }).name,
    }).toMatchSnapshot()
  })

  it('rejects a non-collection file and a v1 collection', async () => {
    const bad = await ipc<{ data?: unknown }>('import:postman', {
      projectId: 'pm-baseline-1',
      content: JSON.stringify({ hello: 'world' }),
    })
    const v1 = await ipc<{ data?: unknown }>('import:postman', {
      projectId: 'pm-baseline-1',
      content: JSON.stringify({ name: 'old', requests: [] }),
    })
    expect({ bad: bad.data, v1: v1.data }).toMatchSnapshot()
  })
})

describe('baseline Postman environment import (import:postmanEnvironment)', () => {
  const ENV = {
    id: 'env-baseline-001',
    name: 'Baseline Env',
    values: [
      { key: 'baseUrl', value: 'https://api.example.com', type: 'default', enabled: true },
      { key: 'token', value: 'tok-123', type: 'secret', enabled: true },
      { key: 'muted', value: 'off', type: 'default', enabled: false },
      { key: 'noEnabledField', value: 'x' },
    ],
    _postman_variable_scope: 'environment',
    _postman_exported_at: '2026-01-01T00:00:00.000Z',
    _postman_exported_using: 'Postman/10.0.0',
  }

  it('creates a project environment with the rows, secret flag and enabled state', async () => {
    newProject('pm-baseline-env', 'Env Project')
    const res = await ipc<{ success: boolean; data?: Record<string, unknown> }>(
      'import:postmanEnvironment',
      { projectId: 'pm-baseline-env', content: JSON.stringify(ENV) },
    )
    const data = { ...(res.data ?? {}) }
    delete data.environmentId
    expect({ success: res.success, data }).toMatchSnapshot()
    expect(dumpProject('pm-baseline-env').environments).toMatchSnapshot()
  })

  it('re-import is idempotent and rejects a non-environment file', async () => {
    await ipc('import:postmanEnvironment', {
      projectId: 'pm-baseline-env',
      content: JSON.stringify(ENV),
    })
    const again = (dumpProject('pm-baseline-env').environments as unknown[]).length
    const wrong = await ipc<{ success: boolean; error?: string }>('import:postmanEnvironment', {
      projectId: 'pm-baseline-env',
      content: JSON.stringify({ info: { name: 'x' }, item: [] }),
    })
    expect({ environmentsAfterReimport: again, wrong }).toMatchSnapshot()
  })
})
