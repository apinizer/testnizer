/**
 * Generate Code modal (release 1.6.0 gap): in Turkish the title, Copy and Close
 * were still English, and the footer Close button used a hard-coded `#555`
 * text colour that was near-invisible in dark mode. Strings now come from i18n
 * (language names such as "cURL" are product names and stay) and Close is the
 * sibling modals' ghost button on tokens.
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('pre', { 'data-testid': 'monaco' }, value),
}))

import CodeGeneratorModal from '../../src/renderer/components/modals/CodeGeneratorModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale, valuesInAllLocales } from '../../src/renderer/lib/i18n'

const SRC = readFileSync(
  resolve(__dirname, '../../src/renderer/components/modals/CodeGeneratorModal.tsx'),
  'utf8',
)

function switchLocale(locale: 'en' | 'tr'): void {
  setLocale(locale)
  useUIStore.setState({ locale })
}

beforeEach(() => {
  useUIStore.setState({ showCodeGenerator: true })
})
afterEach(() => {
  cleanup()
  switchLocale('en')
  useUIStore.setState({ showCodeGenerator: false })
})

describe('Generate Code modal i18n', () => {
  it('defines its keys in EN and TR, translated', () => {
    for (const k of ['codeGen.title', 'codeGen.copy', 'codeGen.copied', 'codeGen.languages']) {
      const [en, tr] = valuesInAllLocales(k)
      expect(en, k).toBeTruthy()
      expect(tr, k).toBeTruthy()
      expect(tr, k).not.toBe(en)
    }
  })

  it('renders Turkish title, Copy and Close in TR', () => {
    switchLocale('tr')
    render(<CodeGeneratorModal />)
    expect(screen.getAllByText('Kod Oluştur').length).toBeGreaterThan(0)
    expect(screen.getByTestId('code-generator-copy').textContent).toContain('Kopyala')
    expect(screen.getByTestId('code-generator-close').textContent).toBe('Kapat')
    expect(screen.getByRole('group', { name: 'Diller' })).toBeTruthy()
    // Product names stay as-is.
    expect(screen.getByText('cURL')).toBeTruthy()
  })

  it('keeps the English wording in EN (e2e matches the heading by text)', () => {
    render(<CodeGeneratorModal />)
    expect(screen.getByRole('heading', { name: 'Generate Code' })).toBeTruthy()
    expect(screen.getByTestId('code-generator-close').textContent).toBe('Close')
  })

  it('has no hard-coded hex colour (dark-mode Close was #555)', () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
    expect(screen.queryByTestId('code-generator-close')).toBeNull()
    render(<CodeGeneratorModal />)
    expect(screen.getByTestId('code-generator-close').className).toContain('text-[var(--text)]')
  })
})
