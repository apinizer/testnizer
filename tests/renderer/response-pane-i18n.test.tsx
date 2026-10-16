/**
 * Issue #213 — with the app in Turkish the response pane still showed Body /
 * Cookies / Headers / Test Results (and Events, WS-Security) and the body
 * view switches Preview / Raw / Visualize in English. Labels are translated;
 * tab ids, testids and the view modes themselves are unchanged.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import ResponsePane from '../../src/renderer/components/response/ResponsePane'
import type { ApiResponse, SseEvent, Tab } from '../../src/renderer/types'

const SSE_EVENTS: SseEvent[] = [{ id: '1', type: 'message', data: 'hi', timestamp: 1 }]

function response(): ApiResponse {
  return {
    requestId: 'r1',
    protocol: 'soap',
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"hello":"world"}',
    bodySize: 18,
    timing: { total: 12 },
    cookies: [{ name: 'sid', value: 'abc', domain: 'x', path: '/' }],
    sseEvents: SSE_EVENTS,
    testResults: [
      {
        assertion: { id: 'a1', name: 'Status is 200', type: 'status_equals', enabled: true },
        passed: true,
      },
    ],
  } as ApiResponse
}

/** A plain HTTP response with no stream, no tests and a text body. */
function plainResponse(patch: Partial<ApiResponse> = {}): ApiResponse {
  return {
    ...response(),
    protocol: 'http',
    headers: { 'content-type': 'text/plain' },
    body: 'hello',
    sseEvents: undefined,
    testResults: [],
    ...patch,
  }
}

function show(res: ApiResponse): void {
  useResponseStore.setState({ response: res, isLoading: false })
}

beforeEach(() => {
  mockWindowApi()
  useTabsStore.setState({
    tabs: [{ id: 't1', name: 'Soap', protocol: 'soap', method: 'POST', url: '' } as Tab],
    activeTabId: 't1',
  })
  useResponseStore.setState({ response: response(), isLoading: false })
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('response pane labels (issue #213)', () => {
  it('Turkish: tabs and body view switches are translated', () => {
    useUIStore.getState().setLocale('tr')
    render(<ResponsePane />)
    expect(screen.getByTestId('res-tab-body')).toHaveTextContent(/^Gövde/)
    expect(screen.getByTestId('res-tab-events')).toHaveTextContent(/^Olaylar/)
    expect(screen.getByTestId('res-tab-cookies')).toHaveTextContent(/^Çerezler/)
    expect(screen.getByTestId('res-tab-headers')).toHaveTextContent(/^Başlıklar/)
    expect(screen.getByTestId('res-tab-testResults')).toHaveTextContent(/^Test Sonuçları/)
    expect(screen.getByTestId('res-tab-wsse')).toHaveTextContent('WS-Security')

    // A stream response opens on Events — switch to the body viewer.
    fireEvent.click(screen.getByTestId('res-tab-body'))
    expect(screen.getByTestId('res-body-preview')).toHaveTextContent('Önizleme')
    expect(screen.getByTestId('res-body-raw')).toHaveTextContent('Ham')
    expect(screen.getByTestId('res-body-visualize')).toHaveTextContent('Görselleştir')
    expect(screen.getByTestId('res-body-wrap')).toHaveAttribute('title', 'Satır kaydırmayı kapat')
    expect(screen.getByTestId('res-body-filter')).toHaveAttribute('title', 'Filtrele')
    expect(screen.getByTestId('res-body-copy')).toHaveAttribute('title', 'Kopyala')

    fireEvent.click(screen.getByTestId('res-body-filter'))
    expect(screen.getByTestId('res-body-filter-input')).toHaveAttribute(
      'placeholder',
      'Yanıtı filtrele... (metin ya da JSONPath benzeri)',
    )
  })

  it('Turkish: the view switches still drive the same modes', () => {
    useUIStore.getState().setLocale('tr')
    render(<ResponsePane />)
    fireEvent.click(screen.getByTestId('res-tab-body'))
    fireEvent.click(screen.getByTestId('res-body-visualize'))
    expect(screen.getByTitle('Yanıt önizlemesi').tagName).toBe('IFRAME')
    fireEvent.click(screen.getByTestId('res-body-raw'))
    expect(screen.getByTestId('monaco')).toHaveTextContent('{"hello":"world"}')
  })

  it('English (default) keeps the labels every existing locator relies on', () => {
    render(<ResponsePane />)
    expect(screen.getByTestId('res-tab-body')).toHaveTextContent(/^Body/)
    expect(screen.getByTestId('res-tab-events')).toHaveTextContent(/^Events/)
    expect(screen.getByTestId('res-tab-cookies')).toHaveTextContent(/^Cookies/)
    expect(screen.getByTestId('res-tab-headers')).toHaveTextContent(/^Headers/)
    expect(screen.getByTestId('res-tab-testResults')).toHaveTextContent(/^Test Results/)
    expect(screen.getByTestId('res-tab-wsse')).toHaveTextContent('WS-Security')
    fireEvent.click(screen.getByTestId('res-tab-body'))
    expect(screen.getByTestId('res-body-preview')).toHaveTextContent('Preview')
    expect(screen.getByTestId('res-body-raw')).toHaveTextContent('Raw')
    expect(screen.getByTestId('res-body-visualize')).toHaveTextContent('Visualize')
    expect(screen.getByTestId('res-body-wrap')).toHaveAttribute('title', 'Disable word wrap')
  })
})

describe('remaining response-pane strings (issue #213 follow-up)', () => {
  it('Turkish: Test Results empty state, filter labels and verdict badges', () => {
    useUIStore.getState().setLocale('tr')
    show(plainResponse())
    const { unmount } = render(<ResponsePane />)
    fireEvent.click(screen.getByTestId('res-tab-testResults'))
    expect(screen.getByText('Bu istek için hiç test çalıştırılmadı.')).toBeInTheDocument()
    unmount()

    show(
      plainResponse({
        testResults: [
          {
            assertion: { id: 'a1', name: 'ok', type: 'status_equals', enabled: true },
            passed: true,
          },
          {
            assertion: { id: 'a2', name: 'bad', type: 'status_equals', enabled: true },
            passed: false,
            error: 'nope',
          },
        ],
      } as Partial<ApiResponse>),
    )
    render(<ResponsePane />)
    fireEvent.click(screen.getByTestId('res-tab-testResults'))
    const panel = screen.getByTestId('test-results-panel')
    expect(panel).toHaveTextContent('Sonuçları filtrele')
    expect(panel).toHaveTextContent('GEÇTİ')
    expect(panel).toHaveTextContent('KALDI')
    fireEvent.click(screen.getByText('Sonuçları filtrele'))
    expect(panel).toHaveTextContent('Tüm sonuçlar (2)')
    expect(panel).toHaveTextContent('Geçenler (1)')
    expect(panel).toHaveTextContent('Kalanlar (1)')
  })

  it('Turkish: network-info popover labels', () => {
    useUIStore.getState().setLocale('tr')
    show(plainResponse({ timing: { total: 12, dns: 1 } } as Partial<ApiResponse>))
    render(<ResponsePane />)
    fireEvent.click(screen.getByTitle('Ağ bilgisi'))
    const pop = screen.getByTestId('response-network-popover')
    for (const label of [
      'Ağ',
      'Ana makine',
      'Protokol',
      'Metot',
      'Durum',
      'Sunucu',
      'Zamanlamalar',
      'DNS sorgusu',
      'TCP el sıkışması',
      'TLS el sıkışması',
      'İlk bayta kadar geçen süre',
      'İndirme',
      'Toplam',
    ]) {
      expect(pop).toHaveTextContent(label)
    }
    // Header names stay verbatim — they are protocol tokens, not UI copy.
    expect(pop).toHaveTextContent('Content-Type')
  })

  it('Turkish: the Text format option is labelled "Metin" (mode unchanged)', () => {
    useUIStore.getState().setLocale('tr')
    show(plainResponse())
    render(<ResponsePane />)
    expect(screen.getByTestId('res-body-format')).toHaveTextContent('Metin')
    fireEvent.click(screen.getByTestId('res-body-format'))
    expect(screen.getByTestId('res-body-format-Text')).toHaveTextContent('Metin')
    expect(screen.getByTestId('res-body-format-JSON')).toHaveTextContent('JSON')
  })

  it('Turkish: binary preview strings', () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock/1'),
      revokeObjectURL: vi.fn(),
    })
    try {
      useUIStore.getState().setLocale('tr')
      show(
        plainResponse({
          headers: { 'content-type': 'application/x-thing' },
          body: 'AAEC',
          bodyEncoding: 'base64',
          bodySize: 3,
        } as Partial<ApiResponse>),
      )
      const { unmount } = render(<ResponsePane />)
      expect(screen.getByTestId('res-binary-view-preview')).toHaveTextContent('Önizleme')
      expect(screen.getByTestId('res-binary-view-raw')).toHaveTextContent('Ham')
      expect(screen.getByTestId('res-binary-download')).toHaveTextContent('İndir')
      expect(screen.getByTestId('res-binary-preview')).toHaveTextContent('application/x-thing')
      unmount()

      // No content type → the generic file label; undecodable bytes → the error.
      show(
        plainResponse({
          headers: {},
          body: 'AAEC',
          bodyEncoding: 'base64',
        } as Partial<ApiResponse>),
      )
      const second = render(<ResponsePane />)
      expect(screen.getByTestId('res-binary-type')).toHaveTextContent('ikili')
      expect(screen.getByTestId('res-binary-preview')).toHaveTextContent('İkili dosya')
      second.unmount()

      show(plainResponse({ body: '%%%not base64', bodyEncoding: 'base64' } as Partial<ApiResponse>))
      render(<ResponsePane />)
      expect(screen.getByTestId('res-binary-preview')).toHaveTextContent(
        'İkili yanıt çözümlenemedi.',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('Turkish: cookie / header / event tab labels and empty states', () => {
    useUIStore.getState().setLocale('tr')
    show(plainResponse({ headers: {}, cookies: [] } as Partial<ApiResponse>))
    const { unmount } = render(<ResponsePane />)
    fireEvent.click(screen.getByTestId('res-tab-cookies'))
    expect(screen.getByText('Yanıtta çerez yok.')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('res-tab-headers'))
    expect(screen.getByText('Yanıtta başlık yok.')).toBeInTheDocument()
    unmount()

    show(response())
    render(<ResponsePane />)
    fireEvent.click(screen.getByTestId('res-tab-cookies'))
    for (const label of ['Ad', 'Değer', 'Alan adı', 'Yol', 'Bayraklar']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    fireEvent.click(screen.getByTestId('res-tab-headers'))
    expect(screen.getByText('Anahtar')).toBeInTheDocument()
    expect(screen.getByText('Değer')).toBeInTheDocument()
  })

  it('Turkish: the Events tab empty state', async () => {
    useUIStore.getState().setLocale('tr')
    const { default: EventsTab } = await import('../../src/renderer/components/response/EventsTab')
    show(plainResponse())
    render(<EventsTab />)
    expect(screen.getByText('Yanıt gövdesinde olay bulunamadı.')).toBeInTheDocument()
  })

  it('English keeps every string byte-identical', () => {
    show(plainResponse({ cookies: [] } as Partial<ApiResponse>))
    const { unmount } = render(<ResponsePane />)
    fireEvent.click(screen.getByTestId('res-tab-testResults'))
    expect(screen.getByText('No tests were run for this request.')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('res-tab-cookies'))
    expect(screen.getByText('No cookies in response.')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('res-tab-headers'))
    expect(screen.getByText('Key')).toBeInTheDocument()
    expect(screen.getByText('Value')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('res-tab-body'))
    expect(screen.getByTestId('res-body-format')).toHaveTextContent('Text')
    fireEvent.click(screen.getByTitle('Network info'))
    const pop = screen.getByTestId('response-network-popover')
    for (const label of ['Network', 'Host', 'Protocol', 'Method', 'Status', 'Server', 'Timings']) {
      expect(pop).toHaveTextContent(label)
    }
    for (const label of ['DNS lookup', 'TCP handshake', 'TLS handshake', 'Time to first byte']) {
      expect(pop).toHaveTextContent(label)
    }
    unmount()

    show(
      plainResponse({
        testResults: [
          {
            assertion: { id: 'a1', name: 'ok', type: 'status_equals', enabled: true },
            passed: true,
          },
        ],
      } as Partial<ApiResponse>),
    )
    render(<ResponsePane />)
    fireEvent.click(screen.getByTestId('res-tab-testResults'))
    const panel = screen.getByTestId('test-results-panel')
    expect(panel).toHaveTextContent('Filter Results')
    expect(panel).toHaveTextContent('PASSED')
    fireEvent.click(screen.getByText('Filter Results'))
    expect(panel).toHaveTextContent('All Results (1)')
  })
})

/**
 * Issue #213 — at a normal pane width the Turkish row ("Gövde / Çerezler /
 * Başlıklar 3 / Test Sonuçları" + status + ms + KB + "Yanıtı kaydet" + "Kod"
 * + globe) overflowed and the tab strip scrolled, cutting Gövde off. The top
 * bar is now a CSS size container and the two text buttons drop to icon-only
 * when it is narrow. jsdom cannot evaluate container queries, so the
 * structure that implements it is pinned here (the real fit is verified on a
 * live window).
 */
describe('response top bar fits (issue #213)', () => {
  it('the bar is a size container and the text buttons collapse to icons, keeping a name', () => {
    useUIStore.getState().setLocale('tr')
    show(plainResponse())
    useTabsStore.setState({
      tabs: [
        {
          id: 't1',
          name: 'Req',
          protocol: 'http',
          method: 'GET',
          url: '',
          endpointId: 'e1',
        } as Tab,
      ],
      activeTabId: 't1',
    })
    render(<ResponsePane />)
    const bar = screen.getByTestId('response-topbar')
    expect(bar).toHaveClass('@container')

    for (const [id, name] of [
      ['response-save-btn', 'Yanıtı kaydet'],
      ['response-code-btn', 'Kod'],
    ] as const) {
      const btn = screen.getByTestId(id)
      expect(btn).toHaveAttribute('aria-label', name)
      const label = btn.querySelector('[data-collapsible-label]')
      expect(label).not.toBeNull()
      expect(label).toHaveTextContent(name)
      expect(label?.className).toMatch(/@max-\[[0-9.]+(px|em|rem)\]:hidden/)
    }
    // Tabs never shrink below their label (no squeezed / ellipsised tabs).
    expect(screen.getByTestId('res-tab-body')).toHaveClass('shrink-0')
  })
})
