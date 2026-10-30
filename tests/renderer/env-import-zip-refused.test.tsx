/**
 * Issue #276 follow-up — Environments → Import Environment shares
 * `importExport.openFile`. Main now refuses a .zip there (only the Postman
 * import reads archives) instead of handing back its bytes as text; the
 * modal shows that reason instead of doing nothing.
 *
 * Fail-before: a failed `openFile` result returned silently.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))
const toastError = vi.fn()
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
    warning: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  },
}))

import { mockWindowApi } from './screens/_mount'
import EnvironmentModal from '../../src/renderer/components/modals/EnvironmentModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

const ZIP_ERROR =
  'This file is a .zip archive. Only the Postman import reads .zip files; pick the file inside the archive instead.'

let openFile: ReturnType<typeof vi.fn>

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
  toastError.mockReset()
  openFile = vi.fn(async () => ({ success: false, error: ZIP_ERROR }))
  mockWindowApi({ importExport: { openFile } })
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useUIStore.setState({ showEnvironmentModal: true })
  useEnvironmentStore.setState({ environments: [], activeEnvironmentId: null, globalVariables: [] })
})

afterEach(cleanup)

describe('Import Environment shows why a file was refused (issue #276)', () => {
  it('a .zip refused by main is reported, not ignored', async () => {
    render(<EnvironmentModal />)
    fireEvent.click(screen.getByRole('button', { name: /Import Environment/ }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(String(toastError.mock.calls[0][0])).toContain('Only the Postman import reads .zip')
  })
})
