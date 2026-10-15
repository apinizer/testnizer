/**
 * Issue #207 — `diffProjectDocs`, the pure row diff behind the Commit panel.
 * It must ignore exactly what `sameExport` ignores (export timestamp,
 * per-machine header fields, row `project_id` / `workspace_id`, row order),
 * so an empty list ⇔ nothing to commit.
 */
import { describe, it, expect } from 'vitest'
import { diffProjectDocs, normaliseExportDoc } from '../../src/main/lib/project-changes'

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
