/**
 * Issue #196 — the Console's per-session "Show secrets" toggle. Main masks
 * every entry and holds the flag (tests/main/handlers/history-secret-masking);
 * the renderer only mirrors it: off by default, reflects what main answered,
 * re-reads main's flag on mount, and is never written to browser storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import ConsoleSecretsToggle from '../../src/renderer/components/response/ConsoleSecretsToggle'
import { useConsoleStore } from '../../src/renderer/stores/console.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

let mainFlag = false
let setShowSecrets: ReturnType<typeof vi.fn>

beforeEach(() => {
  mainFlag = false
  setShowSecrets = vi.fn(async (on: boolean) => {
    mainFlag = on
    return { success: true, data: mainFlag }
  })
  ;(window as unknown as { api: unknown }).api = {
    console: {
      onLog: () => () => undefined,
      setShowSecrets,
      getShowSecrets: vi.fn(async () => ({ success: true, data: mainFlag })),
    },
  }
  useConsoleStore.setState({ showSecrets: false })
  localStorage.clear()
  sessionStorage.clear()
  useUIStore.setState({ locale: 'en' })
})
afterEach(() => {
  cleanup()
  useUIStore.setState({ locale: 'en' })
})

describe('Console "Show secrets" toggle (issue #196)', () => {
  it('is off by default and shows no warning', async () => {
    render(<ConsoleSecretsToggle />)
    await act(async () => {})
    const btn = screen.getByTestId('console-show-secrets')
    expect(btn.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByTestId('console-show-secrets-warning')).toBeNull()
  })

  it('turning it on asks main, then shows the warning; off again hides it', async () => {
    render(<ConsoleSecretsToggle />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('console-show-secrets'))
    })
    expect(setShowSecrets).toHaveBeenCalledWith(true)
    expect(useConsoleStore.getState().showSecrets).toBe(true)
    expect(screen.getByTestId('console-show-secrets-warning').textContent).toBe(
      'Secrets visible in new entries',
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('console-show-secrets'))
    })
    expect(setShowSecrets).toHaveBeenLastCalledWith(false)
    expect(screen.queryByTestId('console-show-secrets-warning')).toBeNull()
  })

  it('a failed main call leaves masking on', async () => {
    setShowSecrets.mockImplementationOnce(async () => ({ success: false, error: 'x' }))
    await useConsoleStore.getState().setShowSecrets(true)
    expect(useConsoleStore.getState().showSecrets).toBe(false)
  })

  it('re-reads main on mount (a renderer reload keeps main’s session flag)', async () => {
    mainFlag = true
    render(<ConsoleSecretsToggle />)
    await act(async () => {})
    expect(screen.getByTestId('console-show-secrets').getAttribute('aria-checked')).toBe('true')
  })

  it('is never written to browser storage', async () => {
    render(<ConsoleSecretsToggle />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('console-show-secrets'))
    })
    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(dump).not.toMatch(/showSecrets/i)
  })

  it('Turkish labels', async () => {
    useUIStore.setState({ locale: 'tr' })
    mainFlag = true
    render(<ConsoleSecretsToggle />)
    await act(async () => {})
    expect(screen.getByTestId('console-show-secrets').textContent).toContain(
      'Gizli değerleri göster',
    )
    expect(screen.getByTestId('console-show-secrets-warning').textContent).toBe(
      'Yeni kayıtlarda gizli değerler görünür',
    )
  })
})
