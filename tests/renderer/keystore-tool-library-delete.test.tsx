/**
 * KeystoreTool — saved-keystore Library delete confirmation (FIX 3).
 *
 * The ✕ on a Library row used to call deleteFromLibrary(id) directly, permanently
 * dropping the encrypted SQLite blob with no confirmation. It is now gated behind
 * the same danger ConfirmDialog as the alias-row delete: clicking ✕ opens a
 * confirm, and deleteFromLibrary fires ONLY after the user confirms.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useKeystoreStore } from '../../src/renderer/stores/keystore.store'
import KeystoreTool from '../../src/renderer/components/tools/KeystoreTool'

// Vitest's esbuild transform uses the classic JSX runtime → React must be global.
;(globalThis as unknown as { React: typeof React }).React = React

const LIB = {
  id: 'lib-1',
  name: 'Prod Keystore',
  type: 'PKCS12' as const,
  alias_count: 2,
  size_bytes: 2048,
  created_at: 1,
  updated_at: 1,
  remembered: false,
}

const libraryDelete = vi.fn(async () => ({ success: true, data: { deleted: true } }))
const libraryList = vi.fn(async () => ({ success: true, data: [LIB] }))

function installBridge(): void {
  const stub = {
    pickFile: vi.fn(async () => ({ success: false, error: 'Cancelled' })),
    open: vi.fn(),
    createNew: vi.fn(),
    libraryList,
    libraryDelete,
    libraryOpen: vi.fn(),
    librarySave: vi.fn(),
  }
  ;(globalThis as unknown as { window: { api: { keystore: typeof stub } } }).window = {
    api: { keystore: stub },
  }
}

beforeEach(() => {
  libraryDelete.mockClear()
  libraryList.mockClear()
  installBridge()
  useKeystoreStore.setState({
    sessionId: null,
    meta: null,
    fileName: null,
    libraryId: null,
    library: [],
    selectedAlias: null,
    aliasDetail: null,
    dirty: false,
    loading: false,
    error: null,
    pendingEntryPasswordOpen: null,
  })
})

afterEach(() => {
  cleanup()
})

describe('KeystoreTool — library delete confirmation (FIX 3)', () => {
  it('clicking ✕ opens a confirm and does NOT delete until confirmed', async () => {
    render(<KeystoreTool />)

    // The library row loads (loadLibrary runs on mount via the stub).
    await screen.findByText('Prod Keystore')

    // Click the ✕ — a confirm must appear; nothing deleted yet.
    fireEvent.click(screen.getByRole('button', { name: '✕' }))
    await screen.findByText('Delete Saved Keystore')
    expect(libraryDelete).not.toHaveBeenCalled()

    // Confirm → deleteFromLibrary fires with the row id exactly once.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(libraryDelete).toHaveBeenCalledTimes(1)
    expect(libraryDelete).toHaveBeenCalledWith({ id: 'lib-1' })
  })

  it('cancelling the confirm leaves the saved keystore intact', async () => {
    render(<KeystoreTool />)
    await screen.findByText('Prod Keystore')

    fireEvent.click(screen.getByRole('button', { name: '✕' }))
    await screen.findByText('Delete Saved Keystore')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    // Cancel closes the confirm synchronously and never touches the store.
    expect(screen.queryByText('Delete Saved Keystore')).not.toBeInTheDocument()
    expect(libraryDelete).not.toHaveBeenCalled()
  })
})
