/**
 * Issue #287 — the UI shows the tri-state honestly (decision 4 + the request
 * Settings tab contract).
 *
 *  - Request Settings tab: the SSL / redirects switch shows the EFFECTIVE value
 *    (what Send and Run use). An untouched request says where it comes from
 *    ("Inherited from project settings: off"); flipping the switch makes it the
 *    request's own and offers "Use project settings (off)" to go back.
 *  - Project settings (ProjectDetailModal): `sslVerification` / `followRedirects`
 *    are no longer in DEFAULT_SETTINGS. A Save that did not touch them writes
 *    neither key — the old default `true` was frozen into the project on the
 *    first Save and made the app Settings value dead — and the toggles show
 *    the app value they inherit.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import SettingsTab from '../../src/renderer/components/request/SettingsTab'
import ProjectDetailModal from '../../src/renderer/components/modals/ProjectDetailModal'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

const PID = 'p-287'

function installApi(project: Record<string, unknown>, appSsl?: boolean) {
  const set = vi.fn(async () => ({ success: true, data: true }))
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    settings: {
      get: vi.fn(async (key: string) => {
        if (key === `project.${PID}.settings`) return { success: true, data: project }
        if (key === 'sslVerification') return { success: true, data: appSsl }
        return { success: true, data: undefined }
      }),
      set,
      getAll: vi.fn(async () => ({ success: true, data: {} })),
      setAll: vi.fn(),
    },
    certificate: { list: vi.fn(async () => ({ success: true, data: [] })) },
    folder: { list: vi.fn(async () => ({ success: true, data: [] })) },
  }
  return { set }
}

beforeEach(() => {
  useUIStore.setState({ showSettingsModal: false, showProjectDetailModal: false })
  useWorkspaceStore.setState({ activeProjectId: PID } as never)
  useRequestStore.setState({ sslVerification: null, followRedirects: null })
})
afterEach(cleanup)

describe('request Settings tab — inheritable SSL verification', () => {
  it('an untouched request shows the inherited project value and where it comes from', async () => {
    installApi({ sslVerification: false })
    render(<SettingsTab />)
    const box = screen.getByTestId('settings-ssl-verify') as HTMLInputElement
    await waitFor(() => expect(box.checked).toBe(false))
    const source = screen.getByTestId('settings-ssl-verify-source')
    expect(source).toHaveAttribute('data-inherited', 'true')
    expect(source.textContent).toMatch(/project settings: off/i)
    expect(screen.queryByTestId('settings-ssl-verify-inherit')).toBeNull()
  })

  it('flipping makes it the request’s own; "Use project settings" goes back to inherit', async () => {
    installApi({ sslVerification: false })
    render(<SettingsTab />)
    const box = screen.getByTestId('settings-ssl-verify') as HTMLInputElement
    await waitFor(() => expect(box.checked).toBe(false))

    fireEvent.click(box)
    expect(useRequestStore.getState().sslVerification).toBe(true)
    expect(box.checked).toBe(true)
    expect(screen.getByTestId('settings-ssl-verify-source')).toHaveAttribute(
      'data-inherited',
      'false',
    )
    const back = screen.getByTestId('settings-ssl-verify-inherit')
    expect(back.textContent).toMatch(/project settings \(off\)/i)

    fireEvent.click(back)
    expect(useRequestStore.getState().sslVerification).toBeNull()
    expect(box.checked).toBe(false)
  })

  it('no project key: the app Settings value is shown as the source', async () => {
    installApi({}, false)
    render(<SettingsTab />)
    await waitFor(() =>
      expect(screen.getByTestId('settings-ssl-verify-source').textContent).toMatch(
        /app Settings: off/i,
      ),
    )
    expect((screen.getByTestId('settings-ssl-verify') as HTMLInputElement).checked).toBe(false)
  })

  it('follow redirects behaves the same way (project off -> unchecked, inherited)', async () => {
    installApi({ followRedirects: false })
    render(<SettingsTab />)
    const box = screen.getByTestId('settings-follow-redirects') as HTMLInputElement
    await waitFor(() => expect(box.checked).toBe(false))
    expect(screen.getByTestId('settings-follow-redirects-source')).toHaveAttribute(
      'data-inherited',
      'true',
    )
  })
})

describe('ProjectDetailModal — project SSL / redirects stay unset until changed', () => {
  const PROJECT = {
    id: PID,
    workspace_id: 'w1',
    name: 'orders-api',
    display_name: 'Orders API',
    type: 'http' as const,
    save_mode: 'local' as const,
    sort_order: 0,
    created_at: 1,
    updated_at: 1,
  }

  function open(project: Record<string, unknown>, appSsl?: boolean) {
    const api = installApi(project, appSsl)
    useWorkspaceStore.setState({
      projects: [PROJECT],
      activeProjectId: PID,
      updateProject: vi.fn(async () => true),
      renameProject: vi.fn(async () => true),
    } as never)
    useUIStore.setState({ showProjectDetailModal: true })
    render(<ProjectDetailModal />)
    return api
  }

  const savedSettings = (set: ReturnType<typeof vi.fn>): Record<string, unknown> => {
    const call = set.mock.calls.find((c) => c[0] === `project.${PID}.settings`)
    expect(call).toBeTruthy()
    return call![1] as Record<string, unknown>
  }

  it('a Save that did not touch them writes neither key (the app value stays live)', async () => {
    const { set } = open({})
    fireEvent.click(await screen.findByRole('button', { name: /Save Changes/i }))
    await waitFor(() => expect(set).toHaveBeenCalled())
    const value = savedSettings(set)
    expect(value).not.toHaveProperty('sslVerification')
    expect(value).not.toHaveProperty('followRedirects')
  })

  it('Certificates pane: unset shows the inherited app value; toggling writes the project value', async () => {
    const { set } = open({}, false)
    fireEvent.click(await screen.findByTestId('project-detail-tab-certificates'))
    const box = (await screen.findByRole('checkbox', {
      name: /SSL certificate verification/i,
    })) as HTMLInputElement
    await waitFor(() => expect(box.checked).toBe(false))
    expect(screen.getByText(/follows the app Settings \(off\)/i)).toBeInTheDocument()

    fireEvent.click(box)
    expect(box.checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }))
    await waitFor(() => expect(set).toHaveBeenCalled())
    expect(savedSettings(set)).toMatchObject({ sslVerification: true })
  })

  it('a stored project value is shown as is', async () => {
    open({ sslVerification: false }, true)
    fireEvent.click(await screen.findByTestId('project-detail-tab-certificates'))
    const box = (await screen.findByRole('checkbox', {
      name: /SSL certificate verification/i,
    })) as HTMLInputElement
    await waitFor(() => expect(box.checked).toBe(false))
    expect(screen.queryByText(/follows the app Settings/i)).toBeNull()
  })
})
