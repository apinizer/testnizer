/**
 * Upgrade step for the "files outside the working directory" rule: a project
 * that already holds an enabled absolute file path turns the setting on, so its
 * requests and Scheduler tasks keep working. Others stay off.
 *
 * Real rows on a test DB; electron-store is a fake so the crash cases can be
 * played (the setting lives there, the marker in the DB).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, seedProject, seedWorkspace } from './handlers/helpers'

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../src/main/db/database', () => ({ getDb: () => testDb }))

const storeState = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  failOn: null as string | null,
}))
vi.mock('electron-store', () => ({
  default: class {
    get(key: string): unknown {
      return storeState.values[key]
    }
    set(key: string, value: unknown): void {
      if (storeState.failOn && key.includes(storeState.failOn)) throw new Error('disk full')
      storeState.values[key] = value
    }
  },
}))

const { runFilesOutsideWorkingDirectoryMigration, FILES_OUTSIDE_WD_MIGRATION_KEY } =
  await import('../../src/main/db/files-outside-wd-migration')

const ABS = '/Users/x/fixtures/a.bin'
let workspaceId = ''

const isOn = (projectId: string): boolean =>
  (storeState.values[`project.${projectId}.settings`] as Record<string, unknown> | undefined)
    ?.readFilesOutsideWorkingDirectory === true

const marker = (): unknown =>
  testDb.prepare('SELECT 1 FROM settings WHERE key = ?').get(FILES_OUTSIDE_WD_MIGRATION_KEY)

const newProject = (): string => seedProject(testDb, workspaceId)

function addEndpoint(projectId: string, requestSchema: string): void {
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'E', 'http', 'POST', '/x', 'developing', ?, 0, ?, ?)`,
    )
    .run(crypto.randomUUID(), projectId, requestSchema, now, now)
}

function addSaved(projectId: string, body: string | null, metadata: string | null): void {
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO saved_requests (id, project_id, name, protocol, method, url, body, metadata,
         sort_order, created_at, updated_at)
       VALUES (?, ?, 'S', 'http', 'POST', 'http://x', ?, ?, 0, ?, ?)`,
    )
    .run(crypto.randomUUID(), projectId, body, metadata, now, now)
}

function addSuiteItem(projectId: string, requestSchema: string): void {
  const now = Date.now()
  const suiteId = crypto.randomUUID()
  testDb
    .prepare(
      `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, 'T', 0, ?, ?)`,
    )
    .run(suiteId, projectId, now, now)
  testDb
    .prepare(
      `INSERT INTO test_suite_items (id, suite_id, protocol, name, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, 'http', 'I', ?, 0, ?, ?)`,
    )
    .run(crypto.randomUUID(), suiteId, requestSchema, now, now)
}

const binary = (binaryPath: string) => ({ type: 'binary', binaryPath })
const form = (filePath: string, over: Record<string, unknown> = {}) => ({
  type: 'form-data',
  formData: [{ id: 'f', key: 'f', value: '', enabled: true, type: 'file', filePath, ...over }],
})
const schema = (body: unknown): string => JSON.stringify({ method: 'POST', url: 'http://x', body })

beforeEach(() => {
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  storeState.values = {}
  storeState.failOn = null
})

describe('which projects turn on', () => {
  it.each([
    ['an endpoint binary path', (p: string) => addEndpoint(p, schema(binary(ABS)))],
    ['an endpoint form-data part', (p: string) => addEndpoint(p, schema(form(ABS)))],
    ['a saved request body column', (p: string) => addSaved(p, JSON.stringify(form(ABS)), null)],
    [
      'a saved request metadata block',
      (p: string) => addSaved(p, null, JSON.stringify({ body: binary(ABS) })),
    ],
    ['a test suite item', (p: string) => addSuiteItem(p, schema(form(ABS)))],
    [
      'a body stored as a JSON string inside the schema',
      (p: string) => addEndpoint(p, JSON.stringify({ body: JSON.stringify(binary(ABS)) })),
    ],
    [
      'a path built from a variable, which may resolve to an absolute one',
      (p: string) => addEndpoint(p, schema(binary('{{fixturesDir}}/a.bin'))),
    ],
  ])('%s', async (_label, seed) => {
    const on = newProject()
    const off = newProject()
    seed(on)
    addEndpoint(off, schema({ type: 'json', content: '{}' }))
    expect(await runFilesOutsideWorkingDirectoryMigration(testDb)).toMatchObject({
      ran: true,
      enabled: 1,
    })
    expect(isOn(on)).toBe(true)
    expect(isOn(off)).toBe(false)
    expect(marker()).toBeDefined()
  })

  it.each([
    ['a relative path', schema(form('data/a.bin'))],
    ['a disabled part', schema(form(ABS, { enabled: false }))],
    ['a text row', schema(form(ABS, { type: 'text' }))],
    ['a body type that reads no file', schema({ type: 'json', binaryPath: ABS })],
    ['a path only mentioned in text', schema({ type: 'text', content: `binaryPath ${ABS}` })],
  ])('%s stays off', async (_label, requestSchema) => {
    const p = newProject()
    addEndpoint(p, requestSchema)
    await runFilesOutsideWorkingDirectoryMigration(testDb)
    expect(isOn(p)).toBe(false)
  })

  it('keeps the rest of the local settings, proxy password included', async () => {
    const p = newProject()
    addEndpoint(p, schema(binary(ABS)))
    const proxy = { mode: 'custom', auth: { username: 'u', password: 'enc:sealed' } }
    storeState.values[`project.${p}.settings`] = { workingDirectory: '/w', proxy }
    await runFilesOutsideWorkingDirectoryMigration(testDb)
    expect(storeState.values[`project.${p}.settings`]).toEqual({
      workingDirectory: '/w',
      proxy,
      readFilesOutsideWorkingDirectory: true,
    })
  })
})

describe('once, and safe to repeat', () => {
  it('a second run does nothing: a project the user turned off afterwards stays off', async () => {
    const p = newProject()
    addEndpoint(p, schema(binary(ABS)))
    await runFilesOutsideWorkingDirectoryMigration(testDb)
    storeState.values[`project.${p}.settings`] = { readFilesOutsideWorkingDirectory: false }
    expect(await runFilesOutsideWorkingDirectoryMigration(testDb)).toEqual({
      ran: false,
      enabled: 0,
    })
    expect(isOn(p)).toBe(false)
  })

  it('one damaged row does not stop the others, and the marker is written', async () => {
    const damaged = newProject()
    const good = newProject()
    addEndpoint(damaged, '{"body":{"type":"binary","binaryPath":"/x"') // cut off mid-write
    addSaved(damaged, '[null,{"filePath":', '{"binaryPath":')
    addEndpoint(damaged, '{"body":{"type":"form-data","formData":[null,5,"filePath"]}}')
    addEndpoint(good, schema(binary(ABS)))
    await expect(runFilesOutsideWorkingDirectoryMigration(testDb)).resolves.toMatchObject({
      ran: true,
      enabled: 1,
    })
    expect(isOn(good)).toBe(true)
    expect(isOn(damaged)).toBe(false)
    expect(marker()).toBeDefined()
  })

  it('a store write that fails leaves no marker; the others are done, and the next start finishes', async () => {
    const failing = newProject()
    const ok = newProject()
    addEndpoint(failing, schema(binary(ABS)))
    addEndpoint(ok, schema(binary(ABS)))
    storeState.failOn = failing
    expect(await runFilesOutsideWorkingDirectoryMigration(testDb)).toMatchObject({ ran: false })
    expect(isOn(ok)).toBe(true)
    expect(marker()).toBeUndefined()

    storeState.failOn = null
    expect(await runFilesOutsideWorkingDirectoryMigration(testDb)).toMatchObject({ ran: true })
    expect(isOn(failing)).toBe(true)
    expect(marker()).toBeDefined()
  })

  it('a crash after the store write and before the marker: the next run repeats it harmlessly', async () => {
    const p = newProject()
    addEndpoint(p, schema(binary(ABS)))
    await runFilesOutsideWorkingDirectoryMigration(testDb)
    testDb.prepare('DELETE FROM settings WHERE key = ?').run(FILES_OUTSIDE_WD_MIGRATION_KEY)
    const before = storeState.values[`project.${p}.settings`]
    expect(await runFilesOutsideWorkingDirectoryMigration(testDb)).toMatchObject({ ran: true })
    expect(storeState.values[`project.${p}.settings`]).toEqual(before)
  })

  it('no projects: the marker is written and nothing else', async () => {
    expect(await runFilesOutsideWorkingDirectoryMigration(testDb)).toEqual({
      ran: true,
      enabled: 0,
    })
    expect(storeState.values).toEqual({})
  })
})

describe('startup order', () => {
  it('index.ts awaits it before registering the handlers, which start the Scheduler', () => {
    const index = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf-8')
    const ipc = readFileSync(join(__dirname, '../../src/main/ipc/index.ts'), 'utf-8')
    const migration = index.indexOf('await runFilesOutsideWorkingDirectoryMigration(getDb())')
    expect(migration).toBeGreaterThan(-1)
    expect(migration).toBeLessThan(index.indexOf('registerAllHandlers()'))
    expect(ipc).toContain('startAllSchedulers()')
    expect(index).not.toContain('startAllSchedulers')
  })
})
