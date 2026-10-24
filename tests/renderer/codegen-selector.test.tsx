/**
 * Issue #280 — the Generate Code Language → Variant selector and its options
 * popover, in the modal and the right panel; GraphQL / SOAP tabs reflected,
 * WebSocket & co. say "not available".
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value, language }: { value?: string; language?: string }) =>
    React.createElement('pre', { 'data-testid': 'monaco', 'data-language': language }, value),
}))

import CodeGeneratorModal from '../../src/renderer/components/modals/CodeGeneratorModal'
import RightPanel from '../../src/renderer/components/layout/RightPanel'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { setLocale, valuesInAllLocales } from '../../src/renderer/lib/i18n'
import { ALL_VARIANTS, CODEGEN_LANGUAGES } from '../../src/shared/codegen'
import type { Tab } from '../../src/renderer/types'

const code = (): string => screen.getAllByTestId('monaco')[0].textContent ?? ''

function activeTab(protocol: Tab['protocol']): void {
  useTabsStore.setState({
    tabs: [{ id: 't1', name: 'req', protocol, isDirty: false } as Tab],
    activeTabId: 't1',
  })
}

beforeEach(() => {
  useUIStore.setState({
    showCodeGenerator: true,
    curlSnippet: { dialect: 'bash', multiLine: true },
    codegen: { language: 'curl', variantByLanguage: {}, optionsByVariant: {} },
    rightPanelTab: 'code',
    rightPanelCollapsed: false,
  })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({
    method: 'POST',
    url: 'https://api.test/users',
    params: [],
    headers: [{ id: 'h', key: 'X-Trace', value: 'abc', enabled: true }],
    body: { type: 'json', content: '{"name":"Ada","admin":true}' },
    auth: { type: 'none' },
    requestTimeout: null,
    followRedirects: true,
    sslVerification: true,
  })
})
afterEach(() => {
  cleanup()
  setLocale('en')
  useUIStore.setState({ showCodeGenerator: false, locale: 'en' })
})

describe('Generate Code modal — Language → Variant (issue #280)', () => {
  it('lists every language; cURL keeps its shell row', () => {
    render(<CodeGeneratorModal />)
    for (const l of CODEGEN_LANGUAGES)
      expect(screen.getByTestId(`codegen-language-${l.id}`)).toBeTruthy()
    expect(screen.getByTestId('codegen-language-curl')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('codegen-curl-variant')).toBeTruthy()
  })

  it('switches language and variant; the variant is remembered per language', () => {
    render(<CodeGeneratorModal />)
    fireEvent.click(screen.getByTestId('codegen-language-python'))
    expect(screen.getByTestId('codegen-variant-python-requests')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(code()).toContain('requests.post(')
    expect(code()).toContain('"admin":True')
    fireEvent.click(screen.getByTestId('codegen-variant-python-http-client'))
    expect(code()).toContain('import http.client')
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'python')

    fireEvent.click(screen.getByTestId('codegen-language-javascript'))
    expect(code()).toContain("fetch('https://api.test/users'")
    fireEvent.click(screen.getByTestId('codegen-language-python'))
    expect(code()).toContain('import http.client')
    expect(useUIStore.getState().codegen.variantByLanguage.python).toBe('python-http-client')
  })

  it('options popover: renders the schema, changes the snippet, resets', () => {
    render(<CodeGeneratorModal />)
    fireEvent.click(screen.getByTestId('codegen-language-javascript'))
    fireEvent.click(screen.getByTestId('codegen-options'))
    const panel = screen.getByTestId('codegen-options-panel')
    expect(within(panel).getByText('Use async/await')).toBeTruthy()
    fireEvent.click(within(panel).getByTestId('codegen-option-followRedirect'))
    expect(code()).toContain("redirect: 'manual'")
    expect(screen.getByTestId('codegen-options')).toHaveAttribute('data-customised', 'true')
    fireEvent.change(within(panel).getByTestId('codegen-option-indentType'), {
      target: { value: 'tab' },
    })
    expect(code()).toContain("\tmethod: 'POST'")
    fireEvent.click(within(panel).getByTestId('codegen-options-reset'))
    expect(code()).not.toContain("redirect: 'manual'")
    expect(code()).toContain("  method: 'POST'")
  })

  it('Escape closes the popover, not the dialog', () => {
    render(<CodeGeneratorModal />)
    fireEvent.click(screen.getByTestId('codegen-options'))
    expect(screen.getByTestId('codegen-options-panel')).toBeTruthy()
    fireEvent.keyDown(screen.getByTestId('codegen-options-panel'), { key: 'Escape' })
    expect(screen.queryByTestId('codegen-options-panel')).toBeNull()
    expect(useUIStore.getState().showCodeGenerator).toBe(true)
  })

  it('cURL options leave Multi-line inline and offer long format', () => {
    render(<CodeGeneratorModal />)
    fireEvent.click(screen.getByTestId('codegen-options'))
    const panel = screen.getByTestId('codegen-options-panel')
    expect(within(panel).queryByTestId('codegen-option-multiLine')).toBeNull()
    fireEvent.click(within(panel).getByTestId('codegen-option-longFormat'))
    expect(code()).toContain("curl --request POST 'https://api.test/users'")
    expect(code()).toContain("--header 'X-Trace: abc'")
    // The options belong to cURL, not to one shell: switching to PowerShell keeps them.
    fireEvent.click(screen.getByTestId('codegen-curl-dialect-powershell'))
    expect(code()).toContain("curl.exe --request POST 'https://api.test/users'")
  })

  it('Turkish labels', () => {
    setLocale('tr')
    useUIStore.setState({ locale: 'tr' })
    render(<CodeGeneratorModal />)
    fireEvent.click(screen.getByTestId('codegen-language-python'))
    expect(screen.getByRole('group', { name: 'Varyant' })).toBeTruthy()
    expect(screen.getByTestId('codegen-options').textContent).toContain('Seçenekler')
    fireEvent.click(screen.getByTestId('codegen-options'))
    expect(screen.getByText('Yönlendirmeleri izle')).toBeTruthy()
  })
})

describe('protocols', () => {
  it('a GraphQL tab generates the POST with the {query, variables} JSON body', () => {
    activeTab('graphql')
    useGraphQLStore.setState({
      url: 'https://api.test/graphql',
      query: 'query { me { id } }',
      variables: '{"a":1}',
      headers: [{ id: 'g', key: 'X-G', value: '1', enabled: true }],
    })
    render(<CodeGeneratorModal />)
    expect(code()).toContain("curl -X POST 'https://api.test/graphql'")
    expect(code()).toContain("-H 'Content-Type: application/json'")
    expect(code()).toContain(`-d '{"query":"query { me { id } }","variables":{"a":1}}'`)
  })

  it('a SOAP tab generates the POST with the envelope and SOAPAction', () => {
    activeTab('soap')
    useSoapStore.setState({
      mode: 'manual',
      endpointUrl: 'https://soap.test/svc',
      manualSoapAction: 'urn:Echo',
      manualSoapVersion: 'soap11',
      rawXml: '<soap:Envelope/>',
      parsedWsdl: null,
    })
    render(<CodeGeneratorModal />)
    expect(code()).toContain("curl -X POST 'https://soap.test/svc'")
    expect(code()).toContain(`-H 'SOAPAction: "urn:Echo"'`)
    expect(code()).toContain("-H 'Content-Type: text/xml; charset=utf-8'")
    expect(code()).toContain("-d '<soap:Envelope/>'")
  })

  it.each(['websocket', 'socketio', 'mcp', 'grpc'] as const)('%s: "not available" state', (p) => {
    activeTab(p)
    render(<CodeGeneratorModal />)
    const empty = screen.getByTestId('codegen-unavailable')
    expect(empty).toHaveAttribute('data-protocol', p)
    expect(empty.textContent).toMatch(/not available/)
    expect(screen.queryByTestId('monaco')).toBeNull()
    expect(screen.getByTestId('code-generator-copy')).toBeDisabled()
  })

  it('a WebSocket tab is named; a tool tab is "this tab" (never a raw id)', () => {
    activeTab('websocket')
    const { unmount } = render(<CodeGeneratorModal />)
    expect(screen.getByTestId('codegen-unavailable').textContent).toContain('WebSocket')
    unmount()
    activeTab('tools.jwt')
    render(<CodeGeneratorModal />)
    const text = screen.getByTestId('codegen-unavailable').textContent ?? ''
    expect(text).toContain('not available for this tab')
    expect(text).not.toContain('tools.jwt')
  })
})

describe('right panel', () => {
  it('shares the selection with the modal (language select + variant row)', () => {
    useUIStore.setState({
      codegen: {
        language: 'shell',
        variantByLanguage: { shell: 'shell-httpie' },
        optionsByVariant: {},
      },
    })
    render(<RightPanel />)
    expect(screen.getByTestId('codegen-language-select')).toHaveValue('shell')
    expect(screen.getByTestId('codegen-variant-shell-httpie')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(code()).toContain('http --follow')
    fireEvent.change(screen.getByTestId('codegen-language-select'), { target: { value: 'go' } })
    expect(useUIStore.getState().codegen.language).toBe('go')
    expect(code()).toContain('package main')
  })
})

describe('i18n', () => {
  it('every option label (and choice) exists in EN and TR', () => {
    const keys = new Set<string>()
    for (const v of ALL_VARIANTS) {
      for (const o of v.options) {
        keys.add(o.labelKey)
        for (const c of o.choices ?? []) keys.add(c.labelKey)
      }
    }
    for (const k of keys) {
      const [en, tr] = valuesInAllLocales(k)
      expect(en, k).toBeTruthy()
      expect(tr, k).toBeTruthy()
    }
  })
})
