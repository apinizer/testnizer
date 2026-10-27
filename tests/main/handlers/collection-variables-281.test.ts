/**
 * Issue #281 — Postman collection variables = Testnizer project variables
 * ("Globals"), on the real production schema with a stand-in OS keychain.
 *
 *  - A Postman import writes collection variables and globals into the
 *    project variables through the repository: secrets sealed at rest, the
 *    Console / History mask inventory knows them at once, and Run resolves
 *    them while ANOTHER environment is active (they used to land in an
 *    inactive "<collection> (imported)" environment).
 *  - "Move to Globals" (`environment:moveToProjectVariables`): one
 *    transaction, ciphertext copied as stored (an undecryptable value is not
 *    blanked), a key Globals already has keeps its LOCAL value and is
 *    reported unless both hold the same value, the environment is left alone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock, seedWorkspace, seedProject } from './helpers'

const harness = setupHandlerHarness()

const keychain = vi.hoisted(() => ({ available: true, key: 'machine-key-1' }))

vi.mock('electron', () => ({
  ...makeElectronMock(),
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    encryptString: (s: string) => Buffer.from(`${keychain.key}|${s}`, 'utf-8').reverse(),
    decryptString: (b: Buffer) => {
      const text = Buffer.from(b).reverse().toString('utf-8')
      const bar = text.indexOf('|')
      if (text.slice(0, bar) !== keychain.key) throw new Error('keychain changed')
      return text.slice(bar + 1)
    },
  },
}))

let testDb: Database.Database
const realDb = await vi.importActual<typeof import('../../../src/main/db/database')>(
  '../../../src/main/db/database',
)
vi.mock('../../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/db/database')>()),
  getDb: () => testDb,
}))

const { registerEnvironmentHandlers } = await import('../../../src/main/ipc/environment.handler')
const { importPostman } = await import('../../../src/main/ipc/import-export.handler')
const { loadEnvVars } = await import('../../../src/main/lib/env-vars')
const { loadSecretInventory } = await import('../../../src/main/lib/sensitive-scrub')
const { invalidateSecretInventory } = await import('../../../src/main/lib/secret-inventory-cache')
const { storedVariableValue } = await import('../../../src/main/lib/secret-at-rest')

type Envelope<T> = { success: boolean; error?: string; data?: T }
const invoke = <T>(channel: string, ...args: unknown[]): Promise<Envelope<T>> =>
  harness.invoke(channel, ...args) as Promise<Envelope<T>>

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
const TOKEN = 'collection-T0KEN-281-abcdef'

let workspaceId: string
let projectId: string

beforeEach(() => {
  keychain.available = true
  keychain.key = 'machine-key-1'
  harness.reset()
  testDb = realDb.openAndMigrate(':memory:')
  invalidateSecretInventory()
  registerEnvironmentHandlers()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId, 'Shop')
})

function addEnv(name: string, active: boolean): string {
  const id = randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, projectId, name, active ? 1 : 0, now, now)
  return id
}

function addEnvVar(envId: string, key: string, value: string, secret = false): void {
  testDb
    .prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      randomUUID(),
      envId,
      key,
      storedVariableValue(value, secret),
      secret ? 1 : 0,
      storedVariableValue(value, secret),
    )
}

function addGlobal(key: string, value: string, secret = false): void {
  testDb
    .prepare(
      `INSERT INTO global_variables (id, workspace_id, project_id, key, value, enabled, secret, initial_value)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      randomUUID(),
      workspaceId,
      projectId,
      key,
      storedVariableValue(value, secret),
      secret ? 1 : 0,
      storedVariableValue(value, secret),
    )
}

const globalRow = (key: string): Record<string, unknown> | undefined =>
  testDb
    .prepare('SELECT value, initial_value, secret FROM global_variables WHERE project_id = ? AND key = ?')
    .get(projectId, key) as Record<string, unknown> | undefined

describe('Postman import → project variables (issue #281)', () => {
  it('collection variables resolve on Run while another environment is active; secrets sealed and masked', async () => {
    const dev = addEnv('Dev', true)
    addEnvVar(dev, 'region', 'eu')
    const res = await importPostman(
      projectId,
      JSON.stringify({
        info: { name: 'Shop', schema: SCHEMA },
        variable: [
          { key: 'baseUrl', value: 'https://shop.test' },
          { key: 'token', value: TOKEN, type: 'secret' },
        ],
        item: [{ name: 'x', request: { method: 'GET', url: '{{baseUrl}}/x' } }],
      }),
    )
    expect(res.success).toBe(true)
    // No "(imported)" environment; the active one is untouched.
    expect(
      testDb.prepare('SELECT name FROM environments WHERE project_id = ?').all(projectId),
    ).toEqual([{ name: 'Dev' }])
    // Run (the same loader as Mock) resolves them under the active "Dev".
    expect(loadEnvVars({ projectId })).toMatchObject({
      baseUrl: 'https://shop.test',
      token: TOKEN,
      region: 'eu',
    })
    // Sealed at rest, known to the mask inventory immediately.
    const raw = globalRow('token')!
    expect(raw.secret).toBe(1)
    expect(String(raw.value)).toMatch(/^enc:v1:/)
    expect(JSON.stringify(testDb.prepare('SELECT * FROM global_variables').all())).not.toContain(
      TOKEN,
    )
    expect(loadSecretInventory(testDb).values).toContain(TOKEN)
  })
})

describe('environment:moveToProjectVariables (issue #281)', () => {
  it('copies values as stored, keeps the local value on a conflict, and leaves the environment', async () => {
    const env = addEnv('Shop (imported)', false)
    addEnvVar(env, 'baseUrl', 'https://shop.test')
    addEnvVar(env, 'token', TOKEN, true)
    addEnvVar(env, 'same', 'S')
    addEnvVar(env, 'clash', 'from-env')
    addGlobal('same', 'S')
    addGlobal('clash', 'mine')
    const storedToken = (
      testDb
        .prepare("SELECT value FROM environment_variables WHERE environment_id = ? AND key = 'token'")
        .get(env) as { value: string }
    ).value

    const res = await invoke<{ moved: string[]; conflicts: string[] }>(
      'environment:moveToProjectVariables',
      env,
    )
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ moved: ['baseUrl', 'token'], conflicts: ['clash'] })
    // The secret moved as the SAME ciphertext (no decrypt / re-seal round trip).
    expect(globalRow('token')).toMatchObject({ value: storedToken, secret: 1 })
    expect(globalRow('clash')).toMatchObject({ value: 'mine' })
    // The environment and its variables are still there (deleting is a separate step).
    expect(
      testDb.prepare('SELECT COUNT(*) AS n FROM environment_variables WHERE environment_id = ?').get(env),
    ).toEqual({ n: 4 })
    // Moved variables resolve with no environment involved.
    expect(loadEnvVars({ projectId })).toMatchObject({ baseUrl: 'https://shop.test', token: TOKEN })
  })

  it('an undecryptable secret is carried over, not blanked', async () => {
    const env = addEnv('Old', false)
    addEnvVar(env, 'token', TOKEN, true)
    keychain.key = 'another-machine'
    const res = await invoke<{ moved: string[] }>('environment:moveToProjectVariables', env)
    expect(res.data?.moved).toEqual(['token'])
    expect(String(globalRow('token')!.value)).toMatch(/^enc:v1:/)
    keychain.key = 'machine-key-1'
    expect(loadEnvVars({ projectId }).token).toBe(TOKEN)
  })

  it('an unknown environment is an error, nothing written', async () => {
    const res = await invoke('environment:moveToProjectVariables', 'nope')
    expect(res.success).toBe(false)
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM global_variables').get()).toEqual({ n: 0 })
  })
})
