/**
 * Issue #193 — with the UI in Turkish, the sidebar navigation (APIs, Tests,
 * Mocks, History, Tools, Security, Settings) and the request editor's buttons
 * ("+ Add Parameter" …) stayed in English: they were string literals, not
 * `t()` calls. This renders them in TR and asserts the Turkish labels, renders
 * them in EN and asserts the English text is byte-identical (e2e selectors use
 * it), and guards the components against new hard-coded add-button / nav
 * labels.
 *
 * Also covers the issue #197 "left out of the export" message in both locales.
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { t, setLocale } from '../../src/renderer/lib/i18n'
import { formatExportSkipped } from '../../src/renderer/lib/export-skipped'
import IconSidebar from '../../src/renderer/components/layout/IconSidebar'
import ParamsTab from '../../src/renderer/components/request/ParamsTab'
import HeadersTab from '../../src/renderer/components/request/HeadersTab'
import BodyTab from '../../src/renderer/components/request/BodyTab'
import AuthTab from '../../src/renderer/components/request/AuthTab'
import TestsTab from '../../src/renderer/components/request/TestsTab'
import EnvironmentSelector from '../../src/renderer/components/shared/EnvironmentSelector'

function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

beforeEach(() => {
  useRequestStore.setState({
    params: [],
    headers: [],
    body: { type: 'form-data', formData: [] },
    auth: { type: 'none' },
    assertions: [],
    postScript: '',
  })
})

afterEach(() => {
  cleanup()
  useLocale('en')
})

const NAV_TR = ["API'ler", 'Testler', "Mock'lar", 'Geçmiş', 'Araçlar', 'Güvenlik', 'Ayarlar']
const NAV_EN = ['APIs', 'Tests', 'Mocks', 'History', 'Tools', 'Security', 'Settings']
const NAV_IDS = ['apis', 'tests', 'mocks', 'history', 'tools', 'security', 'settings']

describe('issue #193 — sidebar navigation follows the UI language', () => {
  it('renders the nav labels in Turkish', () => {
    useLocale('tr')
    render(<IconSidebar />)
    NAV_IDS.forEach((id, i) => {
      expect(screen.getByTestId(`nav-${id}`).textContent).toBe(NAV_TR[i])
    })
  })

  it('keeps the English nav labels byte-identical', () => {
    useLocale('en')
    render(<IconSidebar />)
    NAV_IDS.forEach((id, i) => {
      expect(screen.getByTestId(`nav-${id}`).textContent).toBe(NAV_EN[i])
    })
  })
})

describe('issue #193 — request editor buttons follow the UI language', () => {
  it('renders the params table in Turkish', () => {
    useLocale('tr')
    render(<ParamsTab />)
    expect(screen.getByText('Sorgu Parametreleri')).toBeTruthy()
    expect(screen.getByText('+ Parametre Ekle')).toBeTruthy()
    expect(screen.queryByText('+ Add Parameter')).toBeNull()
  })

  it('renders headers, form fields, auth and assertions in Turkish', () => {
    useLocale('tr')
    const { unmount } = render(<HeadersTab />)
    expect(screen.getByText('+ Başlık Ekle')).toBeTruthy()
    unmount()

    const body = render(<BodyTab />)
    expect(screen.getByText('+ Alan Ekle')).toBeTruthy()
    body.unmount()

    const auth = render(<AuthTab />)
    expect(screen.getByText('Bu istek herhangi bir yetkilendirme kullanmıyor.')).toBeTruthy()
    expect(screen.getByText('Üstten miras al')).toBeTruthy()
    auth.unmount()

    render(<TestsTab />)
    expect(screen.getByText('+ Doğrulama Ekle')).toBeTruthy()
    expect(screen.getByText('Yanıt Sonrası Betiği')).toBeTruthy()
  })

  it('keeps the English editor labels byte-identical', () => {
    useLocale('en')
    const params = render(<ParamsTab />)
    expect(screen.getByText('Query Params')).toBeTruthy()
    expect(screen.getByText('+ Add Parameter')).toBeTruthy()
    params.unmount()
    const headers = render(<HeadersTab />)
    expect(screen.getByText('+ Add Header')).toBeTruthy()
    headers.unmount()
    const auth = render(<AuthTab />)
    expect(screen.getByText('This request does not use any authorization.')).toBeTruthy()
    auth.unmount()
    render(<EnvironmentSelector />)
    expect(screen.getByText('No environment')).toBeTruthy()
  })

  it('renders the environment selector empty state in Turkish', () => {
    useLocale('tr')
    render(<EnvironmentSelector />)
    expect(screen.getByText('Ortam yok')).toBeTruthy()
  })
})

describe('issue #193 — no new hard-coded labels in these components', () => {
  const ROOT = resolve(__dirname, '../../src/renderer/components')
  const FILES = [
    'layout/IconSidebar.tsx',
    'layout/Workbench.tsx',
    'request/ParamsTab.tsx',
    'request/HeadersTab.tsx',
    'request/BodyTab.tsx',
    'protocols/SseEditor.tsx',
    'protocols/GraphQLQueryPane.tsx',
    'protocols/WebSocketEditor.tsx',
    'protocols/GrpcRequestPane.tsx',
  ]

  it('passes add-button, nav and context-menu labels through t()', () => {
    const offenders: string[] = []
    for (const rel of FILES) {
      const src = readFileSync(resolve(ROOT, rel), 'utf8')
      // `addLabel="+ Add …"` / `label="Close Tab"` — literal English handed to
      // a label prop instead of a t() call. (Format / RPC-kind names in data
      // tables — JSON, XML, Unary … — are intentionally not translated.)
      for (const m of src.matchAll(/\b(addLabel|label)=["'][A-Z+][^"']*["']/g)) {
        offenders.push(`${rel}: ${m[0]}`)
      }
      // The sidebar nav table: `label: 'APIs'`.
      if (rel === 'layout/IconSidebar.tsx') {
        for (const m of src.matchAll(/\blabel:\s*'[A-Z][^']*'/g)) offenders.push(`${rel}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('issue #197 — "left out of the export" message', () => {
  const skipped = [
    { name: 'Ping', protocol: 'mcp', reason: 'unsupported-protocol' as const },
    { name: 'Echo', protocol: 'websocket', reason: 'unsupported-protocol' as const },
  ]

  it('names the items and their protocol in English', () => {
    setLocale('en')
    expect(formatExportSkipped(skipped, 'postman', t)).toBe(
      '2 item(s) left out of the Postman v2.1 export: Ping (MCP), Echo (WebSocket)',
    )
  })

  it('names the items and their protocol in Turkish', () => {
    setLocale('tr')
    expect(formatExportSkipped(skipped, 'insomnia', t)).toBe(
      '2 öğe Insomnia dışa aktarımına dahil edilmedi: Ping (MCP), Echo (WebSocket)',
    )
  })

  it('caps the list and returns null when nothing was left out', () => {
    setLocale('en')
    const many = Array.from({ length: 7 }, (_, i) => ({
      name: `R${i}`,
      protocol: 'grpc',
      reason: 'unsupported-protocol' as const,
    }))
    expect(formatExportSkipped(many, 'openapi', t)).toBe(
      '7 item(s) left out of the OpenAPI export: R0 (gRPC), R1 (gRPC), R2 (gRPC), R3 (gRPC), R4 (gRPC) and 2 more',
    )
    expect(formatExportSkipped([], 'postman', t)).toBeNull()
  })
})
