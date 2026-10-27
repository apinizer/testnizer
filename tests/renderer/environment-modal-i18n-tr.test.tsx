/**
 * issue #248 — the Environments dialog must speak Turkish in the Turkish UI.
 *
 * The 1.6.0 verification found the dialog still English in TR: "Environments",
 * "New Environment", "Add Variable", the VARIABLE / TYPE / INITIAL VALUE /
 * CURRENT VALUE headers, the default/secret options, "N variables", "Active",
 * and a half-translated "Environment İçe Aktar / Dışa Aktar". The delete
 * confirmation it opens (the shared DeleteConfirmDialog) was English too.
 *
 * This drives the real modal through every view — Globals, the active env, an
 * inactive env, the delete confirmation — and scans the visible text AND the
 * title / aria-label / placeholder attributes, because half of the leftovers
 * were tooltips and accessible names no screenshot shows.
 *
 * It also pins `lang="tr"` on the dialog: the headers use CSS `uppercase`, and
 * without a Turkish `lang` Chromium upper-cases "Değişken" to "DEĞIŞKEN".
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
import { setLocale } from '../../src/renderer/lib/i18n'
import type { Environment, EnvironmentVariable, GlobalVariable } from '../../src/renderer/types'

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

function env(id: string, name: string, variables: EnvironmentVariable[]): Environment {
  return {
    id,
    workspace_id: 'ws-1',
    name,
    is_active: false,
    variables,
    created_at: 0,
    updated_at: 0,
  }
}

function stubDom(): void {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.scrollIntoView = () => {}
}

function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

/**
 * English the issue (and a sweep of the modal) found in the Turkish UI.
 * Whole-word, case-sensitive except where noted, so seeded Turkish names and
 * values can't trip it. Seed data below avoids English words on purpose.
 */
const ENGLISH: RegExp[] = [
  /\bEnvironments?\b/i,
  /\bNew Environment\b/,
  /\bAdd Variable\b/,
  /\bVariables?\b/,
  /\bvariables?\b/,
  /\bType\b/,
  /\bInitial Value\b/i,
  /\bCurrent Value\b/i,
  /\bGlobals\b/,
  /\bActive\b/,
  /\bSet Active\b/,
  /\bdefault\b/,
  /\bsecret\b/,
  /\bSearch\b/,
  /\bClose\b/,
  /\bRemove\b/,
  /\bCopy\b/,
  /\bvariable_name\b/,
  /\bNo environments\b/,
  /\bSelect an\b/,
  /\bA global variable\b/,
  /\bShow value\b/,
  /\bHide value\b/,
  /\bAre you sure\b/,
  /\bcannot be undone\b/,
  /\bDelete\b/,
  /\bCancel\b/,
  /\bconfirmation\b/,
]

/** Visible text plus every attribute a user can meet (tooltip, screen reader, placeholder). */
function everythingShown(): string {
  const parts: string[] = [document.body.textContent ?? '']
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(attr)
      if (v) parts.push(v)
    }
  }
  return parts.join('\n')
}

function englishLeftovers(): string[] {
  const text = everythingShown()
  return ENGLISH.filter((re) => re.test(text)).map((re) => {
    const line = text.split('\n').find((l) => re.test(l)) ?? ''
    return `${re} → "${line.trim().slice(0, 100)}"`
  })
}

function click(el: Element): void {
  act(() => {
    fireEvent.click(el)
  })
}

beforeEach(() => {
  stubDom()
  mockWindowApi()
  useLocale('tr')
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useUIStore.setState({ showEnvironmentModal: true })
  useEnvironmentStore.setState({
    environments: [
      env('e-uretim', 'Üretim', [
        variable({ id: 'v1', key: 'adres', initialValue: 'https://ornek.test' }),
        variable({ id: 'v2', key: 'anahtar', value: 'gizlideger123', secret: true }),
      ]),
      env('e-hazirlik', 'Hazırlık', [variable({ id: 'v3', key: 'sure', initialValue: '30' })]),
    ],
    activeEnvironmentId: 'e-uretim',
    globalVariables: [
      { ...variable({ id: 'g1', key: 'kok', initialValue: 'deger' }), workspace_id: 'ws-1' },
    ] as GlobalVariable[],
  })
})

afterEach(() => {
  cleanup()
  useLocale('en')
})

describe('issue #248 — Environments dialog in Turkish', () => {
  it('Globals view: sidebar, headers and buttons are Turkish', () => {
    render(<EnvironmentModal />)

    expect(englishLeftovers()).toEqual([])

    expect(screen.getByTestId('env-globals-nav').textContent).toContain('Globaller')
    expect(screen.getAllByText('Ortamlar').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('env-new').textContent).toContain('Yeni Ortam')
    expect(screen.getByText('Ortam İçe Aktar')).toBeTruthy()
    // Issue #277: on the Globals view the export button exports the globals.
    expect(screen.getByTestId('env-export-globals').textContent).toContain(
      'Global Değişkenleri Dışa Aktar',
    )
    expect(screen.getByText('Değişken')).toBeTruthy()
    expect(screen.getByText('Tür')).toBeTruthy()
    expect(screen.getByText('Başlangıç Değeri')).toBeTruthy()
    expect(screen.getByText('Geçerli Değer')).toBeTruthy()
    expect(screen.getByTestId('env-var-add').textContent).toContain('Değişken Ekle')
    expect(
      screen.getByText(/^Proje değişkenleri: hangi ortam aktif olursa olsun/),
    ).toBeTruthy()
  })

  it('active environment: badge, variable count, type options, row controls', () => {
    render(<EnvironmentModal />)
    click(screen.getByRole('button', { name: /Üretim/ }))

    expect(englishLeftovers()).toEqual([])

    expect(screen.getByText('Aktif')).toBeTruthy()
    expect(screen.getByText('2 değişken')).toBeTruthy()

    const types = screen.getAllByTestId('env-var-type') as HTMLSelectElement[]
    // Labels are Turkish; values stay 'default' / 'secret' for e2e selectors.
    expect(Array.from(types[0].options).map((o) => [o.value, o.textContent])).toEqual([
      ['default', 'varsayılan'],
      ['secret', 'gizli'],
    ])
    expect(types[1].value).toBe('secret')

    expect(screen.getAllByLabelText('Kaldır')).toHaveLength(2)
    expect(screen.getByLabelText('Değeri göster')).toBeTruthy()
    expect(screen.getByTitle('{{adres}} kopyala')).toBeTruthy()
    expect(screen.getByLabelText('Ortamı sil')).toBeTruthy()
    expect(screen.getAllByPlaceholderText('değişken_adı').length).toBeGreaterThan(0)
  })

  it('inactive environment: "Aktif Yap" and singular count', () => {
    render(<EnvironmentModal />)
    click(screen.getByRole('button', { name: /Hazırlık/ }))

    expect(englishLeftovers()).toEqual([])
    expect(screen.getByTestId('env-set-active').textContent).toBe('Aktif Yap')
    // Issue #281.
    expect(screen.getByTestId('env-move-to-project-vars').textContent).toBe('Globallere taşı')
    expect(screen.getByText('1 değişken')).toBeTruthy()
  })

  it('new environment input and the delete confirmation are Turkish', () => {
    render(<EnvironmentModal />)
    click(screen.getByTestId('env-new'))
    expect(screen.getByPlaceholderText('Ortam adı')).toBeTruthy()

    click(screen.getByRole('button', { name: /Hazırlık/ }))
    click(screen.getByTestId('env-delete'))

    expect(englishLeftovers()).toEqual([])
    expect(screen.getByText('Ortam silinsin mi?')).toBeTruthy()
    expect(screen.getByText('Bu işlem geri alınamaz.')).toBeTruthy()
    expect(screen.getByTestId('delete-cancel-btn').textContent).toBe('İptal')
    expect(screen.getByTestId('delete-confirm-btn').textContent).toBe('Sil')
  })

  it('marks the dialog lang="tr" so CSS uppercase uses Turkish casing (İ, not I)', () => {
    render(<EnvironmentModal />)
    const modal = screen.getByTestId('environment-modal')
    const langRoot = modal.closest('[lang]') ?? modal.querySelector('[lang]')
    expect(langRoot?.getAttribute('lang')).toBe('tr')
  })

  it('keeps the English UI byte-identical (e2e selectors match on it)', () => {
    useLocale('en')
    render(<EnvironmentModal />)
    expect(screen.getByTestId('env-new').textContent).toContain('New Environment')
    expect(screen.getByTestId('env-var-add').textContent).toContain('Add Variable')
    expect(screen.getByText('Initial Value')).toBeTruthy()
    expect(screen.getByText('Current Value')).toBeTruthy()
    click(screen.getByTestId('env-new'))
    expect(screen.getByPlaceholderText('Environment name')).toBeTruthy()
    click(screen.getByRole('button', { name: /Üretim/ }))
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('2 variables')).toBeTruthy()
  })
})
