/**
 * Issue #195 — one-time mask of History / Runner rows written before masking
 * existed. Fail-before: no migration existed, so old rows kept the resolved
 * secret and the literal key forever.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from './handlers/helpers'
import {
  HISTORY_MASK_MIGRATION_KEY,
  runHistoryMaskMigration,
} from '../../src/main/db/history-mask-migration'
import { createScrubber, maskHistoryRow } from '../../src/main/lib/sensitive-scrub'
import { httpHistoryRestore } from '../../src/renderer/lib/history-restore'
import { HISTORY_MASK } from '../../src/shared/credential-headers'

const SECRET = 'old-row-S3CRET-value-1'
const POISON = '__poison_row__'

// A row the masker cannot handle — `maskHistoryRow` throws for it; every
// other row goes through the real helper.
vi.mock('../../src/main/lib/sensitive-scrub', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/main/lib/sensitive-scrub')>()
  return {
    ...real,
    maskHistoryRow: (...args: Parameters<typeof real.maskHistoryRow>) => {
      if (args[0].request_snapshot.includes('__poison_row__')) throw new Error('poison')
      return real.maskHistoryRow(...args)
    },
  }
})
const LITERAL = 'literal-old-key-998877'

let db: ReturnType<typeof createTestDb>

function addHistoryRaw(id: string, url: string, req: unknown, res?: unknown): void {
  db.prepare(
    `INSERT INTO history (id, protocol, method, url, request_snapshot, response_snapshot, executed_at)
     VALUES (?, 'http', 'GET', ?, ?, ?, ?)`,
  ).run(id, url, JSON.stringify(req), res === undefined ? null : JSON.stringify(res), Date.now())
}

const OLD_REQUEST = {
  method: 'GET',
  url: `https://api.test/x?api_key=${SECRET}`,
  params: [],
  headers: [
    { key: 'Authorization', value: `Bearer ${SECRET}`, enabled: true },
    { key: 'X-API-Key', value: LITERAL, enabled: true },
    { key: 'Accept', value: 'application/json', enabled: true },
  ],
  body: { type: 'json', content: `{"v":"${SECRET}"}` },
  auth: { type: 'bearer', bearer: { token: SECRET } },
}

beforeEach(() => {
  db = createTestDb()
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES ('e1', 'w1', 'p1', 'Dev', 1, 0, 0)`,
  ).run()
  db.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret)
     VALUES ('v1', 'e1', 'token', ?, 1, 1)`,
  ).run(SECRET)
  addHistoryRaw('old', `https://api.test/x?api_key=${SECRET}`, OLD_REQUEST, {
    status: 200,
    body: `{"echo":"${LITERAL}"}`,
  })
  db.prepare(
    `INSERT INTO runner_history (id, project_id, results_json, started_at) VALUES ('r1', 'p1', ?, 0)`,
  ).run(
    JSON.stringify([
      {
        endpointId: 'e',
        endpointName: 'n',
        method: 'GET',
        url: `https://api.test/x?api_key=${SECRET}`,
        status: 200,
        statusText: 'OK',
        duration: 1,
        passed: 0,
        failed: 0,
        skipped: 0,
        assertions: [],
        requestHeaders: { Authorization: `Bearer ${SECRET}`, 'X-API-Key': LITERAL },
        responseBody: `{"echo":"${SECRET}"}`,
      },
    ]),
  )
})

const noYield = (): Promise<void> => Promise.resolve()

describe('one-time History mask migration (issue #195)', () => {
  it('masks old history + runner_history rows: no secret, no literal credential left', async () => {
    const res = await runHistoryMaskMigration(db, { yieldBetweenBatches: noYield })
    expect(res).toMatchObject({ ran: true, historyUpdated: 1, runnerHistoryUpdated: 1 })
    const all = JSON.stringify([
      db.prepare('SELECT url, request_snapshot, response_snapshot FROM history').all(),
      db.prepare('SELECT results_json FROM runner_history').all(),
    ])
    expect(all).not.toContain(SECRET)
    expect(all).not.toContain(LITERAL)
    const snap = JSON.parse(
      (
        db.prepare("SELECT request_snapshot FROM history WHERE id='old'").get() as {
          request_snapshot: string
        }
      ).request_snapshot,
    )
    // Untouched fields stay as they were.
    expect(snap.headers[2]).toEqual({ key: 'Accept', value: 'application/json', enabled: true })
  })

  it('runs once: the marker stops a second pass', async () => {
    await runHistoryMaskMigration(db, { yieldBetweenBatches: noYield })
    expect(
      db.prepare('SELECT key FROM settings WHERE key = ?').get(HISTORY_MASK_MIGRATION_KEY),
    ).toBeTruthy()
    addHistoryRaw('later', `https://api.test/y?api_key=${SECRET}`, OLD_REQUEST)
    const again = await runHistoryMaskMigration(db, { yieldBetweenBatches: noYield })
    expect(again).toEqual({ ran: false, historyUpdated: 0, runnerHistoryUpdated: 0, skipped: 0 })
    // (Rows written after #195 are masked by addHistory, never by this pass.)
    const later = db.prepare("SELECT url FROM history WHERE id='later'").get() as { url: string }
    expect(later.url).toContain(SECRET)
  })

  it('leaves an already-masked row byte-for-byte unchanged', async () => {
    const masked = maskHistoryRow(
      { url: 'https://api.test/z', request_snapshot: JSON.stringify(OLD_REQUEST) },
      createScrubber([SECRET]),
    )
    db.prepare(
      `INSERT INTO history (id, protocol, url, request_snapshot, response_snapshot, executed_at)
       VALUES ('new', 'http', ?, ?, NULL, 0)`,
    ).run(masked.url, masked.request_snapshot)
    const before = db
      .prepare("SELECT url, request_snapshot, response_snapshot FROM history WHERE id='new'")
      .get()
    const res = await runHistoryMaskMigration(db, { yieldBetweenBatches: noYield })
    expect(res.historyUpdated).toBe(1) // only the old row
    expect(
      db
        .prepare("SELECT url, request_snapshot, response_snapshot FROM history WHERE id='new'")
        .get(),
    ).toEqual(before)
  })

  it('works in batches and yields between them', async () => {
    for (let i = 0; i < 5; i++) {
      addHistoryRaw(`b${i}`, `https://api.test/b?token=${SECRET}`, OLD_REQUEST)
    }
    const pause = vi.fn(() => Promise.resolve())
    const res = await runHistoryMaskMigration(db, { batchSize: 2, yieldBetweenBatches: pause })
    expect(res.historyUpdated).toBe(6)
    // 6 history rows / 2 = 3 batches + 1 runner batch.
    expect(pause.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(JSON.stringify(db.prepare('SELECT * FROM history').all())).not.toContain(SECRET)
  })

  it('an old row still opens after the migration — credentials come back EMPTY, named', async () => {
    await runHistoryMaskMigration(db, { yieldBetweenBatches: noYield })
    const row = db.prepare("SELECT * FROM history WHERE id='old'").get() as {
      url: string
      method: string
      protocol: string
      request_snapshot: string
    }
    const r = httpHistoryRestore({
      url: row.url,
      method: row.method,
      protocol: 'http',
      request_snapshot: JSON.parse(row.request_snapshot),
    })
    expect(r.headers.find((h) => h.key === 'Accept')?.value).toBe('application/json')
    expect(r.headers.find((h) => h.key === 'X-API-Key')?.value).toBe('')
    expect(r.auth?.bearer?.token).toBe('')
    expect(JSON.stringify({ u: r.url, h: r.headers, a: r.auth, b: r.body })).not.toContain(
      HISTORY_MASK,
    )
    expect(r.hidden).toEqual(expect.arrayContaining(['headers.X-API-Key', 'auth.bearer.token']))
  })
})

describe('migration robustness (issue #195 review)', () => {
  it('a poison row is skipped and logged by rowid; the rest is masked and the marker written', async () => {
    addHistoryRaw('b1', `https://api.test/b?token=${SECRET}`, OLD_REQUEST)
    const poisonRid = (
      db.prepare("SELECT rowid AS rid FROM history WHERE id='old'").get() as {
        rid: number
      }
    ).rid
    // `maskHistoryRow` throws on this row (see the partial mock at the top).
    db.prepare("UPDATE history SET request_snapshot = ? WHERE id='old'").run(
      JSON.stringify({ ...OLD_REQUEST, note: POISON }),
    )
    const skipped: Array<[string, number]> = []
    const res = await runHistoryMaskMigration(db, {
      yieldBetweenBatches: noYield,
      onSkip: (table, rowid) => skipped.push([table, rowid]),
    })
    expect(res.ran).toBe(true)
    expect(res.skipped).toBe(1)
    expect(skipped).toEqual([['history', poisonRid]])
    const b1 = db.prepare("SELECT url FROM history WHERE id='b1'").get() as { url: string }
    expect(b1.url).not.toContain(SECRET)
    expect(
      db.prepare('SELECT key FROM settings WHERE key = ?').get(HISTORY_MASK_MIGRATION_KEY),
    ).toBeTruthy()
  })

  it('does not touch the DB synchronously at the call — the first batch waits for startAfter', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => {
      release = r
    })
    const p = runHistoryMaskMigration(db, { startAfter: () => gate, yieldBetweenBatches: noYield })
    await Promise.resolve()
    const row = db.prepare("SELECT url FROM history WHERE id='old'").get() as { url: string }
    expect(row.url).toContain(SECRET)
    release()
    const res = await p
    expect(res.historyUpdated).toBe(1)
  })

  it('caps a batch by bytes as well as rows (always at least one row)', async () => {
    const big = { ...OLD_REQUEST, note: 'x'.repeat(5000) }
    for (let i = 0; i < 4; i++) addHistoryRaw(`big${i}`, `https://api.test/b?token=${SECRET}`, big)
    const pause = vi.fn(() => Promise.resolve())
    const res = await runHistoryMaskMigration(db, {
      batchSize: 100,
      batchBytes: 6000,
      yieldBetweenBatches: pause,
    })
    expect(res.historyUpdated).toBe(5)
    // 5 history rows, ~5 KB each under a 6 KB cap → one row per batch (5) + 1 runner batch.
    expect(pause.mock.calls.length).toBeGreaterThanOrEqual(6)
    expect(JSON.stringify(db.prepare('SELECT * FROM history').all())).not.toContain(SECRET)
  })
})
