import { randomUUID } from 'crypto'
import { getDb } from './database'
import { sanitizeTurns } from '../../shared/ai-chat-turns'
import {
  isTabOwnerId,
  type AiConversation,
  type AiConversationSummary,
  type AiTurn,
} from '../../shared/ai-chat-types'
import {
  AI_CONVERSATION_MAX_BYTES,
  AI_CONVERSATION_TRIM_TO_BYTES,
  aiScrubberFor,
  capConversation,
  scrubTurnsForStorage,
} from '../lib/ai-chat-scrub'

/**
 * AI Chat conversations (issue #199) — local database only. Never part of a
 * project export, a git checkout or a Duplicate (`exportProjectData` selects
 * tables by name; this one is not listed). Every write goes through
 * `storedTurns`: `sanitizeTurns` (caps tool results / arguments — main
 * enforces the cap), then the main scrubber (credential names + secret
 * values: the resolved prompt can hold a `{{secretVar}}` value, tool
 * arguments and results can hold anything), and the whole conversation is
 * kept under `AI_CONVERSATION_MAX_BYTES` (oldest tool results cut first).
 */
interface Row {
  id: string
  project_id: string | null
  owner_id: string
  name: string
  messages_json: string
  created_at: number
  updated_at: number
}

const MAX_NAME = 200

function cleanName(name: unknown, fallback = 'New conversation'): string {
  const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : ''
  return (n || fallback).slice(0, MAX_NAME)
}

function parseTurns(json: string): AiTurn[] {
  try {
    return sanitizeTurns(JSON.parse(json))
  } catch {
    return []
  }
}

function decode(row: Row): AiConversation {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    name: row.name,
    turns: parseTurns(row.messages_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Turn count in SQL — no JS parse of a conversation just to count it. */
const TURN_COUNT_SQL = `CASE WHEN json_valid(messages_json)
  THEN json_array_length(messages_json) ELSE 0 END`

/** Conversations of one request, most recently used first. */
export function listByOwner(ownerId: string): AiConversationSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, ${TURN_COUNT_SQL} AS turn_count, created_at, updated_at
         FROM ai_conversations
        WHERE owner_id = ? ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(ownerId) as Array<
    Pick<Row, 'id' | 'name' | 'created_at' | 'updated_at'> & { turn_count: number }
  >
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    turnCount: r.turn_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

/** Turns as they are written: shape-checked, capped, scrubbed. */
function storedTurns(raw: unknown): AiTurn[] {
  return scrubTurnsForStorage(sanitizeTurns(raw), aiScrubberFor())
}

/** The project of a saved owner row (endpoint / saved request / suite item), if any. */
function ownerProjectId(ownerId: string): string | null | undefined {
  if (isTabOwnerId(ownerId)) return undefined
  const row = getDb()
    .prepare(
      `SELECT project_id FROM endpoints WHERE id = ?
       UNION ALL SELECT project_id FROM saved_requests WHERE id = ?
       UNION ALL SELECT s.project_id FROM test_suite_items i
                   JOIN test_suites s ON s.id = i.suite_id WHERE i.id = ?
       LIMIT 1`,
    )
    .get(ownerId, ownerId, ownerId) as { project_id: string | null } | undefined
  return row ? row.project_id : undefined
}

/**
 * The conversation's project (issue #199): the OWNER's project — not the
 * project active in the window, which can differ (a tab of another project
 * left open). Only an unsaved tab (`tab:`) uses the passed id. An id that
 * does not exist would fail the FK — none is stored instead.
 */
function projectIdFor(ownerId: string, passed: string | null | undefined): string | null {
  const fromOwner = ownerProjectId(ownerId)
  const candidate = fromOwner !== undefined ? fromOwner : (passed ?? null)
  if (!candidate) return null
  const exists = getDb().prepare('SELECT 1 FROM projects WHERE id = ?').get(candidate)
  return exists ? candidate : null
}

export function get(id: string): AiConversation | null {
  const row = getDb().prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id) as
    | Row
    | undefined
  return row ? decode(row) : null
}

export function create(input: {
  projectId?: string | null
  ownerId: string
  name?: string
  turns?: unknown
}): AiConversation {
  if (!input.ownerId) throw new Error('ownerId is required')
  const now = Date.now()
  const id = randomUUID()
  const all = storedTurns(input.turns ?? [])
  const fits = Buffer.byteLength(JSON.stringify(all), 'utf-8') <= AI_CONVERSATION_MAX_BYTES
  const turns = fits ? all : capConversation(all, AI_CONVERSATION_TRIM_TO_BYTES).turns
  const projectId = projectIdFor(input.ownerId, input.projectId)
  getDb()
    .prepare(
      `INSERT INTO ai_conversations (id, project_id, owner_id, name, messages_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, projectId, input.ownerId, cleanName(input.name), JSON.stringify(turns), now, now)
  return {
    id,
    projectId,
    ownerId: input.ownerId,
    name: cleanName(input.name),
    turns,
    createdAt: now,
    updatedAt: now,
  }
}

export function rename(id: string, name: string): boolean {
  const res = getDb()
    .prepare('UPDATE ai_conversations SET name = ?, updated_at = ? WHERE id = ?')
    .run(cleanName(name), Date.now(), id)
  return res.changes > 0
}

export function remove(id: string): boolean {
  return getDb().prepare('DELETE FROM ai_conversations WHERE id = ?').run(id).changes > 0
}

/**
 * Append turns (capped + scrubbed on the way in). Returns the new summary, or
 * null when the conversation is gone. Under the size cap the stored JSON
 * array is extended in place in SQL — the conversation is not read back,
 * parsed and rewritten for every answer; only a conversation that would grow
 * past the cap is parsed once to trim it.
 */
export function append(
  id: string,
  turns: unknown,
): { id: string; updatedAt: number; turnCount: number } | null {
  const db = getDb()
  const added = storedTurns(turns)
  const tx = db.transaction((): { id: string; updatedAt: number; turnCount: number } | null => {
    const meta = db
      .prepare(
        `SELECT length(CAST(messages_json AS BLOB)) AS bytes, json_valid(messages_json) AS ok,
                ${TURN_COUNT_SQL} AS n
           FROM ai_conversations WHERE id = ?`,
      )
      .get(id) as { bytes: number; ok: number; n: number } | undefined
    if (!meta) return null
    const now = Date.now()
    const addedJson = JSON.stringify(added)
    const fits = meta.bytes + Buffer.byteLength(addedJson, 'utf-8') <= AI_CONVERSATION_MAX_BYTES
    if (meta.ok === 1 && fits) {
      if (added.length > 0) {
        db.prepare(
          `UPDATE ai_conversations SET messages_json =
             CASE WHEN json_array_length(messages_json) = 0 THEN @added
                  ELSE substr(rtrim(messages_json), 1, length(rtrim(messages_json)) - 1)
                       || ',' || substr(@added, 2) END,
             updated_at = @now WHERE id = @id`,
        ).run({ added: addedJson, now, id })
      } else {
        db.prepare('UPDATE ai_conversations SET updated_at = ? WHERE id = ?').run(now, id)
      }
      return { id, updatedAt: now, turnCount: meta.n + added.length }
    }
    // Over the cap (or an unreadable row): parse once, trim well below the
    // cap (so the next answers splice in place again), rewrite.
    const row = db.prepare('SELECT messages_json FROM ai_conversations WHERE id = ?').get(id) as {
      messages_json: string
    }
    const all = [...parseTurns(row.messages_json), ...added]
    const next = fits ? all : capConversation(all, AI_CONVERSATION_TRIM_TO_BYTES).turns
    db.prepare('UPDATE ai_conversations SET messages_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(next),
      now,
      id,
    )
    return { id, updatedAt: now, turnCount: next.length }
  })
  return tx()
}

/** An unsaved tab's conversations follow its first Save / Save As to the new row. */
export function rehome(fromOwnerId: string, toOwnerId: string): number {
  if (!fromOwnerId || !toOwnerId || fromOwnerId === toOwnerId) return 0
  const db = getDb()
  // The new row's project — the tab may have been saved into another project.
  const project = ownerProjectId(toOwnerId)
  if (project !== undefined) {
    return db
      .prepare('UPDATE ai_conversations SET owner_id = ?, project_id = ? WHERE owner_id = ?')
      .run(toOwnerId, projectIdFor(toOwnerId, null), fromOwnerId).changes
  }
  return db
    .prepare('UPDATE ai_conversations SET owner_id = ? WHERE owner_id = ?')
    .run(toOwnerId, fromOwnerId).changes
}

export function removeByOwner(ownerId: string): number {
  return getDb().prepare('DELETE FROM ai_conversations WHERE owner_id = ?').run(ownerId).changes
}

/**
 * Startup cleanup (issue #199): an unsaved tab's conversations are dropped
 * when the tab closes — but not when the app crashed or was killed. Every
 * `tab:` owner whose tab was not restored is deleted.
 */
export function pruneTabOwners(liveTabIds: readonly string[]): number {
  const db = getDb()
  const live = new Set(liveTabIds.map((id) => `tab:${id}`))
  const owners = db
    .prepare(`SELECT DISTINCT owner_id FROM ai_conversations WHERE owner_id LIKE 'tab:%'`)
    .all() as Array<{ owner_id: string }>
  const stale = owners.map((o) => o.owner_id).filter((o) => isTabOwnerId(o) && !live.has(o))
  return removeByOwners(stale)
}

// ─── Explicit deletes of the owning request (issue #199) ─────────────────────
// Conversations are LOCAL data: they must survive git operations, where a
// branch switch's replace-mode reimport deletes and later re-inserts request
// rows. So there are no delete triggers — only the IPC paths of an explicit
// user delete (request, folder, suite, suite folder) remove a request's
// conversations, and the project FK cascades the rest.

/** Delete the conversations of these owners. */
export function removeByOwners(ownerIds: readonly string[]): number {
  if (ownerIds.length === 0) return 0
  const db = getDb()
  const stmt = db.prepare('DELETE FROM ai_conversations WHERE owner_id = ?')
  let n = 0
  db.transaction(() => {
    for (const id of ownerIds) n += stmt.run(id).changes
  })()
  return n
}

/** Endpoint + saved-request ids under an APIs folder and all its subfolders. */
export function apiFolderOwnerIds(folderId: string): string[] {
  const rows = getDb()
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT ? UNION SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
       )
       SELECT id FROM endpoints WHERE folder_id IN (SELECT id FROM sub)
       UNION SELECT id FROM saved_requests WHERE folder_id IN (SELECT id FROM sub)`,
    )
    .all(folderId) as Array<{ id: string }>
  return rows.map((r) => r.id)
}

/** Suite item ids under a Test Suite folder and all its subfolders. */
export function suiteFolderOwnerIds(folderId: string): string[] {
  const rows = getDb()
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT ? UNION SELECT f.id FROM test_suite_folders f JOIN sub ON f.parent_id = sub.id
       )
       SELECT id FROM test_suite_items WHERE folder_id IN (SELECT id FROM sub)`,
    )
    .all(folderId) as Array<{ id: string }>
  return rows.map((r) => r.id)
}

/** Every item id of a Test Suite. */
export function suiteOwnerIds(suiteId: string): string[] {
  const rows = getDb()
    .prepare('SELECT id FROM test_suite_items WHERE suite_id = ?')
    .all(suiteId) as Array<{ id: string }>
  return rows.map((r) => r.id)
}
