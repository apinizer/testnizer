/**
 * One-time mask of History rows written before issue #195.
 *
 * From #195 on every History row and Runner report is masked as it is
 * written (`addHistory`, `recordStep`). Rows already on disk still hold the
 * resolved secrets and literal credentials the canary found, so this pass
 * runs the SAME helper (`sensitive-scrub.ts`, sent mode) over
 * `history.url / request_snapshot / response_snapshot` and
 * `runner_history.results_json` once.
 *
 * - Marker: a `settings` row (`HISTORY_MASK_MIGRATION_KEY`) — written only
 *   after both tables are done, so an interrupted pass simply runs again next
 *   launch (masking is idempotent: an already-masked row comes out identical
 *   and is not rewritten).
 * - Deferred: nothing runs synchronously at the call — the first batch waits
 *   for `startAfter` (the call site starts it after the window exists).
 * - Batched by rowid AND bytes (`batchSize` rows, at most `batchBytes` of
 *   snapshot text — one batch of 200 × 500 KB responses would be 100 MB),
 *   one transaction per batch, yielding to the event loop between batches.
 * - A row that fails to mask (poison row) is skipped and its rowid logged —
 *   never its content — so it cannot abort the pass on every launch.
 * - Old rows stay openable: they have no `configured` template, so reopen
 *   reads the flat fields, and a masked credential comes back EMPTY with the
 *   "enter it again" note.
 */
import type Database from 'better-sqlite3'
import { maskHistoryRow, maskRunResult, scrubberFor, type Scrubber } from '../lib/sensitive-scrub'
import type { EndpointRunResult } from '../../shared/runner-types'

export const HISTORY_MASK_MIGRATION_KEY = 'migration.historyMask.v1'

const DEFAULT_BATCH = 200
/** Cap on snapshot text per batch (characters ≈ bytes for the ASCII-heavy JSON). */
const DEFAULT_BATCH_BYTES = 4 * 1024 * 1024

export interface HistoryMaskMigrationResult {
  /** False when the marker said it had already run. */
  ran: boolean
  historyUpdated: number
  runnerHistoryUpdated: number
  /** Rows that could not be masked and were skipped (rowids logged). */
  skipped: number
}

export interface HistoryMaskMigrationOptions {
  batchSize?: number
  /** Max snapshot characters per batch (always at least one row). */
  batchBytes?: number
  /** Called between batches; defaults to yielding one macrotask. */
  yieldBetweenBatches?: () => Promise<void>
  /** Awaited before anything touches the DB; defaults to yielding one macrotask. */
  startAfter?: () => Promise<void>
  /** Where a skipped row is reported; defaults to `console.warn`. */
  onSkip?: (table: 'history' | 'runner_history', rowid: number, error: unknown) => void
}

interface PassContext {
  scrub: Scrubber
  batch: number
  bytes: number
  pause: () => Promise<void>
  skip: (table: 'history' | 'runner_history', rowid: number, error: unknown) => void
}

/**
 * The rowids of the next batch: up to `batch` rows after `last`, cut once the
 * running size passes `bytes` (the first row is always taken, however big).
 */
function nextBatchIds(sizes: Array<{ rid: number; size: number | null }>, bytes: number): number[] {
  const ids: number[] = []
  let total = 0
  for (const r of sizes) {
    const size = r.size ?? 0
    if (ids.length > 0 && total + size > bytes) break
    ids.push(r.rid)
    total += size
  }
  return ids
}

const defaultSkip = (table: string, rowid: number, error: unknown): void => {
  // Rowid + error class only — never the row's content.
  console.warn(
    `[history-mask-migration] skipped ${table} rowid ${rowid}: ${(error as Error)?.name ?? 'Error'}`,
  )
}

const yieldTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function hasRun(db: Database.Database): boolean {
  try {
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(HISTORY_MASK_MIGRATION_KEY)
    return row !== undefined
  } catch {
    return false
  }
}

function markRun(db: Database.Database): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    HISTORY_MASK_MIGRATION_KEY,
    JSON.stringify({ at: Date.now() }),
  )
}

interface HistoryDbRow {
  rid: number
  url: string
  request_snapshot: string
  response_snapshot: string | null
}

async function maskHistoryTable(db: Database.Database, ctx: PassContext): Promise<number> {
  const sizes = db.prepare(
    `SELECT rowid AS rid,
            COALESCE(length(url), 0) + COALESCE(length(request_snapshot), 0)
              + COALESCE(length(response_snapshot), 0) AS size
       FROM history WHERE rowid > ? ORDER BY rowid LIMIT ?`,
  )
  const select = db.prepare(
    `SELECT rowid AS rid, url, request_snapshot, response_snapshot FROM history
      WHERE rowid > ? AND rowid <= ? ORDER BY rowid`,
  )
  const update = db.prepare(
    'UPDATE history SET url = ?, request_snapshot = ?, response_snapshot = ? WHERE rowid = ?',
  )
  let last = 0
  let updated = 0
  for (;;) {
    const ids = nextBatchIds(
      sizes.all(last, ctx.batch) as Array<{ rid: number; size: number | null }>,
      ctx.bytes,
    )
    if (ids.length === 0) break
    const rows = select.all(last, ids[ids.length - 1]) as HistoryDbRow[]
    db.transaction(() => {
      for (const r of rows) {
        try {
          const m = maskHistoryRow(
            {
              url: r.url,
              request_snapshot: r.request_snapshot,
              response_snapshot: r.response_snapshot ?? undefined,
            },
            ctx.scrub,
          )
          const response = m.response_snapshot ?? null
          if (
            m.url !== r.url ||
            m.request_snapshot !== r.request_snapshot ||
            response !== r.response_snapshot
          ) {
            update.run(m.url, m.request_snapshot, response, r.rid)
            updated++
          }
        } catch (e) {
          ctx.skip('history', r.rid, e)
        }
      }
    })()
    last = ids[ids.length - 1]
    await ctx.pause()
  }
  return updated
}

/** A stored `results_json`, masked; unparseable text is value-scrubbed. */
export function maskResultsJson(json: string, scrub: Scrubber): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return scrub.text(json)
  }
  if (!Array.isArray(parsed)) return scrub.text(json)
  const masked = parsed.map((r) =>
    r && typeof r === 'object' ? maskRunResult(r as EndpointRunResult, scrub) : r,
  )
  return JSON.stringify(masked)
}

async function maskRunnerHistoryTable(db: Database.Database, ctx: PassContext): Promise<number> {
  const sizes = db.prepare(
    `SELECT rowid AS rid, COALESCE(length(results_json), 0) AS size FROM runner_history
      WHERE rowid > ? ORDER BY rowid LIMIT ?`,
  )
  const select = db.prepare(
    `SELECT rowid AS rid, results_json FROM runner_history
      WHERE rowid > ? AND rowid <= ? ORDER BY rowid`,
  )
  const update = db.prepare('UPDATE runner_history SET results_json = ? WHERE rowid = ?')
  let last = 0
  let updated = 0
  for (;;) {
    const ids = nextBatchIds(
      sizes.all(last, ctx.batch) as Array<{ rid: number; size: number | null }>,
      ctx.bytes,
    )
    if (ids.length === 0) break
    const rows = select.all(last, ids[ids.length - 1]) as Array<{
      rid: number
      results_json: string | null
    }>
    db.transaction(() => {
      for (const r of rows) {
        if (typeof r.results_json !== 'string' || r.results_json === '') continue
        try {
          const next = maskResultsJson(r.results_json, ctx.scrub)
          if (next !== r.results_json) {
            update.run(next, r.rid)
            updated++
          }
        } catch (e) {
          ctx.skip('runner_history', r.rid, e)
        }
      }
    })()
    last = ids[ids.length - 1]
    await ctx.pause()
  }
  return updated
}

/**
 * Run the one-time mask. Never throws: a failure leaves the marker unwritten
 * so the next launch tries again.
 */
export async function runHistoryMaskMigration(
  db: Database.Database,
  opts: HistoryMaskMigrationOptions = {},
): Promise<HistoryMaskMigrationResult> {
  const result: HistoryMaskMigrationResult = {
    ran: false,
    historyUpdated: 0,
    runnerHistoryUpdated: 0,
    skipped: 0,
  }
  try {
    // Nothing touches the DB synchronously at the call (startup path).
    await (opts.startAfter ?? yieldTurn)()
    if (hasRun(db)) return result
    const onSkip = opts.onSkip ?? defaultSkip
    const ctx: PassContext = {
      scrub: scrubberFor(db),
      batch: Math.max(1, opts.batchSize ?? DEFAULT_BATCH),
      bytes: Math.max(1, opts.batchBytes ?? DEFAULT_BATCH_BYTES),
      pause: opts.yieldBetweenBatches ?? yieldTurn,
      skip: (table, rowid, error) => {
        result.skipped++
        try {
          onSkip(table, rowid, error)
        } catch {
          /* logging never aborts the pass */
        }
      },
    }
    result.historyUpdated = await maskHistoryTable(db, ctx)
    result.runnerHistoryUpdated = await maskRunnerHistoryTable(db, ctx)
    markRun(db)
    result.ran = true
  } catch {
    /* retried next launch */
  }
  return result
}
