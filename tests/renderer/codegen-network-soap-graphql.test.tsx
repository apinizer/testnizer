/**
 * Review finding P2-6 on commit 870d28d (issue #287): Generate Code network
 * parity for SOAP and GraphQL.
 *
 * `use-codegen-source.ts` resolves SSL verification / redirects through the
 * request -> project -> app chain (`useInheritedNetwork` +
 * `resolveSslVerification` / `resolveFollowRedirects`) ONLY in `useHttpRequest`.
 * `useSoapRequest` and `useGraphqlRequest` set no `settings`, although SOAP and
 * GraphQL Send DO apply the same inherited values (`networkPayload`, see
 * `network-settings-send-287.test.ts`). With the project's SSL verification off
 * (and redirects off) the SOAP / GraphQL snippet therefore has no `-k` and
 * follows redirects, while the request Send would make skips verification and
 * does not follow.
 *
 * Expected today: the SOAP and GraphQL cases are RED; the HTTP case is the
 * control (green) proving the harness sees the project setting.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('pre', { 'data-testid': 'monaco' }, value),
}))

import CodeGeneratorModal from '../../src/renderer/components/modals/CodeGeneratorModal'
import { useCodegenSource } from '../../src/renderer/components/shared/use-codegen-source'
import { generateSnippet } from '../../src/renderer/lib/code-generator'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import type { Tab } from '../../src/renderer/types'

const PID = 'p-287-codegen'
const code = (): string => screen.getAllByTestId('monaco')[0].textContent ?? ''

function installApi(project: Record<string, unknown>, app: Record<string, unknown> = {}): void {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    settings: {
      get: vi.fn(async (key: string) => {
        if (key === `project.${PID}.settings`) return { success: true, data: project }
        return { success: true, data: app[key] }
      }),
      set: vi.fn(async () => ({ success: true, data: true })),
    },
    folder: { list: vi.fn(async () => ({ success: true, data: [] })) },
  }
}

function openTab(protocol: 'http' | 'soap' | 'graphql'): void {
  useTabsStore.setState({
    tabs: [{ id: 't1', name: 'T', protocol, isDirty: false } as Tab],
    activeTabId: 't1',
  })
  // The request is NOT explicit about SSL / redirects: both inherit.
  useRequestStore.setState({
    method: 'POST',
    url: 'https://api.test/http',
    params: [],
    headers: [],
    body: { type: 'json', content: '{}' },
    auth: { type: 'none' },
    sslVerification: null,
    followRedirects: null,
  })
  useSoapStore.setState({
    mode: 'manual',
    endpointUrl: 'https://soap.test/svc',
    manualSoapAction: 'urn:Echo',
    manualSoapVersion: 'soap11',
    rawXml: '<soapenv:Envelope><soapenv:Body><Echo/></soapenv:Body></soapenv:Envelope>',
    parsedWsdl: null,
    wsSecurity: { modes: [], enabled: false } as never,
  })
  useGraphQLStore.setState({
    url: 'https://gql.test/graphql',
    query: '{ ping }',
    variables: '{}',
    headers: [],
  })
}

beforeEach(() => {
  useUIStore.setState({
    showCodeGenerator: true,
    showProjectDetailModal: false,
    showSettingsModal: false,
    curlSnippet: { dialect: 'bash', multiLine: true },
    codegen: { language: 'curl', variantByLanguage: {}, optionsByVariant: {} },
  })
  useWorkspaceStore.setState({ activeProjectId: PID } as never)
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    environments: [],
    globalVariables: [],
    activeEnvironmentId: null,
  })
})
afterEach(() => {
  cleanup()
  useUIStore.setState({ showCodeGenerator: false })
})

const INSECURE = /(^|\s)(-k|--insecure)(\s|$)/
const FOLLOW = /(^|\s)(-L|--location)(\s|$)/

describe('Generate Code — inherited SSL / redirects reach SOAP and GraphQL like HTTP', () => {
  it('CONTROL (HTTP): project SSL off + redirects off -> -k, no -L', async () => {
    installApi({ sslVerification: false, followRedirects: false })
    openTab('http')
    render(<CodeGeneratorModal />)
    await waitFor(() => expect(code()).toMatch(INSECURE))
    expect(code()).not.toMatch(FOLLOW)
  })

  it('SOAP: project SSL off -> the cURL snippet has -k (as Send skips verification)', async () => {
    installApi({ sslVerification: false, followRedirects: false })
    openTab('soap')
    render(<CodeGeneratorModal />)
    expect(code()).toContain('https://soap.test/svc')
    // Let the inherited network settle (the HTTP control needs it too).
    await new Promise((r) => setTimeout(r, 50))
    await waitFor(() => expect(code()).toMatch(INSECURE))
    expect(code()).not.toMatch(FOLLOW)
  })

  it('GraphQL: project SSL off -> the cURL snippet has -k', async () => {
    installApi({ sslVerification: false, followRedirects: false })
    openTab('graphql')
    render(<CodeGeneratorModal />)
    expect(code()).toContain('https://gql.test/graphql')
    await new Promise((r) => setTimeout(r, 50))
    await waitFor(() => expect(code()).toMatch(INSECURE))
    expect(code()).not.toMatch(FOLLOW)
  })

  for (const protocol of ['http', 'soap', 'graphql'] as const) {
    it(`${protocol}: the source request carries the resolved settings (SSL + redirects), app tier too`, async () => {
      // Project silent, app Settings says off for both.
      installApi({}, { sslVerification: false, followRedirects: false })
      openTab(protocol)
      const { result } = renderHook(() => useCodegenSource())
      await waitFor(() => {
        const src = result.current
        expect(src.kind).toBe('request')
        if (src.kind !== 'request') return
        expect(src.req.settings?.sslVerification).toBe(false)
        expect(src.req.settings?.followRedirects).toBe(false)
      })
      const src = result.current
      if (src.kind !== 'request') throw new Error('unreachable')
      // …and the variants that spell redirects out follow it.
      expect(generateSnippet('csharp-restsharp', src.req)).toContain('FollowRedirects = false')
      expect(generateSnippet('curl', src.req)).toMatch(INSECURE)
    })
  }

  it('SOAP: a request-level explicit "verify" beats the project "off" (no -k), like Send', async () => {
    installApi({ sslVerification: false })
    openTab('soap')
    // Send's `networkPayload(useRequestStore.getState(), net)` reads the request store.
    useRequestStore.setState({ sslVerification: true })
    render(<CodeGeneratorModal />)
    await new Promise((r) => setTimeout(r, 50))
    expect(code()).not.toMatch(INSECURE)
  })
})
