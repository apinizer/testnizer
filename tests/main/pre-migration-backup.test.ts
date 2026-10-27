/**
 * Issue #297 — the database is copied before a new build migrates it.
 *
 * Runs `initDatabase()` against real files in a temp userData folder (electron
 * is mocked so `app.getPath('userData')` points there), the same way
 * db-corruption-recovery.test.ts does.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(os.tmpdir(), "testnizer-premigration-it's-"))
const state = { dir: root }

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => state.dir },
  ipcMain: { handle: (): void => {} },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))

import { initDatabase, closeDatabase, getDb, isCorruptDbError } from '../../src/main/db/database'
import {
  BACKUP_DIR_NAME,
  BUILD_MARKER_FILE,
  backupBeforeMigration,
  backupFailureNotice,
  readBuildMarker,
} from '../../src/main/db/pre-migration-backup'

const A = { version: '1.5.4', build: 'aaaaaaa' }
const B = { version: '1.6.0', build: 'bbbbbbb' }
const B_RC2 = { version: '1.6.0', build: 'ccccccc' }

let counter = 0
function freshDir(): string {
  counter += 1
  const dir = path.join(root, `case-${counter}`)
  mkdirSync(dir, { recursive: true })
  state.dir = dir
  return dir
}

const dbOf = (dir: string): string => path.join(dir, 'testnizer.db')
const backupsOf = (dir: string): string => path.join(dir, BACKUP_DIR_NAME)
const backupFiles = (dir: string): string[] =>
  existsSync(backupsOf(dir))
    ? readdirSync(backupsOf(dir)).filter((f) => /^testnizer\.db\..+\.\d+$/.test(f))
    : []

/** Row count of every user table — the "holds every row" comparison. */
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

function integrity(file: string): string {
  const conn = new Database(file, { readonly: true })
  try {
    return conn.pragma('integrity_check', { simple: true }) as string
  } finally {
    conn.close()
  }
}

function addWorkspaces(n: number, prefix: string): void {
  const insert = getDb().prepare(
    'INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
  )
  for (let i = 0; i < n; i++) insert.run(`${prefix}-${i}`, `${prefix} ${i}`, 1, 1)
}

const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')

beforeEach(() => {
  closeDatabase()
})

afterAll(() => {
  closeDatabase()
  rmSync(root, { recursive: true, force: true })
})

describe('pre-migration backup (issue #297)', () => {
  it('first start ever: no DB file, so no backup; the build is recorded', () => {
    const dir = freshDir()
    const result = initDatabase({ build: B })
    expect(result.preMigrationBackup).toEqual({ status: 'skipped', reason: 'first-start' })
    expect(existsSync(backupsOf(dir))).toBe(false)
    expect(readBuildMarker(dir)).toEqual(B)
  })

  it('an existing DB with no marker (upgrade from a build without this feature) is backed up', () => {
    const dir = freshDir()
    initDatabase({ build: A })
    addWorkspaces(5, 'old')
    closeDatabase()
    rmSync(path.join(dir, BUILD_MARKER_FILE))
    const before = tableCounts(dbOf(dir))

    const result = initDatabase({ build: B })

    expect(result.preMigrationBackup.status).toBe('created')
    expect(result.backupFailed).toBeUndefined()
    const files = backupFiles(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^testnizer\.db\.1\.6\.0-bbbbbbb\.\d+$/)
    expect(tableCounts(path.join(backupsOf(dir), files[0]))).toEqual(before)
  })

  it('a version change creates a copy that opens and holds every row', () => {
    const dir = freshDir()
    initDatabase({ build: A })
    addWorkspaces(25, 'ws')
    closeDatabase()
    const before = tableCounts(dbOf(dir))
    expect(before.workspaces).toBeGreaterThanOrEqual(25)

    const result = initDatabase({ build: B })

    if (result.preMigrationBackup.status !== 'created') throw new Error('no backup')
    const copy = result.preMigrationBackup.path
    expect(path.dirname(copy)).toBe(backupsOf(dir))
    expect(integrity(copy)).toBe('ok')
    expect(tableCounts(copy)).toEqual(before)
    expect(readBuildMarker(dir)).toEqual(B)
  })

  it('the same version and build creates no copy', () => {
    const dir = freshDir()
    initDatabase({ build: B })
    closeDatabase()
    const result = initDatabase({ build: B })
    expect(result.preMigrationBackup).toEqual({ status: 'skipped', reason: 'same-build' })
    expect(backupFiles(dir)).toHaveLength(0)
  })

  it('a release candidate with the same version but another build id is backed up', () => {
    const dir = freshDir()
    initDatabase({ build: B })
    closeDatabase()
    const result = initDatabase({ build: B_RC2 })
    expect(result.preMigrationBackup.status).toBe('created')
    expect(backupFiles(dir)).toHaveLength(1)
  })

  it.each([
    ['with the -shm sidecar', true],
    ['without the -shm sidecar', false],
  ])('the copy holds rows that were only in the WAL (crashed previous run, %s)', (_l, withShm) => {
    // Schema written by build A, then rows that never left the WAL.
    const live = freshDir()
    initDatabase({ build: A })
    closeDatabase()
    const writer = new Database(dbOf(live))
    writer.pragma('journal_mode = WAL')
    writer.pragma('wal_autocheckpoint = 0')
    writer.pragma('wal_checkpoint(TRUNCATE)')
    const insert = writer.prepare(
      'INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
    for (let i = 0; i < 40; i++) insert.run(`wal-${i}`, `wal ${i}`, 1, 1)

    // Snapshot the files while the writer is still open: that is what a crash
    // leaves on disk (closing would checkpoint the WAL into the main file).
    const crash = freshDir()
    copyFileSync(dbOf(live), dbOf(crash))
    copyFileSync(`${dbOf(live)}-wal`, `${dbOf(crash)}-wal`)
    if (withShm) copyFileSync(`${dbOf(live)}-shm`, `${dbOf(crash)}-shm`)
    copyFileSync(path.join(live, BUILD_MARKER_FILE), path.join(crash, BUILD_MARKER_FILE))
    writer.close()

    // Precondition: the main file alone does not have those rows.
    const mainOnly = path.join(root, `main-only-${counter}.db`)
    copyFileSync(dbOf(crash), mainOnly)
    const bare = new Database(mainOnly, { readonly: true })
    const bareCount = (
      bare.prepare("SELECT COUNT(*) AS c FROM workspaces WHERE id LIKE 'wal-%'").get() as {
        c: number
      }
    ).c
    bare.close()
    expect(bareCount).toBe(0)

    state.dir = crash
    const result = initDatabase({ build: B })

    if (result.preMigrationBackup.status !== 'created') throw new Error('no backup')
    const copy = result.preMigrationBackup.path
    expect(integrity(copy)).toBe('ok')
    const conn = new Database(copy, { readonly: true })
    const walRows = (
      conn.prepare("SELECT COUNT(*) AS c FROM workspaces WHERE id LIKE 'wal-%'").get() as {
        c: number
      }
    ).c
    conn.close()
    expect(walRows).toBe(40)
  })

  it('keeps only the 3 newest copies and never touches foreign files', () => {
    const dir = freshDir()
    initDatabase({ build: A })
    closeDatabase()
    const backups = backupsOf(dir)
    mkdirSync(backups)
    const old = [1000, 2000, 3000, 4000].map((t) => `testnizer.db.1.0.${t}-x.${t}`)
    for (const name of old) writeFileSync(path.join(backups, name), 'old')
    const foreign = [
      'notes.txt',
      'testnizer.db.no-timestamp',
      'testnizer.db.1.0.0-x.5000.partial',
      'other.db.1.0.0-x.6000',
    ]
    for (const name of foreign) writeFileSync(path.join(backups, name), 'keep me')
    // A directory that matches the name pattern is not a backup either.
    mkdirSync(path.join(backups, 'testnizer.db.1.0.0-dir.7000'))

    const result = initDatabase({ build: B })

    if (result.preMigrationBackup.status !== 'created') throw new Error('no backup')
    expect(result.preMigrationBackup.pruned.sort()).toEqual([old[0], old[1]].sort())
    const left = readdirSync(backups)
    expect(left).toContain(path.basename(result.preMigrationBackup.path))
    expect(left).toContain(old[2])
    expect(left).toContain(old[3])
    expect(left).not.toContain(old[0])
    expect(left).not.toContain(old[1])
    for (const name of foreign) expect(left).toContain(name)
    expect(left).toContain('testnizer.db.1.0.0-dir.7000')
  })

  it('a failed backup does not block startup, leaves the live DB untouched and is reported once', () => {
    const dir = freshDir()
    initDatabase({ build: A })
    addWorkspaces(3, 'keep')
    closeDatabase()
    // `backups` is a file, so the folder cannot be created (works on every OS
    // and as root, unlike chmod).
    writeFileSync(backupsOf(dir), 'not a folder')
    const live = dbOf(dir)
    const hashes = (): string[] =>
      [live, `${live}-wal`].filter((f) => existsSync(f)).map((f) => sha(f))

    // The copy step alone never changes the live files.
    const before = hashes()
    const direct = backupBeforeMigration({ userData: dir, dbPath: live, build: B })
    expect(direct.status).toBe('failed')
    expect(hashes()).toEqual(before)

    const result = initDatabase({ build: B })
    expect(result.preMigrationBackup.status).toBe('failed')
    expect(result.backupFailed).toBeTruthy()
    expect(result.recovered).toBe(false)
    // Startup went on: the DB is open, migrated and still has the rows.
    const row = getDb().prepare("SELECT COUNT(*) AS c FROM workspaces WHERE id LIKE 'keep-%'").get()
    expect(row).toEqual({ c: 3 })
    // Shown once: the build is recorded, so the next start does not retry.
    expect(readBuildMarker(dir)).toEqual(B)
    closeDatabase()
    const again = initDatabase({ build: B })
    expect(again.backupFailed).toBeUndefined()
    expect(again.preMigrationBackup).toEqual({ status: 'skipped', reason: 'same-build' })
  })

  it('a migration that throws leaves the marker unchanged and keeps the first copy', () => {
    const dir = freshDir()
    initDatabase({ build: A })
    closeDatabase()
    // Make a migration step fail with a non-corruption error: `workspaces` is
    // now an empty view, which neither a trigger nor the seed insert accepts.
    const conn = new Database(dbOf(dir))
    conn.exec('DROP TABLE workspaces; CREATE VIEW workspaces AS SELECT 1 AS id WHERE 0')
    conn.close()

    let thrown: unknown
    try {
      initDatabase({ build: B })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    expect(isCorruptDbError(thrown)).toBe(false)
    expect(readBuildMarker(dir)).toEqual(A)
    const first = backupFiles(dir)
    expect(first).toHaveLength(1)

    // Each retry is still "a new build" but must not copy the half-migrated
    // DB again (and so never rotates the clean copy out).
    for (let i = 0; i < 4; i++) {
      expect(() => initDatabase({ build: B })).toThrow()
    }
    expect(backupFiles(dir)).toEqual(first)
    expect(readBuildMarker(dir)).toEqual(A)
  })

  it('a corrupt DB is quarantined as before, with no backup and no backup notice', () => {
    const dir = freshDir()
    writeFileSync(path.join(dir, BUILD_MARKER_FILE), JSON.stringify(A))
    writeFileSync(dbOf(dir), Buffer.from('NOT_A_VALID_SQLITE_FILE_CORRUPTED_DATA_XYZ'))

    const result = initDatabase({ build: B })

    expect(result.recovered).toBe(true)
    expect(result.backupPath).toContain('.corrupt-')
    expect(existsSync(result.backupPath as string)).toBe(true)
    expect(result.preMigrationBackup.status).toBe('failed')
    expect(result.backupFailed).toBeUndefined()
    // Nothing (not even a partial copy) was left in backups/.
    const leftovers = existsSync(backupsOf(dir)) ? readdirSync(backupsOf(dir)) : []
    expect(leftovers).toEqual([])
    expect(readBuildMarker(dir)).toEqual(B)
  })

  it('the backup failure notice is in the UI language', () => {
    const en = backupFailureNotice('en', 'EACCES', '/data/backups')
    expect(en.message).toBe('Testnizer could not back up your database before updating it.')
    expect(en.detail).toContain('EACCES')
    expect(en.detail).toContain('/data/backups')
    const tr = backupFailureNotice('tr', 'EACCES', '/data/backups')
    expect(tr.title).toBe('Testnizer — Yedek alınamadı')
    expect(tr.message).toBe('Testnizer, veritabanınızı güncellemeden önce yedekleyemedi.')
    expect(tr.detail).toContain('Yedek klasörü')
    expect(tr.button).toBe('Tamam')
  })
})
