/**
 * Issue #177 follow-up — "values marked secret stay on this machine" for the
 * Postman collection export.
 *
 * `exportAsPostman` / `exportSuiteAsPostman` project the project's active
 * environment as collection `variable[]`. A variable marked secret must leave
 * with its key and the `secret` type but an EMPTY value — the same rule the
 * project file (`stripLocalSecrets`) and the environment-file export
 * (EnvironmentModal) follow. Re-importing such a collection keeps the secret
 * flag so the value the user fills in is masked again.
 *
 * Real schema (`initDatabase`) in a temp userData dir — the same harness as
 * export-suite.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-export-secrets-'))

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => tmpDir },
  ipcMain: { handle: (): void => {} },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))

import { initDatabase, getDb } from '../../src/main/db/database'
import {
  exportAsPostman,
  exportSuiteAsPostman,
  importPostman,
  importPostmanEnvironment,
} from '../../src/main/ipc/import-export.handler'

const SECRET_CURRENT = 'cur-s3cret-value'
const SECRET_INITIAL = 'init-s3cret-value'

let projectId: string
let workspaceId: string
let suiteId: string

beforeAll(() => {
  initDatabase()
})

beforeEach(() => {
  const db = getDb()
  const now = Date.now()
  workspaceId = (db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
  projectId = randomUUID()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
     VALUES (?, ?, 'Secret Export', NULL, 'http', 0, ?, ?)`,
  ).run(projectId, workspaceId, now, now)

  const envId = randomUUID()
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Dev', 1, ?, ?)`,
  ).run(envId, workspaceId, projectId, now, now)
  const insVar = db.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, initial_value, enabled, secret)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  )
  insVar.run(
    randomUUID(),
    envId,
    'baseUrl',
    'https://api.example.com',
    'https://api.example.com',
    0,
  )
  insVar.run(randomUUID(), envId, 'apiToken', SECRET_CURRENT, SECRET_INITIAL, 1)

  db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status,
       request_schema, sort_order, created_at, updated_at)
     VALUES (?, ?, NULL, 'Health', 'http', 'GET', '/health', 'developing', ?, 0, ?, ?)`,
  ).run(randomUUID(), projectId, JSON.stringify({ url: '{{baseUrl}}/health' }), now, now)

  suiteId = randomUUID()
  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
     VALUES (?, ?, 'Suite', 0, ?, ?)`,
  ).run(suiteId, projectId, now, now)
})

interface PmVariable {
  key: string
  value: string
  type?: string
}

function variablesOf(json: string): PmVariable[] {
  return (JSON.parse(json) as { variable?: PmVariable[] }).variable ?? []
}

describe('Postman collection export never carries values marked secret (issue #177)', () => {
  it('exportAsPostman: secret variable keeps its key and secret type, value is empty', () => {
    const json = exportAsPostman(projectId)
    expect(json).not.toContain(SECRET_CURRENT)
    expect(json).not.toContain(SECRET_INITIAL)
    const vars = variablesOf(json)
    expect(vars.find((v) => v.key === 'apiToken')).toEqual({
      key: 'apiToken',
      value: '',
      type: 'secret',
    })
    // A plain variable is untouched.
    expect(vars.find((v) => v.key === 'baseUrl')).toEqual({
      key: 'baseUrl',
      value: 'https://api.example.com',
      type: 'string',
    })
  })

  it('exportSuiteAsPostman: same rule for a suite collection', () => {
    const json = exportSuiteAsPostman(suiteId)
    expect(json).not.toContain(SECRET_CURRENT)
    expect(json).not.toContain(SECRET_INITIAL)
    expect(variablesOf(json).find((v) => v.key === 'apiToken')).toMatchObject({
      value: '',
      type: 'secret',
    })
  })

  it('re-importing the exported collection keeps the variable secret (masked again)', async () => {
    const json = exportAsPostman(projectId)
    const db = getDb()
    const now = Date.now()
    const targetId = randomUUID()
    db.prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Target', NULL, 'http', 0, ?, ?)`,
    ).run(targetId, workspaceId, now, now)
    const res = await importPostman(targetId, json)
    expect(res.success).toBe(true)
    const row = db
      .prepare(
        `SELECT ev.value, ev.initial_value, ev.secret FROM environment_variables ev
         JOIN environments e ON e.id = ev.environment_id
         WHERE e.project_id = ? AND ev.key = 'apiToken'`,
      )
      .get(targetId) as { value: string; initial_value: string | null; secret: number }
    expect(row).toEqual({ value: '', initial_value: '', secret: 1 })
    const plain = db
      .prepare(
        `SELECT ev.secret FROM environment_variables ev
         JOIN environments e ON e.id = ev.environment_id
         WHERE e.project_id = ? AND ev.key = 'baseUrl'`,
      )
      .get(targetId) as { secret: number }
    expect(plain.secret).toBe(0)
  })
})

describe("re-importing a stripped Postman file keeps this machine's secret values (issue #177)", () => {
  const varsOf = (envWhere: string, arg: string): Record<string, unknown> =>
    Object.fromEntries(
      (
        getDb()
          .prepare(
            `SELECT ev.key, ev.value, ev.initial_value, ev.secret FROM environment_variables ev
             JOIN environments e ON e.id = ev.environment_id WHERE ${envWhere}`,
          )
          .all(arg) as {
          key: string
          value: string
          initial_value: string | null
          secret: number
        }[]
      ).map((r) => [r.key, { value: r.value, initial_value: r.initial_value, secret: r.secret }]),
    )

  it('Postman environment: a blank secret keeps the local value of the same key; others update', async () => {
    const res = await importPostmanEnvironment(projectId, {
      name: 'Dev',
      values: [
        { key: 'apiToken', value: '', type: 'secret', enabled: true },
        { key: 'baseUrl', value: 'https://new.example.com', type: 'default', enabled: true },
      ],
    })
    expect(res.success).toBe(true)
    const vars = varsOf("e.project_id = ? AND e.name = 'Dev'", projectId)
    expect(vars.apiToken).toEqual({
      value: SECRET_CURRENT,
      initial_value: SECRET_INITIAL,
      secret: 1,
    })
    expect(vars.baseUrl).toMatchObject({ value: 'https://new.example.com', secret: 0 })
  })

  it('Postman environment: a non-blank incoming secret still wins', async () => {
    await importPostmanEnvironment(projectId, {
      name: 'Dev',
      values: [{ key: 'apiToken', value: 'from-file', type: 'secret', enabled: true }],
    })
    const vars = varsOf("e.project_id = ? AND e.name = 'Dev'", projectId)
    expect(vars.apiToken).toMatchObject({ value: 'from-file', initial_value: 'from-file' })
  })

  it('collection variables: a second import of the exported collection keeps the value filled in here', async () => {
    const json = exportAsPostman(projectId)
    const db = getDb()
    const now = Date.now()
    const targetId = randomUUID()
    db.prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Target', NULL, 'http', 0, ?, ?)`,
    ).run(targetId, workspaceId, now, now)
    await importPostman(targetId, json)
    // The user fills the secret in on this machine…
    db.prepare(
      `UPDATE environment_variables SET value = 'typed-here', initial_value = 'typed-init'
       WHERE key = 'apiToken' AND environment_id IN (SELECT id FROM environments WHERE project_id = ?)`,
    ).run(targetId)
    // …and re-imports the (stripped) collection later.
    await importPostman(targetId, json)
    const vars = varsOf('e.project_id = ?', targetId)
    expect(vars.apiToken).toEqual({ value: 'typed-here', initial_value: 'typed-init', secret: 1 })
  })
})
