/**
 * issue #95 — searching the Environment / Variables table.
 *
 * The ask is small ("filter by name, preferably by value too"), but a filter
 * laid over an editable table has three ways to go wrong, and each one reads to
 * the user as a broken feature rather than a filtered one:
 *
 *   - "Add Variable" creates a row with an empty key, which no active filter
 *     matches — so the button appears to do nothing.
 *   - Renaming the key you searched for makes the row stop matching, pulling
 *     the input out from under the cursor mid-keystroke.
 *   - The filter is view state, not data: carrying it across an environment
 *     switch greets the next environment with an empty-looking table.
 *
 * These drive the real modal, because all three are about the filter's
 * relationship with the rest of the table rather than the match itself.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

import { mockWindowApi } from './screens/_mount'
import EnvironmentModal from '../../src/renderer/components/modals/EnvironmentModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { Environment, EnvironmentVariable, GlobalVariable } from '../../src/renderer/types'

function variable(over: Partial<EnvironmentVariable> & { id: string }): EnvironmentVariable {
  return {
    key: '',
    value: '',
    initialValue: '',
    enabled: true,
    secret: false,
    ...over,
  } as EnvironmentVariable
}

/** An ApiOps-shaped set: the kind of list the issue says is slow to scroll. */
const PROD_VARS: EnvironmentVariable[] = [
  variable({ id: 'v1', key: 'AccessURL', initialValue: 'https://api.example.com' }),
  variable({ id: 'v2', key: 'ProjectName', initialValue: 'demo-project' }),
  variable({ id: 'v3', key: 'token', value: 's3cr3t-abc', secret: true }),
  variable({ id: 'v4', key: 'timeout', initialValue: '30' }),
]

function env(id: string, name: string, variables: EnvironmentVariable[]): Environment {
  return {
    id,
    workspace_id: 'ws-1',
    name,
    is_active: false,
    variables,
    created_at: 0,
    updated_at: 0,
  }
}

function stubDom(): void {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.scrollIntoView = () => {}
}

/** Keys currently rendered in the table, in order. */
function visibleKeys(): string[] {
  return screen
    .queryAllByTestId('env-var-key')
    .map((el) => (el as HTMLInputElement).value)
    .filter((v) => v !== undefined)
}

function search(): HTMLInputElement {
  return screen.getByTestId('env-var-search') as HTMLInputElement
}

function type(text: string): void {
  act(() => {
    fireEvent.change(search(), { target: { value: text } })
  })
}

/** Open the right-hand pane for an environment by name. */
function openEnv(name: string): void {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
  })
}

beforeEach(() => {
  stubDom()
  mockWindowApi()
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useUIStore.setState({ showEnvironmentModal: true })
  useEnvironmentStore.setState({
    environments: [env('e-prod', 'Production', PROD_VARS), env('e-stage', 'Staging', [])],
    activeEnvironmentId: 'e-prod',
    globalVariables: [
      {
        ...variable({ id: 'g1', key: 'baseUrl', initialValue: 'http://localhost' }),
        workspace_id: 'ws-1',
      },
      { ...variable({ id: 'g2', key: 'apiKey', initialValue: 'abc' }), workspace_id: 'ws-1' },
    ] as GlobalVariable[],
  })
})

afterEach(cleanup)

describe('filtering the variables table (#95)', () => {
  it('narrows the list to the variable being looked for', () => {
    render(<EnvironmentModal />)
    openEnv('Production')
    expect(visibleKeys()).toHaveLength(4)

    type('access')

    // Substring, case-insensitive — the reported need is "is AccessURL here?".
    expect(visibleKeys()).toEqual(['AccessURL'])
  })

  it('matches values as well as names', () => {
    render(<EnvironmentModal />)
    openEnv('Production')

    type('example.com')
    expect(visibleKeys()).toEqual(['AccessURL'])

    // Including a secret's value: it stays masked on screen, and the per-row
    // reveal toggle is unconditional, so skipping secrets would only make the
    // search quietly incomplete.
    type('s3cr3t')
    expect(visibleKeys()).toEqual(['token'])
  })

  it('answers "is it present?" with a count, not just a shorter list', () => {
    render(<EnvironmentModal />)
    openEnv('Production')

    type('name')
    expect(screen.getByTestId('env-var-search-count').textContent).toContain('1')
    expect(screen.getByTestId('env-var-search-count').textContent).toContain('4')
  })

  it('says nothing matched instead of showing an empty table', () => {
    render(<EnvironmentModal />)
    openEnv('Production')

    type('nope-not-here')

    // An empty table is indistinguishable from an environment with no
    // variables at all — which is the misreading this message prevents.
    expect(visibleKeys()).toHaveLength(0)
    expect(screen.getByTestId('env-var-no-match')).toBeTruthy()
  })

  it('restores the full list when the search is cleared', () => {
    render(<EnvironmentModal />)
    openEnv('Production')
    type('access')
    expect(visibleKeys()).toHaveLength(1)

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /clear search/i }))
    })

    expect(visibleKeys()).toHaveLength(4)
    expect(search().value).toBe('')
  })
})

describe('the filter does not break the table it sits on (#95)', () => {
  it('shows the row that "Add Variable" just created', async () => {
    render(<EnvironmentModal />)
    openEnv('Production')
    type('access')
    expect(visibleKeys()).toEqual(['AccessURL'])

    await act(async () => {
      fireEvent.click(screen.getByTestId('env-var-add'))
    })

    // A new row has an empty key, so leaving the filter on would hide it the
    // instant it was created and the button would read as broken.
    expect(search().value).toBe('')
    expect(visibleKeys()).toHaveLength(5)
    expect(visibleKeys().at(-1)).toBe('')
  })

  it('keeps the row you are renaming, even once the new name stops matching', async () => {
    render(<EnvironmentModal />)
    openEnv('Production')
    type('access')

    const keyInput = screen.getByTestId('env-var-key') as HTMLInputElement
    act(() => {
      keyInput.focus()
    })
    await act(async () => {
      fireEvent.change(keyInput, { target: { value: 'Zzz' } })
    })

    // Without this, the field vanishes from under the cursor mid-keystroke.
    expect(visibleKeys()).toEqual(['Zzz'])

    // A new search is a new intent: the renamed row loses its reprieve and the
    // filter applies to everything again.
    type('token')
    expect(visibleKeys()).toEqual(['token'])
  })

  it('does not carry a filter across an environment switch', () => {
    render(<EnvironmentModal />)
    openEnv('Production')
    type('access')
    expect(visibleKeys()).toHaveLength(1)

    openEnv('Staging')
    openEnv('Production')

    expect(search().value).toBe('')
    expect(visibleKeys()).toHaveLength(4)
  })

  it('offers no search box when there is nothing to search', () => {
    render(<EnvironmentModal />)
    openEnv('Staging')

    expect(screen.queryByTestId('env-var-search')).toBeNull()
  })
})

describe('Globals get the same search (#95)', () => {
  it('filters the globals table too', () => {
    render(<EnvironmentModal />)
    // Globals is the pane the modal opens on.
    expect(visibleKeys()).toEqual(['baseUrl', 'apiKey'])

    type('apikey')

    expect(visibleKeys()).toEqual(['apiKey'])
  })

  it('does not leak the globals filter into an environment', () => {
    render(<EnvironmentModal />)
    type('apikey')

    openEnv('Production')

    expect(
      within(screen.getByTestId('environment-modal')).queryAllByTestId('env-var-key'),
    ).toHaveLength(4)
  })
})

describe('the variables table lays out in one line per variable', () => {
  it('gives a row as many grid tracks as it has cells', () => {
    // Found by looking at the built app while checking #95: the row declared
    // six tracks for seven cells, so the remove button wrapped onto a second
    // line under the checkbox and every row was twice as tall as the header
    // implied. Counting tracks — rather than pinning the exact widths — keeps
    // this honest when a column is resized.
    render(<EnvironmentModal />)
    openEnv('Production')

    const row = screen.getAllByTestId('env-var-row')[0]
    const tracks = row.style.gridTemplateColumns.trim().split(/\s+/).length
    expect(tracks).toBe(row.children.length)
  })
})
