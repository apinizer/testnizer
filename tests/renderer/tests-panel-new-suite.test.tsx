/**
 * TestsPanel — "new suite" creation lands where the inline input promised
 * (issue #57).
 *
 * `testSuite:list` orders by (sort_order, created_at) and `testSuite:create`
 * always inserts with sort_order 0, so a new suite is APPENDED — same rule the
 * APIs tree follows for a new folder/request. These tests pin the three halves
 * of that contract: the input renders last, the created row shows up last
 * without reordering the rest, and it is actually visible + focused afterwards
 * (including when a search filter was active while creating).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

interface SuiteRow {
  id: string
  project_id: string
  name: string
  description: string | null
  sort_order: number
  created_at: number
  updated_at: number
}

const h = vi.hoisted(() => {
  const state = { suites: [] as SuiteRow[], seq: 0 }
  const ok = <T,>(data: T) => Promise.resolve({ success: true, data })
  const stub = {
    testSuite: {
      list: () => ok(state.suites.slice()),
      create: (payload: { project_id: string; name: string }) => {
        state.seq += 1
        const row: SuiteRow = {
          id: `suite-${state.seq}`,
          project_id: payload.project_id,
          name: payload.name,
          description: null,
          sort_order: 0,
          created_at: Date.now() + state.seq,
          updated_at: Date.now() + state.seq,
        }
        state.suites.push(row) // append — mirrors the ORDER BY in the handler
        return ok(row)
      },
      listEndpoints: () => ok({ items: [], folders: [] }),
      delete: () => ok(true),
      update: () => ok(undefined),
      duplicate: () => ok(undefined),
    },
    testSuiteItem: { create: () => ok(undefined), update: () => ok(undefined) },
    testSuiteFolder: { create: () => ok(undefined) },
    save: { exportTestSuite: () => ok(undefined) },
  }
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = { api: stub }
  else g.window.api = stub
  return { state, stub }
})

import TestsPanel from '../../src/renderer/components/sidebar/TestsPanel'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

const suiteNames = (): string[] =>
  screen.getAllByTestId('suite-row').map((el) => el.textContent?.trim() ?? '')

const openNewSuiteInput = (): void => {
  fireEvent.click(screen.getByTitle('New Test Suite'))
}

const typeAndSubmit = (name: string): void => {
  const input = screen.getByPlaceholderText('Test suite name...')
  fireEvent.change(input, { target: { value: name } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

let scrollSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  h.state.suites = []
  h.state.seq = 0
  scrollSpy = vi.fn()
  // jsdom has no scrollIntoView; the component calls it optionally.
  ;(HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
})

afterEach(() => {
  // vitest runs without `globals`, so RTL's auto-cleanup never registers.
  cleanup()
  vi.clearAllMocks()
})

async function renderWithSuites(names: string[]): Promise<void> {
  for (const name of names) {
    await h.stub.testSuite.create({ project_id: 'p-1', name })
  }
  render(React.createElement(TestsPanel))
  for (const name of names) await screen.findByText(name)
}

describe('TestsPanel — new suite placement (issue #57)', () => {
  it('renders the name input after the existing suites — where the new one lands', async () => {
    await renderWithSuites(['Alpha', 'Beta'])
    openNewSuiteInput()

    const rows = screen.getAllByTestId('suite-row')
    const input = screen.getByTestId('new-suite-row')
    const lastRow = rows[rows.length - 1]
    // DOCUMENT_POSITION_FOLLOWING === 4 → the input comes after the last suite.
    expect(lastRow.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('appends the created suite without reordering the list, and focuses it', async () => {
    await renderWithSuites(['Alpha', 'Beta'])
    openNewSuiteInput()
    typeAndSubmit('Gamma')

    await waitFor(() => expect(screen.queryByText('Gamma')).not.toBeNull())
    // Append, not prepend — and the pre-existing rows keep their order.
    expect(suiteNames()).toEqual(['Alpha', 'Beta', 'Gamma'])
    const rows = screen.getAllByTestId('suite-row')
    // Only the freshly created row is marked — no stale highlight elsewhere.
    expect(rows.map((r) => r.getAttribute('data-focused'))).toEqual([null, null, 'true'])
    // Appended rows can sit below the fold, so the panel must scroll to it.
    expect(scrollSpy).toHaveBeenCalled()
  })

  it('drops a search filter that would hide the freshly created suite', async () => {
    await renderWithSuites(['Alpha', 'Beta'])
    const search = screen.getByPlaceholderText('Search...') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'alpha' } })
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())

    openNewSuiteInput()
    typeAndSubmit('Gamma')

    // Without the fix the suite is created but the still-active filter hides
    // it, so the panel looks like nothing happened.
    await waitFor(() => expect(screen.queryByText('Gamma')).not.toBeNull())
    expect(search.value).toBe('')
  })

  it('keeps the search filter when the new suite still matches it', async () => {
    await renderWithSuites(['Alpha'])
    const search = screen.getByPlaceholderText('Search...') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'alpha' } })

    openNewSuiteInput()
    typeAndSubmit('Alpha copy')

    await waitFor(() => expect(screen.queryByText('Alpha copy')).not.toBeNull())
    expect(search.value).toBe('alpha')
  })
})
