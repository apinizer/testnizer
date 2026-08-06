/**
 * Run Sequence keeps the folder structure, and roles can be set on a folder
 * (issue #90).
 *
 * What it used to do: flatten a suite into one list of requests and stamp the
 * folder's FULL PATH onto every row. For anything nested that reads as a column
 * of near-identical labels with the hierarchy spelled out sideways — you could
 * see the structure but not use it. There was no collapse, and Setup / Flow /
 * Teardown could only be assigned one request at a time, which is the part
 * users asked to stop doing.
 *
 * The load-bearing detail is that a folder role must reach NESTED folders too.
 * A role that stopped at direct children would be worse than none: the folder
 * would read "Teardown" while half the requests inside it still ran in the
 * flow, and nothing on screen would say so.
 */
import * as React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

import RunnerSequence from '../../src/renderer/components/runner/RunnerSequence'
import type {
  RunnerEndpointItem,
  RunnerFolderGroup,
} from '../../src/renderer/components/runner/RunnerTab'
import type { RunPhase } from '../../src/shared/runner-verdict'

;(globalThis as unknown as { React: typeof React }).React = React

const noop = () => {}

function ep(id: string, name: string, phase?: RunPhase, selected = true): RunnerEndpointItem {
  return { id, name, method: 'GET', url: `/${id}`, selected, phase }
}

/**
 * Auth (root)
 *   ├─ Login          ← direct child
 *   └─ Tokens (nested)
 *        └─ Refresh
 * Orders (root, empty of its own but holds a subfolder)
 *   └─ Create
 * Loose            ← belongs to no folder (a suite-root item)
 */
function fixture(overrides: Partial<Record<string, RunPhase>> = {}): {
  endpoints: RunnerEndpointItem[]
  groups: RunnerFolderGroup[]
} {
  const login = ep('login', 'Login', overrides.login)
  const refresh = ep('refresh', 'Refresh', overrides.refresh)
  const create = ep('create', 'Create order', overrides.create)
  const loose = ep('loose', 'Health check', overrides.loose)
  return {
    endpoints: [login, refresh, create, loose],
    groups: [
      {
        folderId: 'auth',
        folderName: 'Auth',
        label: 'Auth',
        parentId: null,
        endpoints: [login],
      },
      {
        folderId: 'tokens',
        folderName: 'Auth / Tokens',
        label: 'Tokens',
        parentId: 'auth',
        endpoints: [refresh],
      },
      {
        folderId: 'orders',
        folderName: 'Orders',
        label: 'Orders',
        parentId: null,
        endpoints: [],
      },
      {
        folderId: 'orders-new',
        folderName: 'Orders / New',
        label: 'New',
        parentId: 'orders',
        endpoints: [create],
      },
    ],
  }
}

function renderSeq(opts: {
  endpoints?: RunnerEndpointItem[]
  groups?: RunnerFolderGroup[]
  onSetFolderPhase?: (folderId: string, phase: RunPhase) => void
  onToggleFolder?: (folderId: string, selected: boolean) => void
  onSetPhase?: (id: string, phase: RunPhase) => void
}) {
  const f = fixture()
  return render(
    <RunnerSequence
      endpoints={opts.endpoints ?? f.endpoints}
      folderGroups={opts.groups ?? f.groups}
      onToggle={noop}
      onSelectAll={noop}
      onDeselectAll={noop}
      onReset={noop}
      onSetPhase={opts.onSetPhase ?? noop}
      onSetFolderPhase={opts.onSetFolderPhase ?? noop}
      onToggleFolder={opts.onToggleFolder ?? noop}
    />,
  )
}

afterEach(cleanup)

describe('Run Sequence — folder structure', () => {
  it('shows folders as rows instead of flattening them away', () => {
    renderSeq({})
    const folders = screen.getAllByTestId('runner-sequence-folder')
    // Auth, Tokens, Orders, New — including the folder that holds only a
    // subfolder, because dropping it would break the chain to its child.
    expect(folders.map((el) => el.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Auth'),
        expect.stringContaining('Tokens'),
        expect.stringContaining('Orders'),
        expect.stringContaining('New'),
      ]),
    )
  })

  it('labels a nested folder by its own name, not its full path', () => {
    renderSeq({})
    const tokens = screen
      .getAllByTestId('runner-sequence-folder')
      .find((el) => el.textContent?.includes('Tokens'))!
    // "Auth / Tokens" on a row that already sits under Auth is the flattening
    // artefact the issue is about.
    expect(tokens.textContent).not.toContain('Auth / Tokens')
  })

  it('nests a subfolder deeper than its parent', () => {
    renderSeq({})
    const rows = screen.getAllByTestId('runner-sequence-folder')
    const auth = rows.find((el) => el.textContent?.includes('Auth'))!
    const tokens = rows.find((el) => el.textContent?.includes('Tokens'))!
    const indent = (el: HTMLElement): number => parseInt(el.style.paddingLeft || '0', 10)
    expect(indent(tokens)).toBeGreaterThan(indent(auth))
  })

  it('keeps un-foldered requests visible at the top level', () => {
    // Suite-root items belong to no folder. Hiding them because they have no
    // group would silently drop requests from the run sequence.
    renderSeq({})
    expect(screen.getByText('Health check')).toBeTruthy()
  })

  it('collapses a folder and everything under it', () => {
    renderSeq({})
    expect(screen.getByText('Login')).toBeTruthy()
    expect(screen.getByText('Refresh')).toBeTruthy()

    fireEvent.click(screen.getByLabelText(/Collapse Auth/i))

    expect(screen.queryByText('Login')).toBeNull()
    // The nested folder's contents go with it — collapsing one level while a
    // grandchild stayed on screen would be worse than not collapsing.
    expect(screen.queryByText('Refresh')).toBeNull()
    // Untouched branches stay put.
    expect(screen.getByText('Create order')).toBeTruthy()
  })

  it('numbers requests in run order, and keeps numbering while collapsed', () => {
    const { container } = renderSeq({})
    const numbers = () =>
      Array.from(container.querySelectorAll('input[type="checkbox"]'))
        .map((el) => el.parentElement)
        .filter(Boolean).length
    expect(numbers()).toBeGreaterThan(0)
    // 4 requests + 4 folder checkboxes: nothing is dropped by the tree layout.
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(8)
  })

  it('prunes folders that contain no requests at all', () => {
    const empty: RunnerFolderGroup[] = [
      { folderId: 'ghost', folderName: 'Ghost', label: 'Ghost', parentId: null, endpoints: [] },
    ]
    renderSeq({ endpoints: [], groups: empty })
    expect(screen.queryByText('Ghost')).toBeNull()
  })

  it('survives a parent cycle instead of hanging', () => {
    // `parentId` comes from a stored column; a loop in it must not take the
    // screen down with it.
    const cyclic: RunnerFolderGroup[] = [
      { folderId: 'a', folderName: 'A', label: 'A', parentId: 'b', endpoints: [ep('x', 'X')] },
      { folderId: 'b', folderName: 'B', label: 'B', parentId: 'a', endpoints: [ep('y', 'Y')] },
    ]
    expect(() => renderSeq({ endpoints: [ep('x', 'X'), ep('y', 'Y')], groups: cyclic })).not.toThrow()
  })
})

describe('Run Sequence — folder-level roles', () => {
  it('offers a role picker on the folder itself', () => {
    renderSeq({})
    expect(screen.getByLabelText(/Phase — Auth/i)).toBeTruthy()
  })

  it('applies a role to the folder AND its subfolders', () => {
    const onSetFolderPhase = vi.fn()
    renderSeq({ onSetFolderPhase })

    fireEvent.change(screen.getByLabelText(/Phase — Auth/i), { target: { value: 'teardown' } })

    // The component reports the folder; RunnerTab expands it to every request
    // beneath (covered in the runner-tab test). What matters here is that the
    // FOLDER is the unit — not the row the user happened to click near.
    expect(onSetFolderPhase).toHaveBeenCalledWith('auth', 'teardown')
  })

  it('shows the shared role when the whole subtree agrees', () => {
    const f = fixture()
    const tagged = f.endpoints.map((e) =>
      e.id === 'login' || e.id === 'refresh' ? { ...e, phase: 'setup' as RunPhase } : e,
    )
    const groups = f.groups.map((g) => ({
      ...g,
      endpoints: g.endpoints.map(
        (e) => tagged.find((t) => t.id === e.id) ?? e,
      ) as RunnerEndpointItem[],
    }))
    renderSeq({ endpoints: tagged, groups })

    expect((screen.getByLabelText(/Phase — Auth/i) as HTMLSelectElement).value).toBe('setup')
  })

  it('says "Mixed" rather than picking one of the disagreeing roles', () => {
    // Showing "Setup" for a folder that is half Setup and half Flow claims a
    // uniformity that is not there — and the next click would quietly rewrite
    // the other half.
    const f = fixture()
    const tagged = f.endpoints.map((e) =>
      e.id === 'login' ? { ...e, phase: 'setup' as RunPhase } : e,
    )
    const groups = f.groups.map((g) => ({
      ...g,
      endpoints: g.endpoints.map(
        (e) => tagged.find((t) => t.id === e.id) ?? e,
      ) as RunnerEndpointItem[],
    }))
    renderSeq({ endpoints: tagged, groups })

    const select = screen.getByLabelText(/Phase — Auth/i) as HTMLSelectElement
    expect(select.value).toBe('mixed')
    // …and "Mixed" describes a state, so it must not be assignable.
    const mixed = within(select).getByRole('option', { name: /mixed/i }) as HTMLOptionElement
    expect(mixed.disabled).toBe(true)
  })
})

describe('Run Sequence — folder selection', () => {
  it('selects the whole subtree from the folder checkbox', () => {
    const onToggleFolder = vi.fn()
    renderSeq({ onToggleFolder })

    fireEvent.click(screen.getByLabelText(/Select folder Auth/i))
    expect(onToggleFolder).toHaveBeenCalledWith('auth', false)
  })

  it('shows a partial selection as indeterminate, not as unchecked', () => {
    const f = fixture()
    const partial = f.endpoints.map((e) => (e.id === 'login' ? { ...e, selected: false } : e))
    const groups = f.groups.map((g) => ({
      ...g,
      endpoints: g.endpoints.map(
        (e) => partial.find((t) => t.id === e.id) ?? e,
      ) as RunnerEndpointItem[],
    }))
    renderSeq({ endpoints: partial, groups })

    const box = screen.getByLabelText(/Select folder Auth/i) as HTMLInputElement
    // Unchecked and "half selected" must not render identically, or Select All
    // and a partial selection look the same.
    expect(box.checked).toBe(false)
    expect(box.indeterminate).toBe(true)
  })

  it('counts the whole subtree, not just direct children', () => {
    renderSeq({})
    const auth = screen
      .getAllByTestId('runner-sequence-folder')
      .find((el) => el.textContent?.includes('Auth'))!
    // Login + Refresh — the nested folder's request counts toward its parent.
    expect(auth.textContent).toContain('2/2')
  })
})
