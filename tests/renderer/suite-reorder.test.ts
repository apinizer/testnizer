/**
 * Dragging a request in a suite's Run Sequence must keep it in the folder it
 * was dropped into. The handler used to send `targetFolderId: null`, so every
 * reorder pulled the request out to the suite root, where its folder's auth
 * and pre/post scripts (e.g. the `01 Setup` script that sets `ApiProxyName`)
 * stopped applying.
 */
import { describe, it, expect } from 'vitest'
import { suiteReorderTarget } from '../../src/renderer/lib/suite-reorder'

const groups = [
  { folderId: 'f-init', endpoints: [{ id: 'init-0' }, { id: 'init-1' }, { id: 'init-2' }] },
  { folderId: 'f-setup', endpoints: [{ id: 'setup-0' }, { id: 'setup-1' }] },
]

describe('suiteReorderTarget', () => {
  it('a reorder inside a folder stays in that folder', () => {
    expect(suiteReorderTarget(groups, 'init-2', 'init-0', 'init-0')).toEqual({
      targetFolderId: 'f-init',
      insertBeforeId: 'init-0',
    })
  })

  it('dropped after the last row of a folder: appended to THAT folder, not the next one', () => {
    // "after init-2" → next row is setup-0, which belongs to the next folder.
    expect(suiteReorderTarget(groups, 'init-0', 'setup-0', 'init-2')).toEqual({
      targetFolderId: 'f-init',
      insertBeforeId: null,
    })
  })

  it('dropped on a row of another folder moves into that folder', () => {
    expect(suiteReorderTarget(groups, 'init-1', 'setup-1', 'setup-1')).toEqual({
      targetFolderId: 'f-setup',
      insertBeforeId: 'setup-1',
    })
  })

  it('a root-level row (no folder) stays at the root', () => {
    expect(suiteReorderTarget(groups, 'loose-a', 'loose-b', 'loose-b')).toEqual({
      targetFolderId: null,
      insertBeforeId: 'loose-b',
    })
  })

  it('dropped at the very end with no anchor keeps the dragged row’s folder', () => {
    expect(suiteReorderTarget(groups, 'setup-0', null)).toEqual({
      targetFolderId: 'f-setup',
      insertBeforeId: null,
    })
  })
})
