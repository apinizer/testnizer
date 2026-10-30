/**
 * Issue #257 (item: secret value mask) — the mask of a secret variable
 * (a) used `var(--json-string)` (orange, reads like an error), (b) was clipped
 * at the column edge, (c) the row never said what "secret" means.
 *
 * CONTRACT:
 *  EnvironmentModal (Environments + Globals share `VarRowView`):
 *   - for a secret row, `env-var-initial` and `env-var-current` use
 *     `color: var(--text)` (NOT --json-string / --red / --orange), whether the
 *     value is masked or revealed. Non-secret rows are untouched.
 *   - both inputs carry the `min-w-0` class and the grid tracks that hold them
 *     are `minmax(0, 1fr)`-style (header and row keep IDENTICAL lists with 7
 *     tokens — env-var-row-columns.test.tsx stays green) so the dots are not
 *     clipped by a grid track that cannot shrink.
 *   - every secret input carries `title` = t('env.secretStaysLocal') (existing
 *     key: "Secret values stay on this computer. They are not written to the
 *     project file or git." / TR counterpart) — no new wording.
 *   - the table shows ONE visible, always-on line with the same text,
 *     `data-testid="env-secret-note"`, when at least one row is secret (absent
 *     otherwise). Not only a tooltip: tooltips were the status quo.
 *  RunnerVariables (the right-panel Variables list):
 *   - the masked cell has `data-testid="runner-var-secret"`, `title` =
 *     t('env.secretStaysLocal'), and its colour is not orange/red
 *     (no `--json-string`, `--red`, `--orange`).
 *
 * Red now: orange colour, no min-w-0, no note, no title on the inputs or on
 * the panel cell. Guard tests are marked.
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
import RunnerVariables from '../../src/renderer/components/runner/RunnerVariables'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { Environment, EnvironmentVariable } from '../../src/renderer/types'

const EN = 'Secret values stay on this computer. They are not written to the project file or git.'
const ALARM = /json-string|--red|--orange/

function lang(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

function v(over: Partial<EnvironmentVariable>): EnvironmentVariable {
  return {
    id: 'v1',
    key: 'API_KEY',
    value: 'cur-secret',
    initialValue: 'init-secret',
    enabled: true,
    secret: true,
    ...over,
  } as EnvironmentVariable
}

function env(variables: EnvironmentVariable[]): Environment {
  return {
    id: 'e-1',
    workspace_id: 'ws-1',
    name: 'Production',
    is_active: true,
    variables,
    created_at: 0,
    updated_at: 0,
  }
}

function mountModal(variables: EnvironmentVariable[]): void {
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useUIStore.setState({ showEnvironmentModal: true })
  useEnvironmentStore.setState({
    environments: [env(variables)],
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
  lang('en')
})
afterEach(() => cleanup())

describe('EnvironmentModal: secret row', () => {
  it('masked values are NOT orange/red', () => {
    mountModal([v({})])
    for (const id of ['env-var-initial', 'env-var-current']) {
      const input = screen.getByTestId(id)
      expect(input).toHaveAttribute('type', 'password')
      expect(input.style.color, id).not.toMatch(ALARM)
      expect(input.style.color, id).toBe('var(--text)')
    }
  })

  it('revealed values use the same neutral colour', () => {
    mountModal([v({})])
    fireEvent.click(screen.getByRole('button', { name: /show value/i }))
    expect(screen.getByTestId('env-var-current')).toHaveAttribute('type', 'text')
    expect(screen.getByTestId('env-var-current').style.color).toBe('var(--text)')
  })

  it('guard: a NON-secret row keeps its value colour (only secrets changed)', () => {
    mountModal([v({ secret: false })])
    expect(screen.getByTestId('env-var-current').style.color).toBe('var(--json-string)')
  })

  it('inputs can shrink inside the grid so the dots are not clipped', () => {
    mountModal([v({})])
    for (const id of ['env-var-initial', 'env-var-current']) {
      expect(screen.getByTestId(id).className, id).toMatch(/\bmin-w-0\b/)
    }
  })

  it('the secret inputs carry the "stays on this computer" tooltip', () => {
    mountModal([v({})])
    expect(screen.getByTestId('env-var-initial')).toHaveAttribute('title', EN)
    expect(screen.getByTestId('env-var-current')).toHaveAttribute('title', EN)
  })

  it('a visible note explains secret once the table has one (and only then)', () => {
    mountModal([v({})])
    expect(screen.getByTestId('env-secret-note')).toHaveTextContent(EN)
    cleanup()
    mountModal([v({ secret: false })])
    expect(screen.queryByTestId('env-secret-note')).toBeNull()
  })

  it('the note is translated', () => {
    lang('tr')
    mountModal([v({})])
    expect(screen.getByTestId('env-secret-note').textContent).toMatch(/bu bilgisayarda/i)
  })
})

describe('RunnerVariables: secret cell', () => {
  it('explains itself and is not orange/red', () => {
    useEnvironmentStore.setState({
      environments: [env([v({})])],
      activeEnvironmentId: 'e-1',
      globalVariables: [],
    })
    render(<RunnerVariables fillParent />)
    const cell = screen.getByTestId('runner-var-secret')
    expect(cell).toHaveTextContent('••••')
    expect(cell).toHaveAttribute('title', EN)
    const style = `${cell.getAttribute('style') ?? ''} ${cell.className}`
    expect(style).not.toMatch(ALARM)
  })
})
