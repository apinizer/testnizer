/**
 * Generate Code for a SOAP tab follows Send (issue #298 follow-up).
 *
 * Since issue #298, Send applies WS-Security INSIDE the envelope, in main,
 * per send (nonce, timestamp, signature) and no longer turns the
 * UsernameToken into `Authorization: Basic`. The snippet still did: it put
 * the WS-Security username / password into the language's Basic auth
 * (`curl -u user:pass`), a request Send never makes. It now emits the
 * envelope Send hands to main (before WS-Security) and shows a note that the
 * WS-Security header is added by Testnizer at send time. The SOAP tab's Auth
 * tab (Bearer, Basic, inherited…) is in the snippet, as Send now sends it.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('pre', { 'data-testid': 'monaco' }, value),
}))

import CodeGeneratorModal from '../../src/renderer/components/modals/CodeGeneratorModal'
import RightPanel from '../../src/renderer/components/layout/RightPanel'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { AuthConfig, Tab } from '../../src/renderer/types'

const code = (): string => screen.getAllByTestId('monaco')[0].textContent ?? ''

const ENVELOPE =
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body><Echo/></soapenv:Body></soapenv:Envelope>'

const WSSE_USER = 'wsse-codegen-user'
const WSSE_PW = 'wsse-codegen-PW-41b7'

function soapTab(wsSecurity: Record<string, unknown>, auth: AuthConfig = { type: 'none' }): void {
  useTabsStore.setState({
    tabs: [{ id: 't1', name: 'Echo', protocol: 'soap', isDirty: false } as Tab],
    activeTabId: 't1',
  })
  useRequestStore.setState({ auth, headers: [] })
  useSoapStore.setState({
    mode: 'manual',
    endpointUrl: 'https://soap.test/svc',
    manualSoapAction: 'urn:Echo',
    manualSoapVersion: 'soap11',
    rawXml: ENVELOPE,
    parsedWsdl: null,
    wsSecurity: { modes: [], ...wsSecurity } as never,
  })
}

const UT = {
  enabled: true,
  modes: ['username-token', 'timestamp'],
  usernameToken: {
    username: WSSE_USER,
    password: WSSE_PW,
    passwordType: 'PasswordText',
    nonce: true,
    created: true,
  },
}

beforeEach(() => {
  useUIStore.setState({
    showCodeGenerator: true,
    curlSnippet: { dialect: 'bash', multiLine: true },
    codegen: { language: 'curl', variantByLanguage: {}, optionsByVariant: {} },
    rightPanelTab: 'code',
    rightPanelCollapsed: false,
  })
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    environments: [],
    globalVariables: [],
    activeEnvironmentId: null,
  })
})
afterEach(() => {
  cleanup()
  setLocale('en')
  useUIStore.setState({ showCodeGenerator: false, locale: 'en' })
})

describe('Generate Code — SOAP WS-Security matches Send (issue #298)', () => {
  it('WS-Security on: no Basic auth from the UsernameToken, the envelope as typed, a note', () => {
    soapTab(UT)
    render(<CodeGeneratorModal />)
    const c = code()
    expect(c).toContain("curl -X POST 'https://soap.test/svc'")
    expect(c).toContain(`-d '${ENVELOPE}'`)
    expect(c).not.toContain(WSSE_USER)
    expect(c).not.toContain(WSSE_PW)
    expect(c).not.toMatch(/(^|\s)(-u|--user)\s/)
    expect(c).not.toMatch(/Authorization/i)
    expect(screen.getByTestId('codegen-wsse-note').textContent).toMatch(/WS-Security/)
  })

  it('the right panel Code pane shows the same note', () => {
    soapTab(UT)
    render(<RightPanel />)
    expect(code()).not.toContain(WSSE_PW)
    expect(screen.getByTestId('codegen-wsse-note')).toBeTruthy()
  })

  it('a legacy single-mode config is treated the same', () => {
    soapTab({ enabled: true, type: 'username-token', username: WSSE_USER, password: WSSE_PW })
    render(<CodeGeneratorModal />)
    expect(code()).not.toContain(WSSE_PW)
    expect(screen.getByTestId('codegen-wsse-note')).toBeTruthy()
  })

  it('WS-Security off: the snippet is unchanged and there is no note', () => {
    soapTab({ ...UT, enabled: false })
    render(<CodeGeneratorModal />)
    const c = code()
    expect(c).toContain("curl -X POST 'https://soap.test/svc'")
    expect(c).toContain(`-H 'SOAPAction: "urn:Echo"'`)
    expect(c).toContain(`-d '${ENVELOPE}'`)
    expect(c).not.toContain(WSSE_PW)
    expect(screen.queryByTestId('codegen-wsse-note')).toBeNull()
  })

  it("the SOAP tab's Auth tab (Bearer) is in the snippet, as Send sends it", () => {
    soapTab({ enabled: false }, { type: 'bearer', bearer: { token: 'SOAP-TOKEN' } })
    render(<CodeGeneratorModal />)
    expect(code()).toContain("-H 'Authorization: Bearer SOAP-TOKEN'")
  })

  it('Auth type WS-Security adds no HTTP auth to the snippet', () => {
    soapTab(UT, { type: 'wsse' } as AuthConfig)
    render(<CodeGeneratorModal />)
    expect(code()).not.toMatch(/Authorization/i)
    expect(code()).not.toMatch(/(^|\s)(-u|--user)\s/)
  })

  it('the Headers-tab rows are in the snippet, as Send sends them', () => {
    soapTab({ enabled: false })
    useRequestStore.setState({
      headers: [
        { id: 'h1', key: 'X-Tenant', value: 'acme', enabled: true },
        { id: 'h2', key: 'X-Off', value: 'x', enabled: false },
      ],
    })
    render(<CodeGeneratorModal />)
    expect(code()).toContain("-H 'X-Tenant: acme'")
    expect(code()).not.toContain('X-Off')
    expect(code()).toContain(`-H 'SOAPAction: "urn:Echo"'`)
  })

  it("a user's Content-Type replaces the transport one in the snippet", () => {
    soapTab({ enabled: false })
    useRequestStore.setState({
      headers: [
        { id: 'h1', key: 'Content-Type', value: 'text/xml; charset=iso-8859-9', enabled: true },
      ],
    })
    render(<CodeGeneratorModal />)
    expect(code()).toContain("-H 'Content-Type: text/xml; charset=iso-8859-9'")
    expect(code()).not.toContain('charset=utf-8')
  })
})
