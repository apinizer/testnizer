/**
 * Issue #207 — `diffProjectDocs`, the pure row diff behind the Commit panel.
 * It must ignore exactly what `sameExport` ignores (export timestamp,
 * per-machine header fields, row `project_id` / `workspace_id`, row order),
 * so an empty list ⇔ nothing to commit.
 */
import { describe, it, expect } from 'vitest'
import {
  applySelectedChanges,
  diffProjectDocs,
  normaliseExportDoc,
} from '../../src/main/lib/project-changes'
import { withDependentChanges, withRequiredChanges } from '../../src/shared/git-changes'

type Doc = Record<string, unknown>

function doc(over: Doc = {}): Doc {
  return {
    version: '1',
    exportedAt: 1,
    project: { id: 'p-A', name: 'Shared', display_name: null, description: null, local_path: '/a' },
    folders: [{ id: 'f1', project_id: 'p-A', name: 'Root', sort_order: 0 }],
    endpoints: [
      { id: 'e1', project_id: 'p-A', name: 'Orders', method: 'GET', path: '/o' },
      { id: 'e2', project_id: 'p-A', name: 'Users', method: 'GET', path: '/u' },
    ],
    environments: [{ id: 'env1', workspace_id: 'w-A', project_id: 'p-A', name: 'Dev' }],
    environmentVariables: [{ id: 'v1', environment_id: 'env1', key: 'host', value: 'a' }],
    mockEndpoints: [{ id: 'me1', server_id: 's1', method: 'POST', path: '/pay' }],
    ...over,
  }
}

describe('diffProjectDocs (issue #207)', () => {
  it('per-machine fields, timestamps and row order are not changes', () => {
    const head = doc()
    const live = doc({
      exportedAt: 999,
      project: {
        id: 'p-B',
        name: 'Shared',
        display_name: null,
        description: null,
        local_path: '/b',
      },
      endpoints: [
        { id: 'e2', project_id: 'p-B', name: 'Users', method: 'GET', path: '/u' },
        { path: '/o', method: 'GET', name: 'Orders', project_id: 'p-B', id: 'e1' },
      ],
      environments: [{ id: 'env1', workspace_id: 'w-B', project_id: 'p-B', name: 'Dev' }],
    })
    expect(diffProjectDocs(head, live)).toEqual([])
    expect(normaliseExportDoc(head)).toBe(normaliseExportDoc(live))
  })

  it('names rows the way the user knows them and marks A / M / D', () => {
    const head = doc()
    const live = doc({
      folders: [],
      endpoints: [
        { id: 'e1', project_id: 'p-A', name: 'Orders', method: 'POST', path: '/o' },
        { id: 'e2', project_id: 'p-A', name: 'Users', method: 'GET', path: '/u' },
        { id: 'e3', project_id: 'p-A', name: 'Payments', method: 'GET', path: '/p' },
      ],
      environmentVariables: [{ id: 'v1', environment_id: 'env1', key: 'host', value: 'b' }],
      mockEndpoints: [],
    })
    expect(diffProjectDocs(head, live)).toEqual([
      { kind: 'folder', id: 'f1', name: 'Root', change: 'deleted' },
      { kind: 'endpoint', id: 'e1', name: 'Orders', change: 'modified' },
      { kind: 'endpoint', id: 'e3', name: 'Payments', change: 'added' },
      { kind: 'variable', id: 'v1', name: 'Dev › host', change: 'modified' },
      { kind: 'mockEndpoint', id: 'me1', name: 'POST /pay', change: 'deleted' },
    ])
  })

  it('name / display name / description travel with the file → one `project` item', () => {
    const live = doc({ project: { id: 'p-A', name: 'Shared', display_name: 'Shared v2' } })
    expect(diffProjectDocs(doc(), live)).toEqual([
      { kind: 'project', id: 'p-A', name: 'Shared v2', change: 'modified' },
    ])
  })

  it('no file at HEAD: the project file and every row are added', () => {
    const items = diffProjectDocs(null, doc())
    expect(items[0]).toEqual({ kind: 'project', id: 'p-A', name: 'Shared', change: 'added' })
    expect(items.every((i) => i.change === 'added')).toBe(true)
    expect(items).toHaveLength(1 + 1 + 2 + 1 + 1 + 1)
  })
})

/**
 * Issue #214 — selective commit. `requires` names what a change cannot be
 * committed without; `applySelectedChanges` builds the partial file; the
 * closure helpers keep the selection consistent both ways.
 */
describe('selective commit (issue #214)', () => {
  const rows = (d: Doc, section: string): Doc[] => (d[section] as Doc[] | undefined) ?? []
  const ids = (d: Doc, section: string): string[] => rows(d, section).map((r) => r.id as string)

  it('an added row in an added folder requires the folder; a folder deletion requires its rows', () => {
    const head = doc()
    const live = doc({
      folders: [
        { id: 'f1', project_id: 'p-A', name: 'Root', sort_order: 0 },
        { id: 'f2', project_id: 'p-A', name: 'Billing', parent_id: 'f1', sort_order: 1 },
      ],
      endpoints: [
        { id: 'e1', project_id: 'p-A', name: 'Orders', method: 'GET', path: '/o' },
        { id: 'e2', project_id: 'p-A', name: 'Users', method: 'GET', path: '/u' },
        {
          id: 'e3',
          project_id: 'p-A',
          folder_id: 'f2',
          name: 'Invoices',
          method: 'GET',
          path: '/i',
        },
      ],
    })
    const items = diffProjectDocs(head, live)
    expect(items.find((i) => i.id === 'e3')?.requires).toEqual(['folder:f2'])
    // f2's parent f1 is unchanged → nothing required for the folder itself.
    expect(items.find((i) => i.id === 'f2')?.requires).toBeUndefined()

    const before = doc({
      endpoints: [
        { id: 'e1', project_id: 'p-A', folder_id: 'f1', name: 'Orders', method: 'GET', path: '/o' },
        { id: 'e2', project_id: 'p-A', folder_id: 'f1', name: 'Users', method: 'GET', path: '/u' },
      ],
    })
    const after = doc({
      folders: [],
      endpoints: [
        { id: 'e2', project_id: 'p-A', folder_id: null, name: 'Users', method: 'GET', path: '/u' },
      ],
    })
    const del = diffProjectDocs(before, after)
    // Deleting f1 needs e1's deletion and e2's move out of it.
    expect(del.find((i) => i.id === 'f1')?.requires).toEqual(['endpoint:e1', 'endpoint:e2'])
    expect(del.find((i) => i.id === 'e1')?.requires).toBeUndefined()
  })

  it('no file at HEAD: every row requires the project file', () => {
    const items = diffProjectDocs(null, doc())
    expect(items[0].requires).toBeUndefined()
    expect(items.slice(1).every((i) => i.requires?.includes('project:p-A'))).toBe(true)
  })

  it('applySelectedChanges takes only the selected rows from live, everything else from HEAD', () => {
    const head = doc()
    const live = doc({
      project: { id: 'p-A', name: 'Shared', display_name: 'Renamed' },
      endpoints: [
        { id: 'e1', project_id: 'p-A', name: 'Orders v2', method: 'GET', path: '/o' },
        { id: 'e3', project_id: 'p-A', name: 'Payments', method: 'POST', path: '/p' },
        { id: 'e4', project_id: 'p-A', name: 'Draft', method: 'GET', path: '/d' },
      ],
      environmentVariables: [{ id: 'v1', environment_id: 'env1', key: 'host', value: 'b' }],
    })
    const out = applySelectedChanges(head, live, new Set(['endpoint:e3', 'endpoint:e2']))
    // e2 deleted (selected), e3 added (selected); e1's edit and e4 not selected.
    expect(rows(out, 'endpoints').map((r) => r.name)).toEqual(['Orders', 'Payments'])
    expect(rows(out, 'environmentVariables')[0].value).toBe('a')
    expect((out.project as Doc).display_name).toBe(null)

    const withHeader = applySelectedChanges(head, live, new Set(['project:p-A', 'endpoint:e1']))
    expect((withHeader.project as Doc).display_name).toBe('Renamed')
    expect(rows(withHeader, 'endpoints').map((r) => r.name)).toEqual(['Orders v2', 'Users'])
  })

  it('selecting every change reproduces the live file; selecting none reproduces HEAD', () => {
    const head = doc()
    const live = doc({
      folders: [],
      endpoints: [{ id: 'e9', project_id: 'p-A', name: 'New', method: 'GET', path: '/n' }],
    })
    const items = diffProjectDocs(head, live)
    const all = applySelectedChanges(head, live, new Set(items.map((i) => `${i.kind}:${i.id}`)))
    expect(normaliseExportDoc(all)).toBe(normaliseExportDoc(live))
    expect(normaliseExportDoc(applySelectedChanges(head, live, new Set()))).toBe(
      normaliseExportDoc({ ...head, exportedAt: live.exportedAt }),
    )
  })

  it('a closed selection never leaves a dangling reference', () => {
    const head = doc({
      endpoints: [
        { id: 'e1', project_id: 'p-A', folder_id: 'f1', name: 'Orders', method: 'GET', path: '/o' },
      ],
    })
    const live = doc({
      folders: [{ id: 'f9', project_id: 'p-A', name: 'New', sort_order: 0 }],
      endpoints: [
        { id: 'e1', project_id: 'p-A', folder_id: 'f9', name: 'Orders', method: 'GET', path: '/o' },
      ],
    })
    const items = diffProjectDocs(head, live)
    for (const start of items) {
      const keys = withRequiredChanges([`${start.kind}:${start.id}`], items)
      const out = applySelectedChanges(head, live, keys)
      const folderIds = new Set(ids(out, 'folders'))
      for (const e of rows(out, 'endpoints')) {
        if (e.folder_id) expect(folderIds.has(e.folder_id as string)).toBe(true)
      }
    }
    // Unchecking the new folder unchecks the request moved into it.
    expect([...withDependentChanges(['folder:f9'], items)].sort()).toEqual([
      'endpoint:e1',
      'folder:f1',
      'folder:f9',
    ])
  })
})
