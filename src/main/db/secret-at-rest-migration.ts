/**
 * Encrypt values marked secret that are still plaintext on disk (issue #239).
 *
 * Every writer seals on write (`secret-at-rest.ts`), so this pass only finds
 * rows written before #239 — or while the OS keychain could not encrypt
 * (`encryptSecret` falls back to plaintext then).
 *
 * - The sweep (`sealSecretsAtRest`) is cheap and idempotent: SQL selects only
 *   candidate rows (secret + not yet `enc:v1:`), an already-sealed value is
 *   never rewritten. It runs on EVERY launch, so a keychain that becomes
 *   available later (unlocked, libsecret installed) seals what is left.
 * - The one-time part — `PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM`, so the
 *   plaintext is gone from freed pages and the WAL — runs once, after the
 *   first sweep that sealed something with the keychain available. Marker: a
 *   `settings` row (`SECRET_AT_REST_MIGRATION_KEY`) in the DB itself, like
 *   `history-mask-migration.ts` — a quarantined / restored DB resets it
 *   together with the data it describes.
 * - Not marked while encryption is unavailable (nothing could be sealed).
 * - A row that fails is skipped and its rowid logged — never its content.
 * - `secure_delete` is on (database.ts), so pages freed from here on are
 *   zeroed; VACUUM handles what was freed before.
 * - The same sweep seals the pre-migration backup copy (issue #297,
 *   `sealSecretsAtRestSync`), which may come from an older schema: a missing
 *   table or column is skipped, never an error.
 */
import type Database from 'better-sqlite3'
import { sealMockAuthJson, sealSecret, storedVariableValue } from '../lib/secret-at-rest'
import { isEncryptedSecret, isEncryptionAvailable } from '../lib/secure-storage'
import { mapMockAuthSecrets } from '../lib/local-secrets'
import { invalidateSecretInventory } from '../lib/secret-inventory-cache'

export const SECRET_AT_REST_MIGRATION_KEY = 'migration.secretAtRest.v1'

const DEFAULT_BATCH = 200

export interface SecretSweepResult {
  /** Plaintext values that are now ciphertext. */
  sealed: number
  /** Ciphertext on rows no longer marked secret, now plaintext again. */
  opened: number
  /** Rows skipped after an error (rowids logged). */
  skipped: number
}

export interface SecretAtRestMigrationResult extends SecretSweepResult {
  /** False when encryption was unavailable or the pass failed. */
  ran: boolean
  /** The one-time checkpoint + VACUUM ran on this call. */
  vacuumed: boolean
}

export interface SecretAtRestMigrationOptions {
  batchSize?: number
  /** Awaited before anything touches the DB; defaults to one macrotask. */
  startAfter?: () => Promise<void>
  /** Called between batches; defaults to yielding one macrotask. */
  yieldBetweenBatches?: () => Promise<void>
  onSkip?: (table: string, rowid: number, error: unknown) => void
  /** Where the VACUUM duration goes; defaults to `console.info`. */
  log?: (message: string) => void
  /** Injected for tests; defaults to `isEncryptionAvailable`. */
  encryptionAvailable?: () => boolean
}

const yieldTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const defaultSkip = (table: string, rowid: number, error: unknown): void => {
  console.warn(
    `[secret-at-rest] skipped ${table} rowid ${rowid}: ${(error as Error)?.name ?? 'Error'}`,
  )
}

const PREFIX_SQL = (col: string): string => `substr(COALESCE(${col}, ''), 1, 7) = 'enc:v1:'`
const PLAIN_SQL = (col: string): string =>
  `(COALESCE(${col}, '') != '' AND substr(${col}, 1, 7) != 'enc:v1:')`

interface Ctx {
  batch: number
  skip: (table: string, rowid: number, error: unknown) => void
  result: SecretSweepResult
}

/**
 * The sweep is a generator that yields after every batch, so one
 * implementation serves both drivers: the live DB yields to the event loop
 * between batches ({@link sealSecretsAtRest}), the pre-migration backup copy
 * runs straight through ({@link sealSecretsAtRestSync}).
 */
type Sweep = Generator<void, void, void>

/**
 * Columns each step reads. The live DB always has them (the sweep runs after
 * migrations); the pre-migration backup copy (issue #297) can come from an
 * older schema, where a missing table or column means there is nothing of
 * that kind to seal.
 */
function hasColumns(db: Database.Database, table: string, columns: string[]): boolean {
  const present = new Set(
    (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name),
  )
  return columns.every((c) => present.has(c))
}

const VARIABLE_COLUMNS = ['secret', 'value', 'initial_value']

/** Rowid-batched loop over `select` (rowid > ?, LIMIT ?), one transaction per batch. */
function* eachBatch<R extends { rid: number }>(
  db: Database.Database,
  ctx: Ctx,
  table: string,
  select: Database.Statement,
  handle: (row: R) => void,
): Sweep {
  let last = 0
  for (;;) {
    const rows = select.all(last, ctx.batch) as R[]
    if (rows.length === 0) break
    db.transaction(() => {
      for (const r of rows) {
        try {
          handle(r)
        } catch (e) {
          ctx.skip(table, r.rid, e)
        }
      }
    })()
    last = rows[rows.length - 1].rid
    yield
  }
}

function* sweepVariables(db: Database.Database, ctx: Ctx, table: string): Sweep {
  if (!hasColumns(db, table, VARIABLE_COLUMNS)) return
  const select = db.prepare(
    `SELECT rowid AS rid, secret, value, initial_value FROM ${table}
      WHERE rowid > ? AND (
        (secret = 1 AND (${PLAIN_SQL('value')} OR ${PLAIN_SQL('initial_value')}))
        OR (secret != 1 AND (${PREFIX_SQL('value')} OR ${PREFIX_SQL('initial_value')}))
      ) ORDER BY rowid LIMIT ?`,
  )
  const update = db.prepare(`UPDATE ${table} SET value = ?, initial_value = ? WHERE rowid = ?`)
  yield* eachBatch<{ rid: number; secret: number; value: string; initial_value: string | null }>(
    db,
    ctx,
    table,
    select,
    (r) => {
      const secret = r.secret === 1
      const value = storedVariableValue(r.value, secret)
      const initial = storedVariableValue(r.initial_value, secret)
      if (value === r.value && initial === r.initial_value) return
      update.run(value, initial, r.rid)
      if (secret) ctx.result.sealed++
      else ctx.result.opened++
    },
  )
}

function* sweepMockAuth(db: Database.Database, ctx: Ctx, table: string, column: string): Sweep {
  if (!hasColumns(db, table, [column])) return
  const select = db.prepare(
    `SELECT rowid AS rid, ${column} AS raw FROM ${table}
      WHERE rowid > ? AND COALESCE(${column}, '') != '' ORDER BY rowid LIMIT ?`,
  )
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`)
  yield* eachBatch<{ rid: number; raw: string }>(db, ctx, table, select, (r) => {
    const next = sealMockAuthJson(r.raw)
    if (next === r.raw) return
    update.run(next, r.rid)
    ctx.result.sealed++
  })
}

function* sweepMcpBearer(db: Database.Database, ctx: Ctx): Sweep {
  if (!hasColumns(db, 'mock_mcp_servers', ['bearer_token'])) return
  const select = db.prepare(
    `SELECT rowid AS rid, bearer_token AS raw FROM mock_mcp_servers
      WHERE rowid > ? AND ${PLAIN_SQL('bearer_token')} ORDER BY rowid LIMIT ?`,
  )
  const update = db.prepare('UPDATE mock_mcp_servers SET bearer_token = ? WHERE rowid = ?')
  yield* eachBatch<{ rid: number; raw: string }>(db, ctx, 'mock_mcp_servers', select, (r) => {
    const next = sealSecret(r.raw)
    if (next === r.raw) return
    update.run(next, r.rid)
    ctx.result.sealed++
  })
}

/**
 * Seal every plaintext secret in the DB (and re-open ciphertext left on rows
 * no longer marked secret). Safe to call at any time; never throws for a
 * single bad row.
 */
export async function sealSecretsAtRest(
  db: Database.Database,
  opts: Pick<SecretAtRestMigrationOptions, 'batchSize' | 'yieldBetweenBatches' | 'onSkip'> = {},
): Promise<SecretSweepResult> {
  const pause = opts.yieldBetweenBatches ?? yieldTurn
  const ctx = sweepContext(opts)
  const sweep = sweepAll(db, ctx)
  while (!sweep.next().done) await pause()
  if (ctx.result.sealed > 0 || ctx.result.opened > 0) invalidateSecretInventory()
  return ctx.result
}

/**
 * The same sweep without yielding between batches, for a DB no one else is
 * using: the pre-migration backup copy (issue #297), sealed before the copy
 * is kept. Never touches the live DB's secret inventory.
 */
export function sealSecretsAtRestSync(
  db: Database.Database,
  opts: Pick<SecretAtRestMigrationOptions, 'batchSize' | 'onSkip'> = {},
): SecretSweepResult {
  const ctx = sweepContext(opts)
  const sweep = sweepAll(db, ctx)
  while (!sweep.next().done) {
    // Straight through.
  }
  return ctx.result
}

function sweepContext(opts: Pick<SecretAtRestMigrationOptions, 'batchSize' | 'onSkip'>): Ctx {
  const result: SecretSweepResult = { sealed: 0, opened: 0, skipped: 0 }
  const onSkip = opts.onSkip ?? defaultSkip
  return {
    batch: Math.max(1, opts.batchSize ?? DEFAULT_BATCH),
    skip: (table, rowid, error) => {
      result.skipped++
      try {
        onSkip(table, rowid, error)
      } catch {
        /* logging never aborts the pass */
      }
    },
    result,
  }
}

function* sweepAll(db: Database.Database, ctx: Ctx): Sweep {
  yield* sweepVariables(db, ctx, 'environment_variables')
  yield* sweepVariables(db, ctx, 'global_variables')
  yield* sweepMockAuth(db, ctx, 'mock_servers', 'auth_config')
  yield* sweepMockAuth(db, ctx, 'mock_endpoints', 'auth_override')
  yield* sweepMcpBearer(db, ctx)
}

function hasRun(db: Database.Database): boolean {
  try {
    return (
      db.prepare('SELECT value FROM settings WHERE key = ?').get(SECRET_AT_REST_MIGRATION_KEY) !==
      undefined
    )
  } catch {
    return false
  }
}

function markRun(db: Database.Database, info: Record<string, unknown>): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    SECRET_AT_REST_MIGRATION_KEY,
    JSON.stringify({ at: Date.now(), ...info }),
  )
}

/** Any plaintext secret left (encryption was unavailable for it, or a row failed)? */
export function plaintextSecretsRemain(db: Database.Database): boolean {
  const q = (sql: string): boolean => db.prepare(sql).get() !== undefined
  const variables = (table: string): boolean =>
    hasColumns(db, table, VARIABLE_COLUMNS) &&
    q(
      `SELECT 1 FROM ${table} WHERE secret = 1 AND (${PLAIN_SQL('value')} OR ${PLAIN_SQL('initial_value')}) LIMIT 1`,
    )
  // Mock auth secrets are fields inside a JSON blob; SQL cannot see them.
  const mockAuth = (table: string, column: string): boolean => {
    if (!hasColumns(db, table, [column])) return false
    const rows = db
      .prepare(`SELECT ${column} AS raw FROM ${table} WHERE COALESCE(${column}, '') != ''`)
      .all() as Array<{ raw: string }>
    return rows.some((r) => {
      let plain = false
      mapMockAuthSecrets(r.raw, (s) => {
        if (s !== '' && !isEncryptedSecret(s)) plain = true
        return s
      })
      return plain
    })
  }
  return (
    variables('environment_variables') ||
    variables('global_variables') ||
    (hasColumns(db, 'mock_mcp_servers', ['bearer_token']) &&
      q(`SELECT 1 FROM mock_mcp_servers WHERE ${PLAIN_SQL('bearer_token')} LIMIT 1`)) ||
    mockAuth('mock_servers', 'auth_config') ||
    mockAuth('mock_endpoints', 'auth_override')
  )
}

/**
 * Any ciphertext on disk? Sealed values whose plaintext may still sit in
 * freed pages / the WAL (an earlier sweep sealed them but its VACUUM failed).
 */
function sealedSecretsExist(db: Database.Database): boolean {
  const q = (sql: string): boolean => db.prepare(sql).get() !== undefined
  return (
    q(
      `SELECT 1 FROM environment_variables WHERE ${PREFIX_SQL('value')} OR ${PREFIX_SQL('initial_value')} LIMIT 1`,
    ) ||
    q(
      `SELECT 1 FROM global_variables WHERE ${PREFIX_SQL('value')} OR ${PREFIX_SQL('initial_value')} LIMIT 1`,
    ) ||
    q(`SELECT 1 FROM mock_mcp_servers WHERE ${PREFIX_SQL('bearer_token')} LIMIT 1`) ||
    q(`SELECT 1 FROM mock_servers WHERE instr(auth_config, '"enc:v1:') > 0 LIMIT 1`) ||
    q(`SELECT 1 FROM mock_endpoints WHERE instr(auth_override, '"enc:v1:') > 0 LIMIT 1`)
  )
}

/**
 * Startup entry point: the sweep every launch, the one-time
 * checkpoint + VACUUM when the marker is absent. Never throws.
 */
export async function runSecretAtRestMigration(
  db: Database.Database,
  opts: SecretAtRestMigrationOptions = {},
): Promise<SecretAtRestMigrationResult> {
  const result: SecretAtRestMigrationResult = {
    ran: false,
    vacuumed: false,
    sealed: 0,
    opened: 0,
    skipped: 0,
  }
  const log = opts.log ?? ((m: string) => console.info(m))
  try {
    await (opts.startAfter ?? yieldTurn)()
    if (!(opts.encryptionAvailable ?? isEncryptionAvailable)()) {
      // Nothing can be sealed; the next launch with a working keychain will.
      return result
    }
    const sweep = await sealSecretsAtRest(db, opts)
    Object.assign(result, sweep)
    result.ran = true
    if (hasRun(db)) return result
    if (plaintextSecretsRemain(db)) return result // a row failed — retry next launch
    if (sweep.sealed > 0 || sealedSecretsExist(db)) {
      // Outside any transaction. Synchronous: blocks the main process for the
      // whole file, which is why this runs once, deferred after first paint.
      const started = Date.now()
      try {
        db.pragma('wal_checkpoint(TRUNCATE)')
        db.exec('VACUUM')
        db.pragma('wal_checkpoint(TRUNCATE)')
        result.vacuumed = true
        log(
          `[secret-at-rest] sealed ${sweep.sealed} value(s); VACUUM took ${Date.now() - started} ms`,
        )
      } catch (e) {
        log(
          `[secret-at-rest] VACUUM failed after ${Date.now() - started} ms: ${(e as Error)?.name ?? 'Error'}`,
        )
        return result // freed pages may still hold plaintext — try again next launch
      }
    }
    markRun(db, { sealed: sweep.sealed, vacuumed: result.vacuumed })
  } catch {
    /* retried next launch */
  }
  return result
}
