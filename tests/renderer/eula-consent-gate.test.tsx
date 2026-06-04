/// <reference types="react" />
import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

;(globalThis as unknown as { React: typeof React }).React = React

// react-markdown imports `nanoid` and other ESM modules; for a unit test of
// the gate's interaction logic we just need a passthrough renderer.
vi.mock('react-markdown', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="md">{children}</div>
  ),
}))
vi.mock('remark-gfm', () => ({
  default: () => null,
}))
// `?raw` markdown imports — Vitest doesn't process them; stub the modules so
// the bundle resolves to plain strings.
vi.mock('../../docs/legal/eula.md?raw', () => ({ default: '# EULA\n\nbody' }))
vi.mock('../../docs/legal/privacy-policy.md?raw', () => ({
  default: '# Privacy\n\nbody',
}))
// The same path appears via `../../../../docs/legal/...?raw` in the
// component, but Vitest matches by request string, not resolved path —
// register both spellings to be safe.
vi.mock('/Users/mhy/IdeaProjects/testnizer/docs/legal/eula.md?raw', () => ({
  default: '# EULA\n\nbody',
}))
vi.mock(
  '/Users/mhy/IdeaProjects/testnizer/docs/legal/privacy-policy.md?raw',
  () => ({ default: '# Privacy\n\nbody' }),
)

import EulaConsentGate from '../../src/renderer/components/eula/EulaConsentGate'
import { useEulaStore } from '../../src/renderer/stores/eula.store'

interface FakeApi {
  eula: {
    state: ReturnType<typeof vi.fn>
    accept: ReturnType<typeof vi.fn>
    decline: ReturnType<typeof vi.fn>
  }
  app: { openExternal: ReturnType<typeof vi.fn> }
}

function installApi(api: FakeApi): void {
  ;(window as unknown as { api: FakeApi }).api = api
}

beforeEach(() => {
  cleanup()
  // Reset store to fresh defaults.
  useEulaStore.setState({
    loaded: false,
    consentValid: false,
    state: { accepted: false, acceptedAt: 0, acceptedVersion: '', acceptedDocsHash: '' },
    currentDocsHash: '',
    currentVersion: '',
    loadError: null,
  })
})

describe('EulaConsentGate', () => {
  it('renders children when consent is valid', async () => {
    const api: FakeApi = {
      eula: {
        state: vi.fn().mockResolvedValue({
          success: true,
          data: {
            state: {
              accepted: true,
              acceptedAt: 1,
              acceptedVersion: '1.0.0',
              acceptedDocsHash: 'h',
            },
            currentDocsHash: 'h',
            currentVersion: '1.0.0',
            consentValid: true,
          },
        }),
        accept: vi.fn(),
        decline: vi.fn(),
      },
      app: { openExternal: vi.fn() },
    }
    installApi(api)

    render(
      <EulaConsentGate>
        <div data-testid="app-shell">workbench</div>
      </EulaConsentGate>,
    )

    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeInTheDocument())
  })

  it('blocks the app and shows the gate when consent is missing; Accept stays disabled until checkbox', async () => {
    const stateMock = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: {
          state: {
            accepted: false,
            acceptedAt: 0,
            acceptedVersion: '',
            acceptedDocsHash: '',
          },
          currentDocsHash: 'h-current',
          currentVersion: '1.0.0',
          consentValid: false,
        },
      })
      .mockResolvedValue({
        success: true,
        data: {
          state: {
            accepted: true,
            acceptedAt: 123,
            acceptedVersion: '1.0.0',
            acceptedDocsHash: 'h-current',
          },
          currentDocsHash: 'h-current',
          currentVersion: '1.0.0',
          consentValid: true,
        },
      })
    const acceptMock = vi.fn().mockResolvedValue({ success: true })

    installApi({
      eula: { state: stateMock, accept: acceptMock, decline: vi.fn() },
      app: { openExternal: vi.fn() },
    })

    render(
      <EulaConsentGate>
        <div data-testid="app-shell">workbench</div>
      </EulaConsentGate>,
    )

    // Children must NOT be rendered while consent is missing.
    await waitFor(() => {
      expect(screen.getByText('Accept and Continue')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()

    const accept = screen.getByText('Accept and Continue').closest('button')!
    expect(accept).toBeDisabled()

    // Tick checkbox → button enables.
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(accept).not.toBeDisabled()

    // Click accept → IPC fires + state refreshes + children render.
    fireEvent.click(accept)
    await waitFor(() => expect(acceptMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeInTheDocument())
  })

  it('decline opens a confirm dialog and only quits after user confirms', async () => {
    const declineMock = vi.fn().mockResolvedValue({ success: true })
    installApi({
      eula: {
        state: vi.fn().mockResolvedValue({
          success: true,
          data: {
            state: {
              accepted: false,
              acceptedAt: 0,
              acceptedVersion: '',
              acceptedDocsHash: '',
            },
            currentDocsHash: 'h',
            currentVersion: '1.0.0',
            consentValid: false,
          },
        }),
        accept: vi.fn(),
        decline: declineMock,
      },
      app: { openExternal: vi.fn() },
    })

    render(
      <EulaConsentGate>
        <div>app</div>
      </EulaConsentGate>,
    )

    await waitFor(() => screen.getByText('Decline and Quit'))

    // First click — opens the confirm dialog without quitting.
    fireEvent.click(screen.getByText('Decline and Quit'))
    expect(declineMock).not.toHaveBeenCalled()
    expect(screen.getByText('Quit Testnizer')).toBeInTheDocument()

    // Confirm → decline IPC fires.
    fireEvent.click(screen.getByText('Quit Testnizer'))
    await waitFor(() => expect(declineMock).toHaveBeenCalled())
  })
})
