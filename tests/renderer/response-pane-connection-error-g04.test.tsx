/**
 * 1.6.0 screen review G-04 (issue #253) — the HTTP response error panel shows
 * the next step ("Check that the server is running"), like the WebSocket
 * editor does, and writes it in the active locale from `errorInfo` through the
 * shared renderer helper (`lib/connection-error.ts`).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import ResponsePane from '../../src/renderer/components/response/ResponsePane'
import type { ApiResponse, Tab } from '../../src/renderer/types'

const REFUSED = {
  requestId: 'r1',
  protocol: 'http',
  timing: { total: 3 },
  error: 'Connection refused — 127.0.0.1:9. Check that the server is running',
  errorInfo: {
    kind: 'refused',
    target: '127.0.0.1:9',
    code: 'ECONNREFUSED',
    message: 'Connection refused — 127.0.0.1:9',
    hint: 'Check that the server is running',
  },
} as ApiResponse

beforeEach(() => {
  mockWindowApi()
  useTabsStore.setState({
    tabs: [{ id: 't1', name: 'Req', protocol: 'http', method: 'GET', url: '' } as Tab],
    activeTabId: 't1',
  })
  useResponseStore.setState({ response: REFUSED, isLoading: false })
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('response error panel — connection error with a next step (G-04)', () => {
  it('English: cause, address and hint', () => {
    render(<ResponsePane />)
    expect(screen.getByTestId('response-error')).toHaveTextContent(
      'Connection refused — 127.0.0.1:9. Check that the server is running',
    )
  })

  it('Turkish: the same sentence from the connError.* keys', () => {
    useUIStore.getState().setLocale('tr')
    render(<ResponsePane />)
    expect(screen.getByTestId('response-error')).toHaveTextContent(
      'Bağlantı reddedildi — 127.0.0.1:9. Sunucunun çalıştığını kontrol edin',
    )
  })

  it('an old response without errorInfo still shows its raw error', () => {
    useResponseStore.setState({
      response: { requestId: 'r2', protocol: 'http', timing: { total: 1 }, error: 'boom' },
      isLoading: false,
    })
    render(<ResponsePane />)
    expect(screen.getByTestId('response-error')).toHaveTextContent('boom')
  })
})
