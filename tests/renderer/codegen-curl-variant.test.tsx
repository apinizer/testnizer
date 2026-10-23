/**
 * Issue #279 — the Generate Code `curl` snippet in three shells: the modal
 * and the right panel's Code pane show a variant row (bash / CMD / PowerShell
 * + Multi-line) only for cURL, share the choice through `ui.store`, and the
 * snippet follows it (`curl.exe` + backticks, `^` continuation, one line).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value, language }: { value?: string; language?: string }) =>
    React.createElement('pre', { 'data-testid': 'monaco', 'data-language': language }, value),
}))

import CodeGeneratorModal from '../../src/renderer/components/modals/CodeGeneratorModal'
import RightPanel from '../../src/renderer/components/layout/RightPanel'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { setLocale } from '../../src/renderer/lib/i18n'

const code = (): string => screen.getAllByTestId('monaco')[0].textContent ?? ''

beforeEach(() => {
  useUIStore.setState({
    showCodeGenerator: true,
    curlSnippet: { dialect: 'bash', multiLine: true },
    rightPanelTab: 'code',
  })
  useRequestStore.setState({
    method: 'POST',
    url: 'https://api.test/users',
    params: [],
    headers: [{ id: 'h', key: 'Content-Type', value: 'application/json', enabled: true }],
    body: { type: 'json', content: `{"name":"it's"}` },
    auth: { type: 'basic', basic: { username: 'u', password: 'p' } },
    sslVerification: false,
  })
})
afterEach(() => {
  cleanup()
  setLocale('en')
  useUIStore.setState({ showCodeGenerator: false, locale: 'en' })
})

describe('Generate Code modal — cURL variant (issue #279)', () => {
  it('bash multi-line is the default (byte-identical layout, -u, -k)', () => {
    render(<CodeGeneratorModal />)
    expect(screen.getByTestId('codegen-curl-dialect-bash')).toHaveAttribute('aria-pressed', 'true')
    expect(code()).toBe(
      [
        `curl -X POST 'https://api.test/users' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -u 'u:p' \\`,
        `  -d '{"name":"it'\\''s"}' \\`,
        `  -k`,
      ].join('\n'),
    )
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'shell')
  })

  it("PowerShell: curl.exe, backtick continuation, '' and \\\" quoting", () => {
    render(<CodeGeneratorModal />)
    fireEvent.click(screen.getByTestId('codegen-curl-dialect-powershell'))
    expect(code()).toBe(
      [
        "curl.exe -X POST 'https://api.test/users' `",
        "  -H 'Content-Type: application/json' `",
        "  -u 'u:p' `",
        `  -d '{\\"name\\":\\"it''s\\"}' \``,
        '  -k',
      ].join('\n'),
    )
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'powershell')
  })

  it('CMD single-line: one line, caret form for the JSON body', () => {
    render(<CodeGeneratorModal />)
    fireEvent.click(screen.getByTestId('codegen-curl-dialect-cmd'))
    fireEvent.click(screen.getByTestId('codegen-curl-multiline'))
    expect(code()).toBe(
      `curl -X POST "https://api.test/users" -H "Content-Type: application/json" -u "u:p" -d ^"{\\^"name\\^":\\^"it's\\^"}^" -k`,
    )
    expect(useUIStore.getState().curlSnippet).toEqual({ dialect: 'cmd', multiLine: false })
  })

  it('the variant row is cURL-only', () => {
    render(<CodeGeneratorModal />)
    expect(screen.getByTestId('codegen-curl-variant')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Python/ }))
    expect(screen.queryByTestId('codegen-curl-variant')).toBeNull()
  })

  it('Turkish labels', () => {
    setLocale('tr')
    useUIStore.setState({ locale: 'tr' })
    render(<CodeGeneratorModal />)
    expect(screen.getByRole('group', { name: 'Kabuk' })).toBeTruthy()
    expect(screen.getByText('Çok satırlı')).toBeTruthy()
  })
})

describe('Right panel Code pane — shares the cURL variant', () => {
  it('follows the choice made in the store', () => {
    useUIStore.setState({ curlSnippet: { dialect: 'powershell', multiLine: false } })
    render(<RightPanel />)
    expect(screen.getByTestId('codegen-curl-dialect-powershell')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(code().startsWith("curl.exe -X POST 'https://api.test/users' -H")).toBe(true)
    expect(code()).not.toContain('\n')
  })
})
