/**
 * Repairing suite items that were created with a truncated URL.
 *
 * The creation-time bug is fixed, so new suites are correct. That does nothing
 * for the suites a user already has: `test_suite_items.url` still holds
 * `/test/healthcheck` where it should hold `{{AccessURL}}/test/healthcheck`,
 * and every one of those requests fails until it is edited by hand. "New ones
 * are fine" is not a fix for data already on disk.
 *
 * The repair needs no source endpoint: the same snapshot wrote the FULL address
 * into the item's own `request_schema`, and only the `url` column was cut.
 *
 * These tests are mostly about what the migration must NOT touch. It rewrites
 * user data, so the signature has to be narrow enough that a URL somebody
 * shortened on purpose is left alone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import crypto from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/*
 * `initDatabase()` takes no path — it derives one from Electron's userData
 * directory. Pointing that at a fresh temp dir per test is what lets this drive
 * the REAL migration rather than a hand-built mirror of the schema.
 */
const state = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir, getName: () => 'Testnizer', isPackaged: false },
}))

const { initDatabase, getDb } = await import('../../src/main/db/database')

let db: Database.Database

/** Insert a suite item exactly as the buggy snapshot would have. */
function seedItem(opts: { url: string | null; schemaUrl?: unknown }): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema =
    opts.schemaUrl === undefined ? '{}' : JSON.stringify({ method: 'GET', url: opts.schemaUrl })
  db.prepare(
    `INSERT INTO test_suite_items
       (id, suite_id, folder_id, protocol, name, method, url, request_schema, assertions,
        source_endpoint_id, sort_order, created_at, updated_at)
     VALUES (?, 'suite-1', NULL, 'http', 'Healthcheck', 'GET', ?, ?, NULL, NULL, 0, ?, ?)`,
  ).run(id, opts.url, schema, now, now)
  return id
}

const urlOf = (id: string) =>
  (db.prepare('SELECT url FROM test_suite_items WHERE id = ?').get(id) as { url: string | null })
    .url

/**
 * Re-open the database, which is what makes the migration run.
 *
 * `user_version` is cleared first because the repair is a ONE-SHOT: a database
 * that has already been repaired is marked and skipped, so it is not rescanned
 * on every launch forever. Clearing the marker is what makes this a database
 * from an affected build — which is the only kind that has anything to repair.
 */
function reopen(): void {
  db.pragma('user_version = 0')
  db.close()
  initDatabase()
  db = getDb()
}

/** Re-open WITHOUT clearing the marker — a launch after the repair already ran. */
function reopenAlreadyRepaired(): void {
  db.close()
  initDatabase()
  db = getDb()
}

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), 'testnizer-repair-'))
  initDatabase()
  db = getDb()
  // The seed creates a default workspace + project; the suite has to hang off a
  // real one or the foreign key rejects it.
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string }
  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
     VALUES ('suite-1', ?, 'S', '', 0, ?, ?)`,
  ).run(project.id, Date.now(), Date.now())
})

describe('a dropped variable prefix is restored', () => {
  it('puts {{AccessURL}} back on the reported shape', () => {
    const id = seedItem({ url: '/test/healthcheck', schemaUrl: '{{AccessURL}}/test/healthcheck' })

    reopen()

    expect(urlOf(id)).toBe('{{AccessURL}}/test/healthcheck')
  })

  it('is idempotent — a repaired row is not touched again', () => {
    const id = seedItem({ url: '/test/healthcheck', schemaUrl: '{{AccessURL}}/test/healthcheck' })
    reopen()
    const afterFirst = urlOf(id)

    reopen()

    expect(urlOf(id)).toBe(afterFirst)
  })

  it('does not rescan on every later launch', () => {
    const id = seedItem({ url: '/test/healthcheck', schemaUrl: '{{AccessURL}}/test/healthcheck' })
    reopen()
    expect(urlOf(id)).toBe('{{AccessURL}}/test/healthcheck')

    // A row broken AFTER the repair ran is not the migration's job — the
    // creation path is fixed, and the import path repairs its own rows. Pinning
    // this keeps the one-shot marker honest: if it stopped being written, this
    // row would come back repaired and the test would fail.
    const later = seedItem({ url: '/late', schemaUrl: '{{Var}}/late' })
    reopenAlreadyRepaired()

    expect(urlOf(later)).toBe('/late')
  })
})

describe('what the migration must leave alone', () => {
  it('a URL the user shortened on purpose, with no variable in the missing part', () => {
    // The stored value is still a tail of the schema URL, but nothing was lost
    // except a host — that is an edit, not the bug.
    const id = seedItem({ url: '/health', schemaUrl: 'https://api.example.com/health' })

    reopen()

    expect(urlOf(id)).toBe('/health')
  })

  it('a URL that is not a tail of the schema URL at all', () => {
    const id = seedItem({ url: '/completely/different', schemaUrl: '{{AccessURL}}/test/health' })
    reopen()
    expect(urlOf(id)).toBe('/completely/different')
  })

  it('an item whose stored URL is already correct', () => {
    const id = seedItem({ url: '{{AccessURL}}/x', schemaUrl: '{{AccessURL}}/x' })
    reopen()
    expect(urlOf(id)).toBe('{{AccessURL}}/x')
  })

  it('a schema with no url, an unparseable schema, or a non-string url', () => {
    const noUrl = seedItem({ url: '/a' })
    const bad = crypto.randomUUID()
    db.prepare(
      `INSERT INTO test_suite_items
         (id, suite_id, folder_id, protocol, name, method, url, request_schema, assertions,
          source_endpoint_id, sort_order, created_at, updated_at)
       VALUES (?, 'suite-1', NULL, 'http', 'B', 'GET', '/b', 'not json', NULL, NULL, 0, ?, ?)`,
    ).run(bad, Date.now(), Date.now())
    const numeric = seedItem({ url: '/c', schemaUrl: 42 })

    reopen()

    expect(urlOf(noUrl)).toBe('/a')
    expect(urlOf(bad)).toBe('/b')
    expect(urlOf(numeric)).toBe('/c')
  })
})
