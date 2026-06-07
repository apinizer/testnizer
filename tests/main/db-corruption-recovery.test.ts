/**
 * MST-279 — corrupt DB recovery (file-level).
 *
 * When the on-disk SQLite file is garbage (an invalid SQLite header, e.g. a
 * file truncated mid-write or overwritten by another tool), better-sqlite3
 * throws "file is not a database" on open. Before the fix this happened inside
 * `app.whenReady()` before any window was created, leaving the user with a
 * silent, windowless process.
 *
 * `initDatabase()` now quarantines the corrupt file (+ WAL/SHM sidecars) with a
 * `.corrupt-<timestamp>` suffix and recreates a fresh DB in its place. These
 * tests exercise that recovery against a real on-disk tempdir.
 *
 * We mock `electron` exactly like the other DB tests so `app.getPath('userData')`
 * resolves to a fresh tmp dir per run. better-sqlite3 imports fine here —
 * vitest runs on the node ABI (see CLAUDE.md "Native ABI yönetimi").
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readdirSync,
  writeFileSync,
  statSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// One tmp dir for the whole file; each test wipes + recreates the DB filename.
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-corrupt-recovery-'))

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => tmpDir },
  ipcMain: { handle: (): void => {} },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))

import {
  initDatabase,
  getDb,
  closeDatabase,
  isCorruptDbError,
  quarantineCorruptDb,
} from '../../src/main/db/database'

const dbPath = path.join(tmpDir, 'testnizer.db')

function clearTmpDir(): void {
  for (const entry of readdirSync(tmpDir)) {
    rmSync(path.join(tmpDir, entry), { recursive: true, force: true })
  }
}

beforeEach(() => {
  closeDatabase()
  clearTmpDir()
})

afterAll(() => {
  closeDatabase()
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('isCorruptDbError', () => {
  it('matches SQLITE_NOTADB code', () => {
    expect(isCorruptDbError({ code: 'SQLITE_NOTADB' })).toBe(true)
  })

  it('matches "file is not a database" message', () => {
    expect(isCorruptDbError(new Error('file is not a database'))).toBe(true)
  })

  it('matches a malformed-image message', () => {
    expect(isCorruptDbError(new Error('database disk image is malformed'))).toBe(true)
  })

  it('does not match an unrelated error', () => {
    expect(isCorruptDbError(new Error('disk full'))).toBe(false)
    expect(isCorruptDbError({ code: 'SQLITE_BUSY' })).toBe(false)
  })
})

describe('quarantineCorruptDb', () => {
  it('renames the DB and its WAL/SHM sidecars with a .corrupt- suffix', () => {
    writeFileSync(dbPath, Buffer.from('GARBAGE'))
    writeFileSync(`${dbPath}-wal`, Buffer.from('WAL'))
    writeFileSync(`${dbPath}-shm`, Buffer.from('SHM'))

    const backupPath = quarantineCorruptDb(dbPath)

    expect(backupPath).toBeTruthy()
    expect(existsSync(dbPath)).toBe(false) // moved out of the way
    expect(existsSync(backupPath as string)).toBe(true)
    expect((backupPath as string).includes('.corrupt-')).toBe(true)

    // Sidecars must move too — a stale WAL/SHM can re-corrupt a fresh DB.
    expect(existsSync(`${dbPath}-wal`)).toBe(false)
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
    const sidecarBackups = readdirSync(tmpDir).filter(
      (f) => f.includes('-wal.corrupt-') || f.includes('-shm.corrupt-'),
    )
    expect(sidecarBackups.length).toBe(2)
  })

  it('returns null when there is no DB file to quarantine', () => {
    expect(quarantineCorruptDb(dbPath)).toBeNull()
  })
})

describe('initDatabase corrupt-DB recovery', () => {
  it('opens a healthy DB without recovering', () => {
    const result = initDatabase()
    expect(result.recovered).toBe(false)
    expect(result.backupPath).toBeUndefined()
    // Default seed exists, DB is usable.
    const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM workspaces').get() as { cnt: number }
    expect(row.cnt).toBeGreaterThan(0)
  })

  it('backs up a corrupt DB file and starts fresh', () => {
    // Write garbage bytes that are NOT a valid SQLite header.
    writeFileSync(dbPath, Buffer.from('NOT_A_VALID_SQLITE_FILE_CORRUPTED_DATA_XYZ'))
    writeFileSync(`${dbPath}-wal`, Buffer.from('CORRUPT-WAL'))
    writeFileSync(`${dbPath}-shm`, Buffer.from('CORRUPT-SHM'))

    const result = initDatabase()

    // Recovery flagged + backup path returned.
    expect(result.recovered).toBe(true)
    expect(result.backupPath).toBeDefined()
    expect((result.backupPath as string).includes('.corrupt-')).toBe(true)

    // The corrupt file was preserved (NOT deleted) under the backup name.
    expect(existsSync(result.backupPath as string)).toBe(true)

    // A fresh, valid DB now lives at the original path and is queryable +
    // seeded with the default workspace.
    expect(existsSync(dbPath)).toBe(true)
    const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM workspaces').get() as { cnt: number }
    expect(row.cnt).toBeGreaterThan(0)

    // Stale sidecars were quarantined, not left to re-corrupt the new DB.
    const corruptBackups = readdirSync(tmpDir).filter((f) => f.includes('.corrupt-'))
    expect(corruptBackups.length).toBeGreaterThanOrEqual(1)
  })

  it('treats a zero-byte file as a fresh DB (no recovery needed)', () => {
    // SQLite opens an empty file as a brand-new database — this must NOT trip
    // the corrupt-recovery path.
    writeFileSync(dbPath, Buffer.alloc(0))
    expect(statSync(dbPath).size).toBe(0)

    const result = initDatabase()

    expect(result.recovered).toBe(false)
    const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM workspaces').get() as { cnt: number }
    expect(row.cnt).toBeGreaterThan(0)
    // No backup created.
    expect(readdirSync(tmpDir).filter((f) => f.includes('.corrupt-')).length).toBe(0)
  })
})
