/**
 * Row-level three-way merge of project files (`src/main/lib/project-merge.ts`).
 * Guards the rules git.handler relies on when it auto-resolves a conflicted
 * merge / pull instead of asking the user to throw one side away.
 */
import { describe, it, expect } from 'vitest'
import { mergeProjectDocs, mergeProjectFiles } from '../../src/main/lib/project-merge'

type Row = Record<string, unknown>
const ep = (id: string, name: string, extra: Row = {}): Row => ({
  id,
  project_id: 'p',
  folder_id: null,
  name,
  method: 'GET',
  path: `/${id}`,
  updated_at: 1000,
  ...extra,
})
const doc = (endpoints: Row[], extra: Row = {}): Row => ({
  version: 'testnizer-project/2.0',
  exportedAt: 1,
  kind: 'project',
  project: { id: 'p', name: 'P' },
  folders: [],
  endpoints,
  endpointCases: [],
  savedRequests: [],
  environments: [],
  environmentVariables: [],
  globalVariables: [],
  ...extra,
})
const names = (d: Row, section = 'endpoints'): string[] =>
  (d[section] as Row[]).map((r) => r.name as string)

describe('mergeProjectDocs — rows, not lines', () => {
  it('keeps rows added on either side (the case git turns into a conflict)', () => {
    const base = doc([ep('1', 'one')])
    const ours = doc([ep('1', 'one'), ep('2', 'mine')])
    const theirs = doc([ep('1', 'one'), ep('3', 'yours')])
    expect(names(mergeProjectDocs(base, ours, theirs))).toEqual(['one', 'mine', 'yours'])
  })

  it('applies a deletion made on one side when the other side left the row alone', () => {
    const base = doc([ep('1', 'one'), ep('2', 'two')])
    const ours = doc([ep('1', 'one')]) // we deleted 2
    const theirs = doc([ep('1', 'one'), ep('2', 'two')])
    expect(names(mergeProjectDocs(base, ours, theirs))).toEqual(['one'])
    expect(names(mergeProjectDocs(base, theirs, ours))).toEqual(['one'])
  })

  it('a change beats a stale delete (edited work is never lost)', () => {
    const base = doc([ep('1', 'one'), ep('2', 'two')])
    const ours = doc([ep('1', 'one')])
    const theirs = doc([ep('1', 'one'), ep('2', 'two renamed', { updated_at: 2000 })])
    expect(names(mergeProjectDocs(base, ours, theirs))).toEqual(['one', 'two renamed'])
  })

  it('takes the side that changed a row; both changed → the newer updated_at, ours on tie', () => {
    const base = doc([ep('1', 'one')])
    const oursOnly = mergeProjectDocs(
      base,
      doc([ep('1', 'one (mine)', { updated_at: 1500 })]),
      doc([ep('1', 'one')]),
    )
    expect(names(oursOnly)).toEqual(['one (mine)'])

    const both = mergeProjectDocs(
      base,
      doc([ep('1', 'one (mine)', { updated_at: 1500 })]),
      doc([ep('1', 'one (yours)', { updated_at: 3000 })]),
    )
    expect(names(both)).toEqual(['one (yours)'])

    const tie = mergeProjectDocs(
      base,
      doc([ep('1', 'one (mine)', { updated_at: 1500 })]),
      doc([ep('1', 'one (yours)', { updated_at: 1500 })]),
    )
    expect(names(tie)).toEqual(['one (mine)'])
  })

  it('a row that differs only in project_id / workspace_id counts as unchanged (a delete still wins)', () => {
    const base = doc([ep('1', 'one'), ep('2', 'two')])
    // We deleted 2; they merely re-exported from another machine (rebound ids).
    const ours = doc([ep('1', 'one')])
    const theirs = doc([
      ep('1', 'one', { project_id: 'machine-b' }),
      ep('2', 'two', { project_id: 'machine-b' }),
    ])
    expect(names(mergeProjectDocs(base, ours, theirs))).toEqual(['one'])
  })

  it('ignores key order when deciding whether a row changed', () => {
    const base = doc([ep('1', 'one')])
    const reordered = {
      name: 'one',
      id: '1',
      path: '/1',
      method: 'GET',
      folder_id: null,
      project_id: 'p',
      updated_at: 1000,
    }
    const ours = doc([reordered])
    const theirs = doc([ep('1', 'one', { path: '/changed' })])
    expect((mergeProjectDocs(base, ours, theirs).endpoints as Row[])[0].path).toBe('/changed')
  })

  it('without a common ancestor every row is an addition', () => {
    const ours = doc([ep('1', 'a')])
    const theirs = doc([ep('2', 'b')])
    expect(names(mergeProjectDocs(null, ours, theirs))).toEqual(['a', 'b'])
  })

  it('re-parents requests whose folder was deleted and drops cases whose request is gone', () => {
    const base = doc([ep('1', 'one', { folder_id: 'f' }), ep('2', 'two')], {
      folders: [{ id: 'f', project_id: 'p', parent_id: null, name: 'F' }],
      endpointCases: [{ id: 'c2', endpoint_id: '2', name: 'case' }],
    })
    // We deleted folder F (and, with it, nothing else) and request 2.
    const ours = doc([ep('1', 'one', { folder_id: 'f' })], { folders: [], endpointCases: [] })
    // They added request 3 under F and a case under 2.
    const theirs = doc(
      [ep('1', 'one', { folder_id: 'f' }), ep('2', 'two'), ep('3', 'three', { folder_id: 'f' })],
      {
        folders: [{ id: 'f', project_id: 'p', parent_id: null, name: 'F' }],
        endpointCases: [
          { id: 'c2', endpoint_id: '2', name: 'case' },
          { id: 'c2b', endpoint_id: '2', name: 'another' },
        ],
      },
    )
    const out = mergeProjectDocs(base, ours, theirs)
    expect(names(out, 'folders')).toEqual([])
    expect(names(out)).toEqual(['one', 'three'])
    for (const r of out.endpoints as Row[]) expect(r.folder_id).toBeNull()
    expect(out.endpointCases).toEqual([])
  })

  it('leaves sections neither side carries untouched (older exports)', () => {
    const ours = doc([ep('1', 'one')])
    const theirs = doc([ep('1', 'one')])
    const out = mergeProjectDocs(null, ours, theirs)
    expect('savedResponses' in out).toBe(false)
    expect('mockServers' in out).toBe(false)
  })
})

describe('mergeProjectFiles — text wrapper', () => {
  it('returns merged JSON text for two parsable project files', () => {
    const base = JSON.stringify(doc([ep('1', 'one')]))
    const ours = JSON.stringify(doc([ep('1', 'one'), ep('2', 'mine')]))
    const theirs = JSON.stringify(doc([ep('1', 'one'), ep('3', 'yours')]))
    const out = mergeProjectFiles(base, ours, theirs)
    expect(out).not.toBeNull()
    expect(names(JSON.parse(out as string) as Row)).toEqual(['one', 'mine', 'yours'])
  })

  it('gives up (null) on an unparsable side or a non-project file — the user decides', () => {
    const ours = JSON.stringify(doc([ep('1', 'one')]))
    expect(mergeProjectFiles('', ours, '{ not json')).toBeNull()
    expect(mergeProjectFiles('', ours, '')).toBeNull()
    expect(mergeProjectFiles('', '{"foo":1}', ours)).toBeNull()
  })
})
