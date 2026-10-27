/**
 * Issue #297 — copy the database before a new build migrates it.
 *
 * The first time a different build starts (version + build id, because
 * pre-release rounds share a version), the existing `testnizer.db` is copied
 * with `VACUUM INTO` to `<userData>/backups/testnizer.db.<version>-<build>.<ts>`
 * BEFORE any migration runs. `VACUUM INTO` reads through the WAL, so rows a
 * crashed previous run left only in `-wal` are in the copy too. The newest
 * {@link BACKUPS_TO_KEEP} copies are kept.
 *
 * Rules:
 * - The live DB is only ever opened read-only here. A failure is reported to
 *   the caller and never blocks startup.
 * - "Which build started last" lives in a small JSON file next to the DB, not
 *   in the DB: it can be read before the DB is opened (the DB may be corrupt or
 *   on an older schema) and is written only after open + migrate succeeded, so
 *   a failed migration leaves it unchanged.
 * - If a copy for this exact build already exists, no new one is taken. When a
 *   migration keeps failing, every restart would otherwise copy the
 *   half-migrated DB again and, after {@link BACKUPS_TO_KEEP} attempts, rotate
 *   out the only clean pre-migration copy.
 * - The copy is written under a `.partial` name and renamed when complete, so
 *   a crash mid-copy never leaves a file that counts as a backup.
 * - Before the rename, secret values in the COPY are sealed with the same
 *   sweep the live DB gets (`sealSecretsAtRestSync`, issue #239) and the copy
 *   is VACUUMed with `secure_delete` on, so a copy of a DB written before
 *   secrets were encrypted holds no plaintext secret. Without a keychain the
 *   copy keeps them as the live DB does (plaintext fallback). If sealing
 *   fails, the copy is deleted and the backup counts as failed.
 * - Retention deletes only inside `backups/`, only regular files whose name
 *   matches our pattern, and only after a new copy was written and renamed:
 *   a failed backup never reduces the number of existing copies.
 * - Free-space guard: before copying, the volume of `backups/` must have at
 *   least 2 × (size of `testnizer.db` + `-wal`) + {@link FREE_SPACE_MARGIN_BYTES}
 *   free (the copy, plus the room the seal step's VACUUM of the copy needs).
 *   Otherwise nothing is written or pruned and the backup counts as failed
 *   with code `low-disk-space`, so the one-time notice says why. If the probe
 *   itself fails, the backup goes ahead as before.
 */
import Database from 'better-sqlite3'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import type { BuildIdentity } from '../lib/build-identity'
import { isEncryptionAvailable } from '../lib/secure-storage'
import { plaintextSecretsRemain, sealSecretsAtRestSync } from './secret-at-rest-migration'

export const BACKUP_DIR_NAME = 'backups'
export const BUILD_MARKER_FILE = 'last-started-build.json'
export const BACKUPS_TO_KEEP = 3
/** Fixed headroom on top of 2 × the DB size, so the backup never fills the disk. */
export const FREE_SPACE_MARGIN_BYTES = 50 * 1024 * 1024

/** `testnizer.db.<label>.<timestamp>` — the label never contains a path separator. */
const BACKUP_NAME = /^testnizer\.db\.([0-9A-Za-z._-]+)\.(\d+)$/

export type PreMigrationBackupOutcome =
  | { status: 'skipped'; reason: 'first-start' | 'same-build' | 'already-backed-up' }
  | { status: 'created'; path: string; pruned: string[]; pruneError?: string }
  | { status: 'failed'; error: string; code?: BackupFailureCode }

/** Why a backup failed, when the notice should say it in the UI language. */
export type BackupFailureCode = 'low-disk-space'

/** `<version>-<build>` reduced to characters that are safe in a file name. */
export function backupLabel(build: BuildIdentity): string {
  return `${build.version}-${build.build}`.replace(/[^0-9A-Za-z._-]/g, '_')
}

export function readBuildMarker(userData: string): BuildIdentity | null {
  try {
    const parsed = JSON.parse(readFileSync(join(userData, BUILD_MARKER_FILE), 'utf8')) as unknown
    if (parsed && typeof parsed === 'object') {
      const { version, build } = parsed as Record<string, unknown>
      if (typeof version === 'string' && typeof build === 'string') return { version, build }
    }
  } catch {
    // Missing or unreadable — treated as "unknown build", which backs up.
  }
  return null
}

/** Atomic (write + rename). Call only after the DB opened and migrated. */
export function writeBuildMarker(userData: string, build: BuildIdentity): void {
  const target = join(userData, BUILD_MARKER_FILE)
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: build.version, build: build.build }))
  renameSync(tmp, target)
}

interface BackupFile {
  name: string
  label: string
  timestamp: number
}

function listBackups(dir: string): BackupFile[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  const out: BackupFile[] = []
  for (const name of readdirSync(dir)) {
    const m = BACKUP_NAME.exec(name)
    if (!m) continue
    if (!lstatSync(join(dir, name)).isFile()) continue
    out.push({ name, label: m[1], timestamp: Number(m[2]) })
  }
  return out
}

/** Deletes all but the newest `keep` backups. Returns the deleted file names. */
export function pruneBackups(dir: string, keep: number = BACKUPS_TO_KEEP): string[] {
  const sorted = listBackups(dir).sort((a, b) => b.timestamp - a.timestamp)
  const removed: string[] = []
  for (const old of sorted.slice(keep)) {
    unlinkSync(join(dir, old.name))
    removed.push(old.name)
  }
  return removed
}

export interface PreMigrationBackupOptions {
  userData: string
  dbPath: string
  build: BuildIdentity
  now?: () => number
  /** Injected for tests; defaults to `isEncryptionAvailable`. */
  encryptionAvailable?: () => boolean
  /** Free bytes on the volume of `dir`. Injected for tests; defaults to `statfsSync`. */
  freeBytes?: (dir: string) => number
}

function statfsFreeBytes(dir: string): number {
  const s = statfsSync(dir)
  return Number(s.bavail) * Number(s.bsize)
}

function fileSize(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/** Bytes the copy needs free: 2 × (DB + WAL) + the fixed margin. */
export function requiredFreeBytes(dbPath: string): number {
  return 2 * (fileSize(dbPath) + fileSize(`${dbPath}-wal`)) + FREE_SPACE_MARGIN_BYTES
}

const MB = 1024 * 1024
const toMb = (bytes: number): number => Math.ceil(bytes / MB)

/**
 * Seal the secret values of the copy at `file` (never the live DB) with the
 * live DB's sweep, then VACUUM it so no freed page keeps the plaintext.
 * Throws when a secret is left unsealed while the keychain is available.
 */
function sealSecretsInCopy(file: string, encryptionAvailable: () => boolean): void {
  // Same rule as the live DB: no keychain → the plaintext fallback.
  if (!encryptionAvailable()) return
  const copy = new Database(file, { fileMustExist: true })
  try {
    // A rollback journal, never a WAL: the copy must be one self-contained
    // file when it is renamed.
    copy.pragma('journal_mode = DELETE')
    copy.pragma('secure_delete = ON')
    // Only values change, never keys; an old DB's dangling reference must not
    // make the UPDATE fail.
    copy.pragma('foreign_keys = OFF')
    const sweep = sealSecretsAtRestSync(copy)
    if (sweep.skipped > 0 || plaintextSecretsRemain(copy)) {
      throw new Error('could not encrypt the secret values in the backup copy')
    }
    if (sweep.sealed > 0 || sweep.opened > 0) copy.exec('VACUUM')
  } finally {
    copy.close()
  }
}

/**
 * Takes the pre-migration copy when this build differs from the last one that
 * started successfully. Never throws.
 */
export function backupBeforeMigration(opts: PreMigrationBackupOptions): PreMigrationBackupOutcome {
  const { userData, dbPath, build } = opts
  const now = opts.now ?? Date.now
  let partial: string | null = null
  try {
    // No DB yet (or an empty file SQLite would treat as new): nothing to keep.
    if (!existsSync(dbPath) || statSync(dbPath).size === 0) {
      return { status: 'skipped', reason: 'first-start' }
    }
    const last = readBuildMarker(userData)
    if (last && last.version === build.version && last.build === build.build) {
      return { status: 'skipped', reason: 'same-build' }
    }
    const dir = join(userData, BACKUP_DIR_NAME)
    const label = backupLabel(build)
    if (listBackups(dir).some((b) => b.label === label)) {
      return { status: 'skipped', reason: 'already-backed-up' }
    }

    mkdirSync(dir, { recursive: true, mode: 0o700 })

    // Free-space guard. A probe that fails (or reports nonsense) never blocks
    // the backup; a probe that says "too little" skips it before any write.
    let available: number | null = null
    try {
      const probed = (opts.freeBytes ?? statfsFreeBytes)(dir)
      if (Number.isFinite(probed) && probed >= 0) available = probed
    } catch {
      available = null
    }
    const required = requiredFreeBytes(dbPath)
    if (available !== null && available < required) {
      return {
        status: 'failed',
        code: 'low-disk-space',
        error:
          'not enough free disk space for the pre-update backup ' +
          `(needs about ${toMb(required)} MB, ${Math.floor(available / MB)} MB free)`,
      }
    }

    const target = join(dir, `testnizer.db.${label}.${now()}`)
    partial = `${target}.partial`
    const source = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      // Bound parameter: the userData path never becomes SQL text.
      source.prepare('VACUUM INTO ?').run(partial)
    } finally {
      // Closed before the caller may quarantine the file (Windows rename).
      source.close()
    }
    try {
      chmodSync(partial, 0o600)
    } catch {
      // Best effort — not supported the same way on every filesystem.
    }
    sealSecretsInCopy(partial, opts.encryptionAvailable ?? isEncryptionAvailable)
    renameSync(partial, target)
    partial = null

    try {
      return { status: 'created', path: target, pruned: pruneBackups(dir) }
    } catch (err) {
      return { status: 'created', path: target, pruned: [], pruneError: messageOf(err) }
    }
  } catch (err) {
    if (partial && existsSync(partial)) {
      try {
        unlinkSync(partial)
      } catch {
        // Left behind; its `.partial` name never counts as a backup.
      }
    }
    return { status: 'failed', error: messageOf(err) }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface BackupFailureNotice {
  title: string
  message: string
  detail: string
  button: string
}

/** Text of the one-time dialog shown when the copy could not be made. */
export function backupFailureNotice(
  locale: string,
  error: string,
  backupsDir: string,
  code?: BackupFailureCode,
): BackupFailureNotice {
  if (locale === 'tr') {
    const reason =
      code === 'low-disk-space' ? 'güncelleme öncesi yedek için yeterli boş disk alanı yok' : error
    return {
      title: 'Testnizer — Yedek alınamadı',
      message: 'Testnizer, veritabanınızı güncellemeden önce yedekleyemedi.',
      detail:
        'Uygulama normal şekilde açıldı. Testnizer, yeni bir sürüm veritabanını güncellemeden ' +
        'önce bir kopyasını alır; güncelleme ters giderse verileriniz bu kopyadan kurtarılabilir. ' +
        'Bu kez kopya alınamadı ve güncelleme kopya olmadan yapıldı.' +
        `\n\nNeden: ${reason}\n\nYedek klasörü:\n${backupsDir}`,
      button: 'Tamam',
    }
  }
  return {
    title: 'Testnizer — Backup not created',
    message: 'Testnizer could not back up your database before updating it.',
    detail:
      'The app started normally. Testnizer copies your database before a new version updates ' +
      'it, so your data can be recovered if the update goes wrong. This time the copy could ' +
      'not be made, and the update went ahead without it.' +
      `\n\nReason: ${error}\n\nBackups folder:\n${backupsDir}`,
    button: 'OK',
  }
}
