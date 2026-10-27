/**
 * Issue #281 — "Move to Globals" on an environment (Environments modal).
 *
 * Collection variables now import into the project variables (Globals); the
 * "<collection> (imported)" environments older builds created are not
 * migrated automatically. Every environment offers the move: main copies the
 * variables into Globals (a key Globals already has keeps its value — the
 * conflict is named), the Globals list is refreshed, and the environment is
 * deleted ONLY after the user confirms.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

import { mockWindowApi } from './screens/_mount'
import EnvironmentModal from '../../src/renderer/components/modals/EnvironmentModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { Environment } from '../../src/renderer/types'

const ENV: Environment = {
  id: 'e-imported',
  workspace_id: 'ws-1',
  name: 'Shop API (imported)',
  is_active: true,
  variables: [
    { id: 'v1', key: 'baseUrl', value: 'https://shop.test', initialValue: '', enabled: true, secret: false },
    { id: 'v2', key: 'token', value: 'env-token', initialValue: '', enabled: true, secret: true },
  ],
  created_at: 0,
  updated_at: 0,
}

let moveToProjectVariables: ReturnType<typeof vi.fn>
let envDelete: ReturnType<typeof vi.fn>
let listByProject: ReturnType<typeof vi.fn>

function setup(result: { moved: string[]; conflicts: string[] }): void {
  moveToProjectVariables = vi.fn(async () => ({ success: true, data: result }))
  envDelete = vi.fn(async () => ({ success: true, data: true }))
  listByProject = vi.fn(async () => ({
    success: true,
    data: result.moved.map((key, i) => ({
      id: `g${i}`,
      workspace_id: 'ws-1',
      project_id: 'proj-1',
      key,
      value: 'x',
      initial_value: 'x',
      enabled: 1,
      secret: 0,
    })),
  }))
  mockWindowApi({
    environment: { moveToProjectVariables, delete: envDelete },
    globalVariable: { listByProject },
  })
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useUIStore.setState({ showEnvironmentModal: true })
  useEnvironmentStore.setState({
    environments: [ENV],
    activeEnvironmentId: ENV.id,
    globalVariables: [],
    currentProjectId: 'proj-1',
  })
}

beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(cleanup)

function openEnvAndMove(): void {
  render(<EnvironmentModal />)
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /Shop API \(imported\)/ }))
  })
  act(() => {
    fireEvent.click(screen.getByTestId('env-move-to-project-vars'))
  })
}

describe('Move to Globals (issue #281)', () => {
  it('moves the variables, refreshes Globals, and deletes the environment only on confirm', async () => {
    setup({ moved: ['baseUrl', 'token'], conflicts: [] })
    openEnvAndMove()

    await waitFor(() => expect(screen.getByTestId('delete-confirm-btn')).toBeTruthy())
    expect(moveToProjectVariables).toHaveBeenCalledWith('e-imported')
    expect(listByProject).toHaveBeenCalledWith('proj-1')
    expect(useEnvironmentStore.getState().globalVariables.map((g) => g.key)).toEqual([
      'baseUrl',
      'token',
    ])
    // Not deleted yet: the user has not confirmed.
    expect(envDelete).not.toHaveBeenCalled()
    expect(screen.getByText(/The variables are now in Globals\. Delete this environment\?/)).toBeTruthy()

    act(() => {
      fireEvent.click(screen.getByTestId('delete-confirm-btn'))
    })
    await waitFor(() => expect(envDelete).toHaveBeenCalledWith('e-imported'))
  })

  it('cancelling keeps the environment', async () => {
    setup({ moved: ['baseUrl'], conflicts: [] })
    openEnvAndMove()
    await waitFor(() => expect(screen.getByTestId('delete-cancel-btn')).toBeTruthy())
    act(() => {
      fireEvent.click(screen.getByTestId('delete-cancel-btn'))
    })
    expect(envDelete).not.toHaveBeenCalled()
    expect(useEnvironmentStore.getState().environments).toHaveLength(1)
  })

  it('names the conflicting variables whose value only the environment still holds', async () => {
    setup({ moved: ['baseUrl'], conflicts: ['token'] })
    openEnvAndMove()
    await waitFor(() => expect(screen.getByTestId('delete-confirm-btn')).toBeTruthy())
    expect(
      screen.getByText(/except token: Globals kept its own value, so the value in this environment is lost/),
    ).toBeTruthy()
  })

  it('a failed move says so and asks nothing', async () => {
    setup({ moved: [], conflicts: [] })
    moveToProjectVariables.mockResolvedValueOnce({ success: false, error: 'boom' })
    openEnvAndMove()
    await waitFor(() => expect(moveToProjectVariables).toHaveBeenCalled())
    expect(screen.queryByTestId('delete-confirm-btn')).toBeNull()
    expect(envDelete).not.toHaveBeenCalled()
  })
})
