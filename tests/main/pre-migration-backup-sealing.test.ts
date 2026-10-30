/**
 * Issue #297 + #239 — the pre-migration backup copy holds no plaintext secret.
 *
 * A DB written before secrets were encrypted at rest (1.5.x) still has secret
 * variable values, mock auth secrets and the Mock MCP bearer token in plain
 * text when 1.6.0 first starts. The copy taken before migrating is sealed with
 * the live DB's own sweep and VACUUMed, so the raw backup file contains none
 * of those bytes, while the live DB is only ever read.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(os.tmpdir(), 'testnizer-premigration-seal-'))
const state = vi.hoisted(() => ({ dir: '' }))
/** The stand-in OS keychain. */
const keychain = vi.hoisted(() => ({ available: true, broken: false, key: 'machine-key-1' }))

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => state.dir },
  ipcMain: { handle: (): void => {} },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    encryptString: (s: string) => {
      if (keychain.broken) throw new Error('keychain locked')
      return Buffer.from(`${keychain.key}|${s}`, 'utf-8').reverse()
    },
    decryptString: (b: Buffer) => {
      const text = Buffer.from(b).reverse().toString('utf-8')
      const bar = text.indexOf('|')
      if (text.slice(0, bar) !== keychain.key) throw new Error('keychain changed')
      return text.slice(bar + 1)
    },
  },
}))

import { initDatabase, closeDatabase, getDb } from '../../src/main/db/database'
import { BACKUP_DIR_NAME, backupBeforeMigration } from '../../src/main/db/pre-migration-backup'
import { openSecret } from '../../src/main/lib/secret-at-rest'
import { mapMockAuthSecrets } from '../../src/main/lib/local-secrets'

const A = { version: '1.5.4', build: 'aaaaaaa' }
const B = { version: '1.6.0', build: 'bbbbbbb' }

const CANARIES = {
  envValue: 'CANARY-ENV-VALUE-7f3a91',
  envInitial: 'CANARY-ENV-INITIAL-7f3a91',
  global: 'CANARY-GLOBAL-7f3a91',
  bearer: 'CANARY-MCP-BEARER-7f3a91',
  mockPassword: 'CANARY-MOCK-PASSWORD-7f3a91',
  mockToken: 'CANARY-MOCK-TOKEN-7f3a91',
}
const NOT_SECRET = 'VISIBLE-NOT-SECRET-7f3a91'

let counter = 0
function freshDir(): string {
  counter += 1
  const dir = path.join(root, `case-${counter}`)
  mkdirSync(dir, { recursive: true })
  state.dir = dir
  return dir
}
const dbOf = (dir: string): string => path.join(dir, 'testnizer.db')
const backupFiles = (dir: string): string[] => {
  const b = path.join(dir, BACKUP_DIR_NAME)
  return existsSync(b) ? readdirSync(b) : []
}

/** A DB as 1.5.x left it: the current schema with every secret in plain text. */
function seedPlaintextSecretsDb(dir: string): void {
  keychain.available = true
  initDatabase({ build: A })
  closeDatabase()
  const conn = new Database(dbOf(dir))
  conn.pragma('journal_mode = WAL')
  // Parent rows are left out on purpose: old installs do carry dangling
  // references, and sealing (which only rewrites values) must not trip on them.
  conn.pragma('foreign_keys = OFF')
  conn
    .prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, secret, initial_value)
       VALUES (?, 'env-1', ?, ?, ?, ?)`,
    )
    .run('ev-secret', 'token', CANARIES.envValue, 1, CANARIES.envInitial)
  conn
    .prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, secret, initial_value)
       VALUES (?, 'env-1', ?, ?, ?, ?)`,
    )
    .run('ev-plain', 'host', NOT_SECRET, 0, NOT_SECRET)
  conn
    .prepare(
      `INSERT INTO global_variables (id, workspace_id, key, value, secret) VALUES (?, 'ws-1', ?, ?, 1)`,
    )
    .run('gv-secret', 'apiKey', CANARIES.global)
  conn
    .prepare(
      `INSERT INTO mock_mcp_servers (id, project_id, name, port, auth_mode, bearer_token, created_at, updated_at)
       VALUES ('mcp-1', 'p-1', 'MCP', 4100, 'bearer', ?, 1, 1)`,
    )
    .run(CANARIES.bearer)
  conn
    .prepare(
      `INSERT INTO mock_servers (id, project_id, name, port, auth_config, created_at, updated_at)
       VALUES ('ms-1', 'p-1', 'Mock', 4200, ?, 1, 1)`,
    )
    .run(JSON.stringify({ type: 'basic', username: 'u', password: CANARIES.mockPassword }))
  conn
    .prepare(
      `INSERT INTO mock_endpoints (id, server_id, path, auth_override, created_at, updated_at)
       VALUES ('me-1', 'ms-1', '/x', ?, 1, 1)`,
    )
    .run(JSON.stringify({ type: 'bearer', token: CANARIES.mockToken }))
  conn.close()
}

function tableCounts(file: string): Record<string, number> {
  const conn = new Database(file, { readonly: true })
  try {
    const tables = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
    const out: Record<string, number> = {}
    for (const { name } of tables) {
      out[name] = (conn.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number }).c
    }
    return out
  } finally {
    conn.close()
  }
}

/** Every byte of the file (and of any sidecar next to it). */
function rawBytes(file: string): string {
  return ['', '-wal', '-shm', '-journal']
    .map((ext) => `${file}${ext}`)
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f).toString('latin1'))
    .join('\n')
}

beforeEach(() => {
  closeDatabase()
  keychain.available = true
  keychain.broken = false
})

afterAll(() => {
  closeDatabase()
  rmSync(root, { recursive: true, force: true })
})

describe('pre-migration backup seals secret values (issue #297)', () => {
  it('the copy of a 1.5.x DB holds no plaintext secret anywhere in the file, and every value opens', () => {
    const dir = freshDir()
    seedPlaintextSecretsDb(dir)
    const before = tableCounts(dbOf(dir))
    // Precondition: the live DB really holds the canaries in plain text.
    const liveBefore = rawBytes(dbOf(dir))
    for (const c of Object.values(CANARIES)) expect(liveBefore).toContain(c)

    const result = initDatabase({ build: B })

    if (result.preMigrationBackup.status !== 'created') {
      throw new Error(`no backup: ${JSON.stringify(result.preMigrationBackup)}`)
    }
    const copy = result.preMigrationBackup.path
    expect(backupFiles(dir)).toEqual([path.basename(copy)])
    // Raw bytes of the backup: none of the secrets, but the non-secret value.
    const raw = rawBytes(copy)
    for (const c of Object.values(CANARIES)) expect(raw).not.toContain(c)
    expect(raw).toContain(NOT_SECRET)
    expect(tableCounts(copy)).toEqual(before)

    // Every sealed value opens back to the original.
    const conn = new Database(copy, { readonly: true })
    const ev = conn
      .prepare("SELECT value, initial_value FROM environment_variables WHERE id = 'ev-secret'")
      .get() as { value: string; initial_value: string }
    expect(openSecret(ev.value)).toEqual({ value: CANARIES.envValue, failed: false })
    expect(openSecret(ev.initial_value)).toEqual({ value: CANARIES.envInitial, failed: false })
    const gv = conn.prepare("SELECT value FROM global_variables WHERE id = 'gv-secret'").get() as {
      value: string
    }
    expect(openSecret(gv.value).value).toBe(CANARIES.global)
    const mcp = conn.prepare("SELECT bearer_token FROM mock_mcp_servers WHERE id = 'mcp-1'").get() as {
      bearer_token: string
    }
    expect(openSecret(mcp.bearer_token).value).toBe(CANARIES.bearer)
    const opened: string[] = []
    for (const sql of [
      "SELECT auth_config AS raw FROM mock_servers WHERE id = 'ms-1'",
      "SELECT auth_override AS raw FROM mock_endpoints WHERE id = 'me-1'",
    ]) {
      const { raw: json } = conn.prepare(sql).get() as { raw: string }
      mapMockAuthSecrets(json, (s) => {
        if (s) opened.push(openSecret(s).value)
        return s
      })
    }
    expect(opened.sort()).toEqual([CANARIES.mockPassword, CANARIES.mockToken].sort())
    const plain = conn
      .prepare("SELECT value FROM environment_variables WHERE id = 'ev-plain'")
      .get() as { value: string }
    expect(plain.value).toBe(NOT_SECRET)
    conn.close()

    // The live DB was only read: its secrets are untouched by the backup (the
    // live sweep runs later, after the window opens).
    const live = getDb()
      .prepare("SELECT value FROM environment_variables WHERE id = 'ev-secret'")
      .get() as { value: string }
    expect(live.value).toBe(CANARIES.envValue)
  })

  it('without a keychain the copy keeps the values in plain text, like the live DB', () => {
    const dir = freshDir()
    seedPlaintextSecretsDb(dir)
    keychain.available = false

    const result = initDatabase({ build: B })

    if (result.preMigrationBackup.status !== 'created') throw new Error('no backup')
    expect(result.backupFailed).toBeUndefined()
    const raw = rawBytes(result.preMigrationBackup.path)
    expect(raw).toContain(CANARIES.envValue)
    expect(raw).toContain(CANARIES.bearer)
  })

  it('a sealing failure leaves no backup and does not block startup', () => {
    const dir = freshDir()
    seedPlaintextSecretsDb(dir)
    // The keychain says it is available but cannot encrypt: the sweep would
    // leave plaintext in the copy.
    keychain.broken = true

    const result = initDatabase({ build: B })

    expect(result.preMigrationBackup.status).toBe('failed')
    expect(result.backupFailed).toMatch(/could not encrypt/)
    expect(backupFiles(dir)).toEqual([])
    // Startup went on with the live DB.
    const row = getDb()
      .prepare("SELECT value FROM environment_variables WHERE id = 'ev-secret'")
      .get() as { value: string }
    expect(row.value).toBe(CANARIES.envValue)
  })

  it('an older schema without the mock tables or columns is sealed without error', () => {
    const dir = freshDir()
    const conn = new Database(dbOf(dir))
    conn.exec(`
      CREATE TABLE environment_variables (
        id TEXT PRIMARY KEY, environment_id TEXT NOT NULL, key TEXT NOT NULL,
        value TEXT NOT NULL DEFAULT '', secret INTEGER NOT NULL DEFAULT 0, initial_value TEXT
      );
      CREATE TABLE mock_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    `)
    conn
      .prepare(
        `INSERT INTO environment_variables (id, environment_id, key, value, secret, initial_value)
         VALUES ('ev', 'env', 'k', ?, 1, NULL)`,
      )
      .run(CANARIES.envValue)
    conn.close()

    const outcome = backupBeforeMigration({ userData: dir, dbPath: dbOf(dir), build: B })

    if (outcome.status !== 'created') throw new Error(JSON.stringify(outcome))
    expect(rawBytes(outcome.path)).not.toContain(CANARIES.envValue)
    const copy = new Database(outcome.path, { readonly: true })
    const ev = copy.prepare('SELECT value FROM environment_variables').get() as { value: string }
    copy.close()
    expect(openSecret(ev.value).value).toBe(CANARIES.envValue)
  })
})
