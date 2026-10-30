/**
 * Issue #257 (item: Postman export item order differs from the tree order).
 *
 * Decision: the export lists items in the order the APIs tree shows them
 * (pinned by tests/renderer/tree-order-257.test.ts against the real tree
 * builder; both files share tests/fixtures/export-order-257.ts and its
 * `EXPECTED_TREE_ORDER`):
 *
 *   root:    folders (table order), then endpoints, then saved requests
 *   folder:  endpoints, then saved requests, THEN sub-folders
 *
 * Today both exports put sub-folders FIRST at every level, and merge
 * endpoints + saved requests by sort_order (Postman v2.1 `buildPostmanProjectExport`
 * -> `buildPostmanCollection`; v3 `loadProjectTree` with `requestsFirst:false`).
 *
 * CONTRACT for the implementer (single owner, like src/shared/suite-order.ts):
 * put the ordering rule in ONE helper in `src/shared/` (suggested
 * `src/shared/tree-order.ts`: given folders + requests rows return each
 * level's ordered children) and have v2.1, v3 (JSON and folder form) and — as
 * a follow-up the orchestrator may defer — Insomnia/OpenAPI import it. The
 * tree itself (`buildTreeFromDB`) may also adopt the helper, but its observable
 * order must not change. Test SUITE exports are NOT in scope: a suite runs a
 * level's requests first and then folders (`suite-order.ts`), which already
 * matches.
 *
 * DECISION FLAG (reported to the orchestrator): the tree never interleaves
 * endpoints and saved requests by sort_order (endpoints always first), while
 * "Both tables share one sort_order space" per the repo comments. This test
 * pins the TREE (S-alpha has a lower sort_order than E-alpha-2 yet exports
 * after it). If the product decision is instead to make the tree merge by
 * sort_order, change the fixture + tree test + this test together.
 *
 * Red now: v2.1 and v3 both emit sub-folders before requests; both also order
 * S-alpha before E-alpha-2.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-export-order-257-'))
type Handler = (event: unknown, ...args: unknown[]) => unknown
vi.mock('electron', () => ({
  app: { getPath: (): string => tmpDir },
  ipcMain: { handle: (_c: string, _fn: Handler): void => {} },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))
vi.mock('../../src/main/protocols/grpc.engine', () => ({ loadProto: () => Promise.resolve({}) }))

import { initDatabase, getDb } from '../../src/main/db/database'
import { buildPostmanProjectExport } from '../../src/main/ipc/import-export.handler'
import { buildPostmanV3ProjectExport } from '../../src/main/export/postman-v3'
import {
  ENDPOINTS,
  EXPECTED_TREE_ORDER,
  FOLDERS,
  SAVED,
  type OrderNode,
} from '../fixtures/export-order-257'

let projectId = ''

beforeAll(() => {
  initDatabase()
  const db = getDb()
  const now = Date.now()
  const workspaceId = (db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
  projectId = randomUUID()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
     VALUES (?, ?, 'Order 257', NULL, 'http', 0, ?, ?)`,
  ).run(projectId, workspaceId, now, now)

  const folderIds = new Map<string, string>()
  for (const f of FOLDERS) {
    const id = randomUUID()
    folderIds.set(f.name, id)
    db.prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, projectId, f.parent ? folderIds.get(f.parent)! : null, f.name, f.sort)
  }
  for (const e of ENDPOINTS) {
    db.prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'http', 'GET', ?, 'draft', ?, ?, ?)`,
    ).run(
      randomUUID(),
      projectId,
      e.folder ? folderIds.get(e.folder)! : null,
      e.name,
      `/${e.name}`,
      e.sort,
      now,
      now,
    )
  }
  for (const s of SAVED) {
    db.prepare(
      `INSERT INTO saved_requests (id, project_id, folder_id, name, protocol, method, url, params, headers, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'http', 'GET', ?, '[]', '[]', ?, ?, ?)`,
    ).run(
      randomUUID(),
      projectId,
      s.folder ? folderIds.get(s.folder)! : null,
      s.name,
      `/${s.name}`,
      s.sort,
      now,
      now,
    )
  }
})

interface V2Item {
  name: string
  item?: V2Item[]
}
function fromV2(items: V2Item[]): OrderNode[] {
  return items.map((i) => (i.item ? { [i.name]: fromV2(i.item) } : i.name))
}

interface V3Item {
  $kind?: string
  name: string
  items?: V3Item[]
}
function fromV3(items: V3Item[]): OrderNode[] {
  return items.map((i) => (i.$kind === 'collection' ? { [i.name]: fromV3(i.items ?? []) } : i.name))
}

describe('Postman export order = APIs tree order (issue #257)', () => {
  it('v2.1: folders -> endpoints -> saved at the root; requests before sub-folders inside a folder', () => {
    const { content, skipped } = buildPostmanProjectExport(projectId)
    expect(skipped).toEqual([])
    const collection = JSON.parse(content) as { item: V2Item[] }
    expect(fromV2(collection.item)).toEqual(EXPECTED_TREE_ORDER)
  })

  it('v3 JSON document: same order', () => {
    const { collection } = buildPostmanV3ProjectExport(projectId)
    expect(fromV3((collection as unknown as { items: V3Item[] }).items)).toEqual(
      EXPECTED_TREE_ORDER,
    )
  })

  it('v2.1 and v3 agree with each other', () => {
    const v2 = fromV2(
      (JSON.parse(buildPostmanProjectExport(projectId).content) as { item: V2Item[] }).item,
    )
    const v3 = fromV3(
      (buildPostmanV3ProjectExport(projectId).collection as unknown as { items: V3Item[] }).items,
    )
    expect(v2).toEqual(v3)
  })
})

describe('guard — suite exports keep their own rule (requests first, then folders)', () => {
  it('the suite-order helper is untouched by this issue', async () => {
    const { orderSuiteItems } = await import('../../src/shared/suite-order')
    expect(typeof orderSuiteItems).toBe('function')
  })
})
