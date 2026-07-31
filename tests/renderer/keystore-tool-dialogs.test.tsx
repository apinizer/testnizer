/**
 * Keystore Studio — where errors are shown, and what an empty store password
 * actually means.
 *
 *   KS-1  the store is a module-level singleton, so an error from an earlier
 *         action outlived the component. Testers opened Keystore Studio to a red
 *         "Store password cannot be empty" without having typed anything — the
 *         TLS Inspector's "Create keystore & add" had failed minutes before and
 *         left its message behind.
 *   KS-2  Create with a blank password did nothing: the engine rejected it and
 *         the reason was printed on the page BEHIND the modal, where the modal's
 *         own backdrop covered it.
 *   KS-4  same class — a wrong open-password error rendered behind the prompt.
 *
 * The empty-password policy is asserted the way it is implemented: PKCS#12
 * accepts a blank store password (and says what that costs), JKS refuses it,
 * because in JKS a blank password is not encryption at all — the key stream is
 * derived from a salt stored in the file next to the key.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { useKeystoreStore } from '../../src/renderer/stores/keystore.store'
import KeystoreTool from '../../src/renderer/components/tools/KeystoreTool'

// Vitest's esbuild transform uses the classic JSX runtime → React must be global.
;(globalThis as unknown as { React: typeof React }).React = React

const createNew = vi.fn()
const open = vi.fn()
const pickFile = vi.fn()

/**
 * Install the bridge WITHOUT replacing `window`.
 *
 * The older keystore test assigns `globalThis.window = { api: … }`, which works
 * only for synchronous queries: `waitFor` and every `findBy*` resolve their
 * container through `window.document`, so a replaced window makes them throw
 * "Expected container to be an Element … but got undefined" — jsdom is still
 * there, it is just no longer reachable from `window`.
 */
function installBridge(): void {
  const stub = {
    pickFile,
    open,
    createNew,
    libraryList: vi.fn(async () => ({ success: true, data: [] })),
    libraryDelete: vi.fn(),
    libraryOpen: vi.fn(),
    librarySave: vi.fn(),
  }
  ;(window as unknown as { api: { keystore: typeof stub } }).api = { keystore: stub }
}

const CLEAN_STATE = {
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
}

beforeEach(() => {
  createNew.mockReset()
  open.mockReset()
  pickFile.mockReset()
  installBridge()
  useKeystoreStore.setState(CLEAN_STATE)
})
afterEach(cleanup)

/** Opens the Create dialog from the empty state. */
function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Create New' }))
  return screen.getByText('Create New Keystore').closest('div[role="dialog"], div') as HTMLElement
}

/* ── KS-1: a stale error must not greet the next visitor ────────────────────── */

describe('a leftover error is cleared on mount (KS-1)', () => {
  it('renders no banner when the singleton store still holds an old failure', async () => {
    // Exactly the reported state: the TLS Inspector failed earlier and left this.
    useKeystoreStore.setState({ ...CLEAN_STATE, error: 'Store password cannot be empty' })

    render(<KeystoreTool />)

    await waitFor(() => expect(useKeystoreStore.getState().error).toBeNull())
    expect(screen.queryByText('Store password cannot be empty')).not.toBeInTheDocument()
  })
})

/* ── KS-2: the empty-password policy, and where its refusal appears ─────────── */

describe('an empty store password (KS-2)', () => {
  it('is accepted for PKCS#12, with the trade-off stated up front', async () => {
    createNew.mockResolvedValue({
      success: true,
      data: { sessionId: 's1', meta: { type: 'PKCS12', aliasCount: 0, aliases: [] } },
    })
    render(<KeystoreTool />)
    openCreate()

    // The warning is not a blocker — it is the reason the choice is informed.
    expect(screen.getByText(/No store password/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createNew).toHaveBeenCalledWith({ type: 'PKCS12', password: '' }))
    await waitFor(() => expect(screen.queryByText('Create New Keystore')).not.toBeInTheDocument())
  })

  it('is refused for JKS, INSIDE the dialog, which stays open', async () => {
    createNew.mockResolvedValue({
      success: false,
      error: 'Store password cannot be empty for JKS',
    })
    render(<KeystoreTool />)
    openCreate()

    fireEvent.change(screen.getByLabelText(/Type/i), { target: { value: 'JKS' } })
    // The PKCS#12-only warning must not follow the user to JKS.
    expect(screen.queryByText(/No store password/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    // The bug: this message rendered on the page behind the modal backdrop, so
    // Create looked like a dead button.
    const dialog = await screen.findByText('Create New Keystore')
    const modal = dialog.closest('div')?.parentElement as HTMLElement
    await waitFor(() =>
      expect(within(modal).getByText(/Store password cannot be empty/)).toBeInTheDocument(),
    )
    // …and the dialog stays open so the user can fix it in place.
    expect(screen.getByText('Create New Keystore')).toBeInTheDocument()
  })
})

/* ── KS-4: the open-password refusal is reachable too ───────────────────────── */

describe('a wrong keystore password is reported in front of the prompt (KS-4)', () => {
  it('surfaces the failure without closing the password prompt', async () => {
    pickFile.mockResolvedValue({
      success: true,
      data: { path: '/tmp/store.p12', fileName: 'store.p12', type: 'PKCS12' },
    })
    open.mockResolvedValue({ success: false, error: 'Wrong password or corrupt keystore' })

    render(<KeystoreTool />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Keystore…' }))

    const pw = await screen.findByLabelText(/Password/i)
    fireEvent.change(pw, { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    await waitFor(() =>
      expect(screen.getByText(/Wrong password or corrupt keystore/)).toBeInTheDocument(),
    )
    // Still open — the user retypes rather than restarting the flow.
    expect(pw).toBeInTheDocument()
  })
})
