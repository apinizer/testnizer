/**
 * Issue #199 — AI Chat conversations: CRUD over IPC, cascade with the owning
 * request / project, rehoming an unsaved tab's conversations on first Save,
 * the stored tool-result cap, and the NEVER-EXPORTED rule: a canary string in
 * a conversation must not reach the project file, the git checkout export or
 * a Duplicate — and a git re-import must not wipe conversations.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedWorkspace,
  seedProject,
} from './helpers'
import { AI_TOOL_RESULT_MAX_CHARS } from '../../../src/shared/ai-chat-types'

const harness = setupHandlerHarness()
let testDb: Database.Database

vi.mock('electron', () => makeElectronMock())
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { registerAiConversationHandlers } =
  await import('../../../src/main/ipc/ai-conversation.handler')
const { exportProjectData, importProjectAsNew, importProjectDataFromJson } =
  await import('../../../src/main/ipc/save.handler')
const { stripLocalSecrets } = await import('../../../src/main/lib/local-secrets')
const { registerEndpointHandlers } = await import('../../../src/main/ipc/endpoint.handler')
const { registerProjectHandlers } = await import('../../../src/main/ipc/project.handler')
const { registerTestSuiteHandlers } = await import('../../../src/main/ipc/test-suite.handler')

const CANARY = 'CANARY-ai-conversation-7f3e'

interface Envelope<T> {
  success: boolean
  data: T
  error?: string
}
const call = async <T>(channel: string, ...args: unknown[]): Promise<Envelope<T>> =>
  (await harness.invoke(channel, ...args)) as Envelope<T>

let wsId: string
let projectId: string

function seedEndpoint(id = crypto.randomUUID()): string {
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints (id, project_id, name, protocol, method, path, request_schema, created_at, updated_at)
       VALUES (?, ?, 'AI', 'ai', 'POST', 'https://api.openai.com/v1/chat/completions', '{}', ?, ?)`,
    )
    .run(id, projectId, now, now)
  return id
}

function seedSavedRequest(): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO saved_requests (id, project_id, name, protocol, method, url, created_at, updated_at)
       VALUES (?, ?, 'AI', 'ai', 'POST', 'u', ?, ?)`,
    )
    .run(id, projectId, now, now)
  return id
}

const turns = (text: string) => [
  { id: 'u1', role: 'user', content: `ask ${text}`, timestamp: 1 },
  {
    id: 'a1',
    role: 'assistant',
    content: `answer ${text}`,
    timestamp: 2,
    parts: [
      {
        type: 'tool_call',
        id: 'c1',
        serverId: 's',
        server: 'S',
        tool: 't',
        argsJson: `{"q":"${text}"}`,
        status: 'done',
      },
      { type: 'tool_result', callId: 'c1', content: `result ${text}`, isError: false },
      { type: 'text', text: `answer ${text}` },
    ],
  },
]

const count = (): number =>
  (testDb.prepare('SELECT COUNT(*) AS n FROM ai_conversations').get() as { n: number }).n

beforeEach(() => {
  testDb = createTestDb()
  wsId = seedWorkspace(testDb)
  projectId = seedProject(testDb, wsId)
  harness.reset()
  registerAiConversationHandlers()
  registerEndpointHandlers()
  registerProjectHandlers()
  registerTestSuiteHandlers()
})

describe('CRUD', () => {
  it('create → append → list → load → rename → delete', async () => {
    const owner = seedEndpoint()
    const created = await call<{ id: string; name: string }>('aichat:conv:create', {
      projectId,
      ownerId: owner,
      name: '  Weather   chat ',
    })
    expect(created.success).toBe(true)
    expect(created.data.name).toBe('Weather chat')
    const id = created.data.id

    const appended = await call<{ turnCount: number }>('aichat:conv:append', id, turns('x'))
    expect(appended.data.turnCount).toBe(2)
    await call('aichat:conv:append', id, [
      { id: 'u2', role: 'user', content: 'more', timestamp: 3 },
    ])

    const list = await call<Array<{ id: string; turnCount: number }>>('aichat:conv:list', owner)
    expect(list.data).toEqual([expect.objectContaining({ id, turnCount: 3 })])

    const loaded = await call<{ turns: Array<{ role: string; parts?: unknown[] }> }>(
      'aichat:conv:load',
      id,
    )
    expect(loaded.data.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user'])
    expect(loaded.data.turns[1].parts).toHaveLength(3)

    await call('aichat:conv:rename', id, 'Renamed')
    expect((await call<Array<{ name: string }>>('aichat:conv:list', owner)).data[0].name).toBe(
      'Renamed',
    )

    await call('aichat:conv:delete', id)
    expect((await call<unknown[]>('aichat:conv:list', owner)).data).toEqual([])
    expect((await call('aichat:conv:load', id)).success).toBe(false)
  })

  it('caps stored tool results and leaves nothing "waiting"', async () => {
    const owner = seedEndpoint()
    const { data } = await call<{ id: string }>('aichat:conv:create', { projectId, ownerId: owner })
    const huge = 'x'.repeat(AI_TOOL_RESULT_MAX_CHARS * 3)
    await call('aichat:conv:append', data.id, [
      {
        id: 'a',
        role: 'assistant',
        content: '',
        timestamp: 1,
        parts: [
          {
            type: 'tool_call',
            id: 'c',
            serverId: 's',
            server: 'S',
            tool: 't',
            argsJson: huge,
            status: 'pending-approval',
          },
          { type: 'tool_result', callId: 'c', content: huge, isError: false },
        ],
      },
    ])
    const row = testDb
      .prepare('SELECT messages_json FROM ai_conversations WHERE id = ?')
      .get(data.id) as {
      messages_json: string
    }
    expect(row.messages_json.length).toBeLessThan(AI_TOOL_RESULT_MAX_CHARS * 2 + 2_000)
    const stored = JSON.parse(row.messages_json) as Array<{ parts: Array<Record<string, unknown>> }>
    expect(stored[0].parts[0].status).toBe('error')
    expect(stored[0].parts[1].truncated).toBe(true)
  })
})

describe('deletes (issue #199: explicit user deletes only)', () => {
  it('a raw row delete (what a git reimport does) keeps the conversations', async () => {
    const ep = seedEndpoint()
    const sr = seedSavedRequest()
    await call('aichat:conv:create', { projectId, ownerId: ep })
    await call('aichat:conv:create', { projectId, ownerId: sr })
    testDb.prepare('DELETE FROM endpoints WHERE id = ?').run(ep)
    testDb.prepare('DELETE FROM saved_requests WHERE id = ?').run(sr)
    expect(count()).toBe(2)
  })

  it('endpoint:delete / savedRequest:delete / folder:delete remove the request conversations', async () => {
    const ep = seedEndpoint()
    const sr = seedSavedRequest()
    await call('aichat:conv:create', { projectId, ownerId: ep })
    await call('aichat:conv:create', { projectId, ownerId: sr })
    await call('aichat:conv:create', { projectId, ownerId: 'tab:t1' })
    expect((await call('endpoint:delete', ep)).success).toBe(true)
    expect(count()).toBe(2)
    expect((await call('savedRequest:delete', sr)).success).toBe(true)
    expect(count()).toBe(1)

    // A folder delete (nested subfolder included) takes its requests' conversations.
    const now = Date.now()
    testDb
      .prepare(`INSERT INTO folders (id, project_id, name) VALUES ('f1', ?, 'F')`)
      .run(projectId)
    testDb
      .prepare(`INSERT INTO folders (id, project_id, parent_id, name) VALUES ('f2', ?, 'f1', 'G')`)
      .run(projectId)
    const nested = seedEndpoint()
    testDb.prepare('UPDATE endpoints SET folder_id = ? WHERE id = ?').run('f2', nested)
    await call('aichat:conv:create', { projectId, ownerId: nested })
    expect(count()).toBe(2)
    expect((await call('folder:delete', 'f1')).success).toBe(true)
    expect(count()).toBe(1)
  })

  it('suite item / suite folder / suite deletes remove their items conversations', async () => {
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES ('s1', ?, 'S', 0, ?, ?)`,
      )
      .run(projectId, now, now)
    testDb
      .prepare(
        `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, created_at) VALUES ('sf1', 's1', NULL, 'SF', 0, ?)`,
      )
      .run(now)
    const item = (id: string, folder: string | null): void => {
      testDb
        .prepare(
          `INSERT INTO test_suite_items (id, suite_id, folder_id, name, protocol, method, url, request_schema, sort_order, created_at, updated_at)
           VALUES (?, 's1', ?, ?, 'ai', 'POST', 'u', '{}', 0, ?, ?)`,
        )
        .run(id, folder, id, now, now)
    }
    item('i1', null)
    item('i2', 'sf1')
    item('i3', null)
    for (const id of ['i1', 'i2', 'i3'])
      await call('aichat:conv:create', { projectId, ownerId: id })
    expect((await call('testSuiteItem:delete', 'i1')).success).toBe(true)
    expect(count()).toBe(2)
    expect((await call('testSuiteFolder:delete', 'sf1')).success).toBe(true)
    expect(count()).toBe(1)
    expect((await call('testSuite:delete', 's1')).success).toBe(true)
    expect(count()).toBe(0)
  })

  it('deleting the project cascades its conversations', async () => {
    await call('aichat:conv:create', { projectId, ownerId: 'tab:t1' })
    testDb.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    expect(count()).toBe(0)
  })
})

describe('unsaved tab owner', () => {
  it('first Save rehomes the tab conversations; a saved owner never moves', async () => {
    await call('aichat:conv:create', { projectId, ownerId: 'tab:abc', turns: turns('t') })
    const ep = seedEndpoint()
    const moved = await call<number>('aichat:conv:rehome', 'tab:abc', ep)
    expect(moved.data).toBe(1)
    expect((await call<unknown[]>('aichat:conv:list', ep)).data).toHaveLength(1)
    expect((await call<unknown[]>('aichat:conv:list', 'tab:abc')).data).toHaveLength(0)

    // Save As from a saved request: its conversations stay (no copy, no move).
    const other = seedEndpoint()
    expect((await call<number>('aichat:conv:rehome', ep, other)).data).toBe(0)
    expect((await call<unknown[]>('aichat:conv:list', ep)).data).toHaveLength(1)
  })

  it('closing an unsaved tab drops its conversations; a saved owner cannot be dropped this way', async () => {
    const ep = seedEndpoint()
    await call('aichat:conv:create', { projectId, ownerId: 'tab:zzz' })
    await call('aichat:conv:create', { projectId, ownerId: ep })
    expect((await call<number>('aichat:conv:dropTab', 'tab:zzz')).data).toBe(1)
    expect((await call<number>('aichat:conv:dropTab', ep)).data).toBe(0)
    expect(count()).toBe(1)
  })
})

describe('never exported (canary)', () => {
  it('the project file and the git checkout export carry no conversation', async () => {
    const ep = seedEndpoint()
    await call('aichat:conv:create', { projectId, ownerId: ep, name: CANARY, turns: turns(CANARY) })
    const file = JSON.stringify(exportProjectData(projectId))
    expect(file).not.toContain(CANARY)
    expect(file).not.toContain('ai_conversations')
    // What `syncWorkingTreeFromDb` writes into the git checkout.
    expect(JSON.stringify(stripLocalSecrets(exportProjectData(projectId)))).not.toContain(CANARY)
  })

  it('Duplicate does not copy conversations', async () => {
    const ep = seedEndpoint()
    await call('aichat:conv:create', { projectId, ownerId: ep, name: CANARY, turns: turns(CANARY) })
    const { projectId: copyId } = importProjectAsNew(exportProjectData(projectId), wsId, {
      name: 'copy',
    })
    const copied = testDb
      .prepare('SELECT COUNT(*) AS n FROM ai_conversations WHERE project_id = ?')
      .get(copyId) as { n: number }
    expect(copied.n).toBe(0)
    expect(count()).toBe(1)
  })

  it('a git re-import (replace mode) keeps the conversations of requests still in the file', async () => {
    const ep = seedEndpoint()
    await call('aichat:conv:create', { projectId, ownerId: ep, name: CANARY, turns: turns(CANARY) })
    const file = JSON.stringify(exportProjectData(projectId))
    await importProjectDataFromJson(file, projectId, { mode: 'replace' })
    expect((await call<unknown[]>('aichat:conv:list', ep)).data).toHaveLength(1)
  })
})

// ─── Review fixes (issue #199) ───────────────────────────────────────────────

describe('stored conversations are scrubbed (credential names + secret values)', () => {
  it('the resolved prompt, answer, tool args, results and errors lose secrets on create AND append', async () => {
    const secret = 'SECRET-var-value-4242'
    testDb
      .prepare(
        `INSERT INTO global_variables (id, workspace_id, project_id, key, value, secret)
         VALUES ('g1', ?, ?, 'apiToken', ?, 1)`,
      )
      .run(wsId, projectId, secret)
    const owner = seedEndpoint()
    const dirty = [
      { id: 'u1', role: 'user', content: `call with ${secret}`, timestamp: 1 },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        error: `upstream said ${secret}`,
        parts: [
          {
            type: 'tool_call',
            id: 'c1',
            serverId: 's',
            server: 'S',
            tool: 't',
            argsJson: '{"q":"weather","api_key":"literal-KEY-123456"}',
            status: 'done',
          },
          {
            type: 'tool_result',
            callId: 'c1',
            content: `{"token":"tok-RESULT-987654","echo":"${secret}"}`,
            isError: false,
          },
          { type: 'text', text: `see https://x/y?access_token=AT-TEXT-55555 and ${secret}` },
        ],
      },
    ]
    const created = await call<{ id: string }>('aichat:conv:create', {
      projectId,
      ownerId: owner,
      turns: dirty,
    })
    await call('aichat:conv:append', created.data.id, dirty)
    const raw = (
      testDb
        .prepare('SELECT messages_json FROM ai_conversations WHERE id = ?')
        .get(created.data.id) as { messages_json: string }
    ).messages_json
    for (const leak of [secret, 'literal-KEY-123456', 'tok-RESULT-987654', 'AT-TEXT-55555']) {
      expect(raw).not.toContain(leak)
    }
    expect(raw).toContain('weather')
    expect(JSON.parse(raw)).toHaveLength(4)
  })
})

describe('size cap + cheap counting', () => {
  it('a conversation stays under 2 MB: oldest tool results are cut first, with a visible note', async () => {
    const {
      AI_CONVERSATION_MAX_BYTES,
      AI_CONVERSATION_TRIM_TO_BYTES,
      AI_CONVERSATION_TRIMMED_NOTE,
    } = await import('../../../src/main/lib/ai-chat-scrub')
    const owner = seedEndpoint()
    const { data } = await call<{ id: string }>('aichat:conv:create', { projectId, ownerId: owner })
    const turn = (n: number) => [
      { id: `u${n}`, role: 'user', content: `q${n}`, timestamp: n },
      {
        id: `a${n}`,
        role: 'assistant',
        content: '',
        timestamp: n,
        parts: [
          {
            type: 'tool_call',
            id: `c${n}`,
            serverId: 's',
            server: 'S',
            tool: 't',
            argsJson: '{}',
            status: 'done',
          },
          {
            type: 'tool_result',
            callId: `c${n}`,
            content: `r${n}-` + 'x'.repeat(AI_TOOL_RESULT_MAX_CHARS - 10),
            isError: false,
          },
          { type: 'text', text: `answer ${n}` },
        ],
      },
    ]
    // ~32 KB per turn pair → 80 pairs ≈ 2.6 MB.
    const sizeNow = (): number =>
      (
        testDb
          .prepare(
            'SELECT length(CAST(messages_json AS BLOB)) AS b FROM ai_conversations WHERE id = ?',
          )
          .get(data.id) as { b: number }
      ).b
    let last: { turnCount: number } | undefined
    const sizes: number[] = []
    for (let n = 0; n < 80; n++) {
      last = (await call<{ turnCount: number }>('aichat:conv:append', data.id, turn(n))).data
      sizes.push(sizeNow())
    }
    // A trim goes well below the cap, so the next answers append in place
    // again (not one full rewrite per answer once the cap is reached).
    const trims = sizes.filter((b, i) => i > 0 && b < sizes[i - 1])
    expect(trims.length).toBeGreaterThan(0)
    expect(trims.length).toBeLessThanOrEqual(4)
    for (const b of trims) expect(b).toBeLessThanOrEqual(AI_CONVERSATION_TRIM_TO_BYTES)
    expect(last?.turnCount).toBe(160)
    const raw = (
      testDb.prepare('SELECT messages_json FROM ai_conversations WHERE id = ?').get(data.id) as {
        messages_json: string
      }
    ).messages_json
    expect(Buffer.byteLength(raw, 'utf-8')).toBeLessThanOrEqual(AI_CONVERSATION_MAX_BYTES)
    const stored = JSON.parse(raw) as Array<{ parts?: Array<Record<string, unknown>> }>
    expect(stored).toHaveLength(160)
    const results = stored.flatMap((t) => (t.parts ?? []).filter((p) => p.type === 'tool_result'))
    // Oldest cut (note + truncated flag), newest intact.
    expect(results[0]).toMatchObject({ content: AI_CONVERSATION_TRIMMED_NOTE, truncated: true })
    expect(String(results[results.length - 1].content)).toMatch(/^r79-/)
    // The answer text is kept.
    expect(JSON.stringify(stored[1])).toContain('answer 0')

    const list = await call<Array<{ turnCount: number }>>('aichat:conv:list', owner)
    expect(list.data[0].turnCount).toBe(160)
  })

  it('a single over-cap create is trimmed as well', async () => {
    const { capConversation, AI_CONVERSATION_TRIMMED_NOTE } =
      await import('../../../src/main/lib/ai-chat-scrub')
    const big = Array.from({ length: 4 }, (_, n) => ({
      id: `a${n}`,
      role: 'assistant' as const,
      content: '',
      timestamp: n,
      parts: [
        {
          type: 'tool_result' as const,
          callId: `c${n}`,
          content: 'y'.repeat(1000),
          isError: false,
        },
      ],
    }))
    const { turns, trimmed } = capConversation(big, 3_000)
    expect(trimmed).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(turns))).toBeLessThanOrEqual(3_000)
    expect((turns[0] as { parts: Array<{ content: string }> }).parts[0].content).toBe(
      AI_CONVERSATION_TRIMMED_NOTE,
    )
  })

  it('list counts turns in SQL (no JS parse) and survives a corrupt row', async () => {
    const owner = seedEndpoint()
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO ai_conversations (id, project_id, owner_id, name, messages_json, created_at, updated_at)
         VALUES ('bad', ?, ?, 'Bad', '{not json', ?, ?)`,
      )
      .run(projectId, owner, now, now)
    const list = await call<Array<{ id: string; turnCount: number }>>('aichat:conv:list', owner)
    expect(list.success).toBe(true)
    expect(list.data).toEqual([expect.objectContaining({ id: 'bad', turnCount: 0 })])
    // An append to it rewrites it as a valid array.
    const res = await call<{ turnCount: number }>('aichat:conv:append', 'bad', turns('z'))
    expect(res.data.turnCount).toBe(2)
  })
})

describe('project_id and crash leftovers', () => {
  it('project_id is the OWNER project, not the passed (active) one', async () => {
    const other = seedProject(testDb, wsId, 'Other')
    const owner = seedEndpoint()
    const created = await call<{ projectId: string | null }>('aichat:conv:create', {
      projectId: other,
      ownerId: owner,
    })
    expect(created.data.projectId).toBe(projectId)

    // An unsaved tab uses the passed project; its first Save moves it to the row's project.
    const tab = await call<{ id: string; projectId: string | null }>('aichat:conv:create', {
      projectId: other,
      ownerId: 'tab:t-9',
    })
    expect(tab.data.projectId).toBe(other)
    const sr = seedSavedRequest()
    await call('aichat:conv:rehome', 'tab:t-9', sr)
    const row = testDb
      .prepare('SELECT project_id, owner_id FROM ai_conversations WHERE id = ?')
      .get(tab.data.id) as { project_id: string; owner_id: string }
    expect(row).toEqual({ project_id: projectId, owner_id: sr })
  })

  it('startup prune deletes only tab: owners whose tab was not restored', async () => {
    const saved = seedEndpoint()
    await call('aichat:conv:create', { projectId, ownerId: saved })
    await call('aichat:conv:create', { projectId, ownerId: 'tab:alive' })
    await call('aichat:conv:create', { projectId, ownerId: 'tab:crashed' })
    const res = await call<number>('aichat:conv:pruneTabs', ['alive', 'other-open-tab'])
    expect(res.data).toBe(1)
    const owners = (
      testDb.prepare('SELECT owner_id FROM ai_conversations ORDER BY owner_id').all() as Array<{
        owner_id: string
      }>
    ).map((r) => r.owner_id)
    expect(owners.sort()).toEqual([saved, 'tab:alive'].sort())
  })
})
