/**
 * 1.6.0 screen review — HTTP mock editor.
 *
 * G-07 / G-12 (issues #258 / #261): the Turkish editor mixed English —
 * "Response'lar", "Response ekle", "HEADER'LAR", "Path modu", "AUTH OVERRIDE",
 * "Security / keystore'dan doldur", "Endpoint'ler" — and the path-mode select
 * showed the raw value "exact". TR now uses the request editor's own words
 * (Yanıt, Başlıklar, uç nokta …); the path-mode options are labelled per locale
 * while their VALUES stay `exact | param | wildcard | regex`. The OpenAPI /
 * Postman / JWKS buttons keep their label on one line.
 *
 * G-14: the Logs header read "1 entries" — plural-aware now (EN + TR).
 */
import { describe, it, expect, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import React from 'react'
import { vi } from 'vitest'
// Must come first: installs window.api.mock before mock.store captures it at import.
import {
  httpBridge,
  httpEndpoint,
  httpResponse,
  httpServer,
  resetHttpBridge,
  seedHttpBridge,
} from './mock-http-bridge-stub'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import MockServerEditor from '../../src/renderer/components/mock/MockServerEditor'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { valuesInAllLocales } from '../../src/renderer/lib/i18n'
import { useLocale } from './helpers/default-locale-shim'
import type { MockLogEntry, MockServer } from '../../src/renderer/types'

async function mount(server: MockServer, withEndpoint = true): Promise<void> {
  resetHttpBridge([server])
  seedHttpBridge(withEndpoint ? { endpoints: [httpEndpoint()], responses: [httpResponse()] } : {})
  useMockStore.setState({
    servers: [server],
    endpointsByServer: {},
    responsesByEndpoint: {},
    statusByServer: {},
    errorByServer: {},
    logsByServer: {},
  })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  render(React.createElement(MockServerEditor, { serverId: server.id }))
  if (withEndpoint) {
    await screen.findByTestId('mock-endpoint-path')
    await screen.findByTestId('mock-response-body-type')
  }
}

afterEach(() => {
  cleanup()
  useLocale('en')
  httpBridge.logs.get.mockImplementation(() =>
    Promise.resolve({ success: true as const, data: [] }),
  )
})

/** English loan words the TR mock editor used to show. */
const MIXED = [
  /Response'lar/i,
  /Response ekle/i,
  /Header'lar/i,
  /Path modu/i,
  /Auth Override/i,
  /keystore'dan doldur/i,
  /Endpoint'ler/i,
  /\bendpoint\b/i,
  // `response.{status,…}` in the script hint is the sandbox API, not prose.
  /\bresponse\b(?!\.)/i,
]

describe('TR mock editor speaks one language (G-07 / G-12)', () => {
  it('the endpoints screen has no English loan words', async () => {
    useLocale('tr')
    await mount(httpServer())
    // The "Insert example…" pickers list code presets (`lib/mock-snippets.ts`)
    // by their English names — a code library, out of this sweep's scope.
    const clone = document.body.cloneNode(true) as HTMLElement
    for (const sel of Array.from(clone.querySelectorAll('select[title="Örnek ekle…"]'))) {
      sel.remove()
    }
    const text = clone.textContent ?? ''
    for (const re of MIXED) {
      expect(text.match(new RegExp(`.{0,40}${re.source}.{0,40}`, 'i'))?.[0] ?? '', String(re)).toBe(
        '',
      )
    }
    // Uppercase-styled headers upper-case "i" to "İ" only under a Turkish lang.
    expect(screen.getByTestId('mock-endpoint-path').closest('[lang]')).toHaveAttribute('lang', 'tr')
    expect(text).toContain('Uç noktalar')
    expect(text).toContain('Yanıtlar')
    expect(text).toContain('Başlıklar')
  })

  it('path-mode options are labelled per locale; values are unchanged', async () => {
    useLocale('tr')
    await mount(httpServer())
    const select = screen.getByTestId('mock-endpoint-path-mode') as HTMLSelectElement
    const opts = Array.from(select.options)
    expect(opts.map((o) => o.value)).toEqual(['exact', 'param', 'wildcard', 'regex'])
    expect(opts.map((o) => o.textContent)).toEqual([
      'Tam eşleşme',
      'Yol parametresi',
      'Joker karakter',
      'Düzenli ifade',
    ])
  })

  it('English path-mode labels', async () => {
    await mount(httpServer())
    const select = screen.getByTestId('mock-endpoint-path-mode') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Exact',
      'Path params',
      'Wildcard',
      'Regex',
    ])
  })

  it('import / JWKS buttons never wrap their label', async () => {
    useLocale('tr')
    await mount(httpServer(), false)
    for (const id of ['mock-import-openapi', 'mock-import-postman', 'mock-jwks-serve']) {
      expect(screen.getByTestId(id).className, id).toMatch(/\bwhitespace-nowrap\b/)
    }
  })

  it('no TR mock.* string keeps the English loan words (code-bearing hints excepted)', () => {
    // Hints that quote JSON / template syntax keep their identifiers.
    const CODE = new Set([
      'mock.bodyHint',
      'mock.scriptHint',
      'mock.conditionHint',
      'mock.authHint',
      'mock.failureHint',
      'mock.endpointSchemaValidationHint',
    ])
    useLocale('tr')
    const bad: string[] = []
    for (const re of [/Response'/, /Header'/, /Endpoint'/, /\bendpoint\b/, /\bresponse\b/]) {
      for (const key of TR_MOCK_KEYS) {
        if (CODE.has(key)) continue
        const tr = valuesInAllLocales(key)[1] ?? ''
        if (re.test(tr)) bad.push(`${key}: ${tr}`)
      }
    }
    expect(bad).toEqual([])
  })
})

/** Every mock.* key the HTTP editor renders. */
const TR_MOCK_KEYS = [
  'mock.tabEndpoints',
  'mock.endpoints',
  'mock.noEndpoints',
  'mock.selectEndpoint',
  'mock.endpointDefinition',
  'mock.confirmDeleteEndpoint',
  'mock.confirmDeleteResponse',
  'mock.pathMode',
  'mock.responses',
  'mock.addResponse',
  'mock.noResponses',
  'mock.responseName',
  'mock.headers',
  'mock.jwksFill',
  'mock.jwksFillHint',
  'mock.endpointAuthOverride',
  'mock.endpointAuthOverrideHint',
  'mock.corsAllowHeaders',
  'mock.echoEnabled',
  'mock.proxyHint',
  'mock.proxyRecord',
  'mock.proxyRecordHint',
  'mock.importDone',
]

function log(id: string): MockLogEntry {
  return {
    id,
    serverId: 'h-1',
    ts: 1,
    method: 'GET',
    path: '/a',
    query: '',
    statusCode: 200,
    latencyMs: 1,
    matchedEndpointId: null,
    matchedResponseId: null,
    request: { headers: {}, body: '' },
    response: { headers: {}, body: '' },
    error: null,
  }
}

describe('log counter is plural-aware (G-14)', () => {
  async function openLogs(n: number): Promise<HTMLElement> {
    const logs = Array.from({ length: n }, (_, i) => log(`l${i}`))
    httpBridge.logs.get.mockImplementation(() =>
      Promise.resolve({ success: true as const, data: logs }),
    )
    await mount(httpServer(), false)
    fireEvent.click(screen.getByTestId('mock-tab-logs'))
    const count = await screen.findByTestId('mock-log-count')
    await within(document.body).findByText(n === 1 ? /^1 entry$|^1 kayıt$/ : /entries|kayıt/)
    return count
  }

  it('EN: "1 entry" / "2 entries"', async () => {
    expect((await openLogs(1)).textContent).toBe('1 entry')
    cleanup()
    expect((await openLogs(2)).textContent).toBe('2 entries')
  })

  it('TR: "1 kayıt" / "2 kayıt"', async () => {
    useLocale('tr')
    expect((await openLogs(1)).textContent).toBe('1 kayıt')
    cleanup()
    expect((await openLogs(2)).textContent).toBe('2 kayıt')
  })
})
