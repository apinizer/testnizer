/**
 * Issue #177 — "values marked secret stay on this machine", single-environment
 * export. The Export Environment button wrote `value: v.value || v.initialValue`
 * for every variable, so a secret's plain value left the computer in the
 * exported .json. The file now keeps the key and `type: 'secret'` with an
 * empty value; non-secret variables export exactly as before.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

import { mockWindowApi } from './screens/_mount'
import EnvironmentModal from '../../src/renderer/components/modals/EnvironmentModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { Environment, EnvironmentVariable } from '../../src/renderer/types'

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

const ENV: Environment = {
  id: 'e-prod',
  workspace_id: 'ws-1',
  name: 'Production',
  is_active: false,
  variables: [
    variable({ id: 'v1', key: 'baseUrl', value: '', initialValue: 'https://api.example.com' }),
    variable({
      id: 'v2',
      key: 'token',
      value: 'cur-s3cr3t',
      initialValue: 'init-s3cr3t',
      secret: true,
    }),
    variable({ id: 'v3', key: 'apiKey', value: '', initialValue: 'only-initial', secret: true }),
  ],
  created_at: 0,
  updated_at: 0,
}

let saveFile: ReturnType<typeof vi.fn>

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
  saveFile = vi.fn(async () => ({ success: true }))
  mockWindowApi({ importExport: { saveFile } })
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useUIStore.setState({ showEnvironmentModal: true })
  useEnvironmentStore.setState({
    environments: [ENV],
    activeEnvironmentId: 'e-prod',
    globalVariables: [],
  })
})

afterEach(cleanup)

describe('Export Environment never writes a secret value (issue #177)', () => {
  it('exports secrets as type "secret" with an empty value; plain variables unchanged', () => {
    render(<EnvironmentModal />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Production/ }))
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Export Environment/ }))
    })

    expect(saveFile).toHaveBeenCalledTimes(1)
    const [content] = saveFile.mock.calls[0] as [string, string]
    expect(content).not.toContain('s3cr3t')
    expect(content).not.toContain('only-initial')
    const doc = JSON.parse(content) as {
      values: Array<{ key: string; value: string; type: string }>
    }
    expect(doc.values).toEqual([
      { key: 'baseUrl', value: 'https://api.example.com', enabled: true, type: 'default' },
      { key: 'token', value: '', enabled: true, type: 'secret' },
      { key: 'apiKey', value: '', enabled: true, type: 'secret' },
    ])
  })

  it('the type selector explains where secret values live', () => {
    render(<EnvironmentModal />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Production/ }))
    })
    const select = screen.getAllByTestId('env-var-type')[0]
    expect(select.getAttribute('title')).toBe(
      'Secret values stay on this computer. They are not written to the project file or git.',
    )
  })
})
