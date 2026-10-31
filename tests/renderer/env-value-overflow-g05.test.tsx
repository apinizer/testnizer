/**
 * 1.6.0 screen review G-05 (issue #257) — Environments dialog value columns.
 *
 * A long secret's mask ended on a half-cut dot, and long plain values
 * (baseUrl, orderRef) were cut mid-glyph with no sign they continue. The value
 * inputs now end with an ellipsis when unfocused (Chromium clips at a whole
 * glyph and adds "…" — the value itself is untouched, so typing / e2e `fill`
 * work as before), and a plain value carries its full text as a tooltip.
 * A secret row NEVER puts its value in `title` (it keeps the "stays on this
 * computer" note).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import EnvironmentModal from '../../src/renderer/components/modals/EnvironmentModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { Environment, EnvironmentVariable } from '../../src/renderer/types'

const LONG = 'https://api.staging.example.com/v2/orders/very/long/path/that/does/not/fit'

function v(over: Partial<EnvironmentVariable>): EnvironmentVariable {
  return {
    id: 'v1',
    key: 'baseUrl',
    value: '',
    initialValue: LONG,
    enabled: true,
    secret: false,
    ...over,
  } as EnvironmentVariable
}

function mountModal(variables: EnvironmentVariable[]): void {
  const env: Environment = {
    id: 'e-1',
    workspace_id: 'ws-1',
    name: 'Production',
    is_active: true,
    variables,
    created_at: 0,
    updated_at: 0,
  }
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useUIStore.setState({ showEnvironmentModal: true })
  useEnvironmentStore.setState({
    environments: [env],
    activeEnvironmentId: 'e-1',
    globalVariables: [],
  })
  render(<EnvironmentModal />)
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /Production/ }))
  })
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    secureStorage: { status: async () => ({ success: true, data: { encrypted: true } }) },
  }
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.scrollIntoView = () => {}
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  useUIStore.setState({ locale: 'en' })
  setLocale('en')
})
afterEach(() => cleanup())

describe('Environments dialog: long values (G-05)', () => {
  it('value inputs end with an ellipsis instead of a cut glyph', () => {
    mountModal([v({}), v({ id: 'v2', key: 'token', secret: true, value: 'x'.repeat(80) })])
    for (const input of [
      ...screen.getAllByTestId('env-var-initial'),
      ...screen.getAllByTestId('env-var-current'),
    ]) {
      expect(input.className).toMatch(/\btext-ellipsis\b/)
    }
  })

  it('a long plain value shows its full text as a tooltip', () => {
    mountModal([v({ value: `${LONG}/current` })])
    expect(screen.getByTestId('env-var-initial')).toHaveAttribute('title', LONG)
    expect(screen.getByTestId('env-var-current')).toHaveAttribute('title', `${LONG}/current`)
  })

  it('an empty Current value tooltips the Initial value it falls back to', () => {
    mountModal([v({ value: '' })])
    expect(screen.getByTestId('env-var-current')).toHaveAttribute('title', LONG)
  })

  it('a secret row never puts its value in the tooltip', () => {
    mountModal([v({ secret: true, value: 'cur-secret-value', initialValue: 'init-secret-value' })])
    for (const id of ['env-var-initial', 'env-var-current']) {
      const title = screen.getByTestId(id).getAttribute('title') ?? ''
      expect(title, id).not.toContain('secret-value')
    }
  })
})
