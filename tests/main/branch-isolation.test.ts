/**
 * Branch isolation (issue #8). Content created on a non-default branch carries
 * that branch's name in `branch_id`; shared content (created on the default
 * branch or before branching) has branch_id NULL. The tree query must show
 * shared content on every branch plus the active branch's own content, and
 * never another branch's content. This pins the exact predicate the repo's
 * getFoldersByProject / getEndpointsByProject / getSavedRequestsByProject use.
 */
import { describe, it, expect } from 'vitest'
import { createTestDb } from './handlers/helpers'

const INSERT =
  'INSERT INTO folders (id, project_id, parent_id, name, sort_order, branch_id) VALUES (?, ?, ?, ?, ?, ?)'

function seed(db: ReturnType<typeof createTestDb>): void {
  const pid = 'p1'
  db.prepare(INSERT).run('f-shared', pid, null, 'Shared', 0, null) // pre-branch / default
  db.prepare(INSERT).run('f-test', pid, null, 'On test', 1, 'test') // created on branch "test"
  db.prepare(INSERT).run('f-other', pid, null, 'On other', 2, 'other') // a different branch
}

// Mirrors getFoldersByProject's branch-scoped queries.
function listForBranch(
  db: ReturnType<typeof createTestDb>,
  branchId: string | null,
): string[] {
  const rows =
    branchId === null
      ? db
          .prepare(
            'SELECT id FROM folders WHERE project_id = ? AND branch_id IS NULL ORDER BY sort_order',
          )
          .all('p1')
      : db
          .prepare(
            'SELECT id FROM folders WHERE project_id = ? AND (branch_id IS NULL OR branch_id = ?) ORDER BY sort_order',
          )
          .all('p1', branchId)
  return (rows as Array<{ id: string }>).map((r) => r.id)
}

describe('branch isolation (#8)', () => {
  it('the default branch (scope null) sees only shared content', () => {
    const db = createTestDb()
    seed(db)
    expect(listForBranch(db, null)).toEqual(['f-shared'])
    db.close()
  })

  it('a non-default branch sees shared + its own content, not other branches', () => {
    const db = createTestDb()
    seed(db)
    expect(listForBranch(db, 'test')).toEqual(['f-shared', 'f-test'])
    db.close()
  })

  it('content created on one branch never leaks to another', () => {
    const db = createTestDb()
    seed(db)
    expect(listForBranch(db, 'other')).toEqual(['f-shared', 'f-other'])
    // "test"-branch content is absent from "other".
    expect(listForBranch(db, 'other')).not.toContain('f-test')
    db.close()
  })
})
