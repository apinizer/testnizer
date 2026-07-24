/**
 * Smoke-render the response pane and every one of its tabs against a seeded
 * response store + mocked window.api. Guards the highest-traffic read surface
 * (what users stare at after every Send) from render-throw regressions.
 */
import * as React from 'react'
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

vi.mock('../../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mountsWithoutCrash, mockWindowApi } from './_mount'
import { useResponseStore } from '../../../src/renderer/stores/response.store'
import ResponsePane from '../../../src/renderer/components/response/ResponsePane'
import ResponseBody from '../../../src/renderer/components/response/ResponseBody'
import CookieTab from '../../../src/renderer/components/response/CookieTab'
import HeadersTab from '../../../src/renderer/components/response/HeadersTab'
import TestResultsTab from '../../../src/renderer/components/response/TestResultsTab'
import EventsTab from '../../../src/renderer/components/response/EventsTab'
import ConsoleTab from '../../../src/renderer/components/response/ConsoleTab'
import type { ApiResponse } from '../../../src/renderer/types'

function baseResponse(): ApiResponse {
  return {
    requestId: 'r1',
    protocol: 'http',
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', server: 'nginx' },
    body: '{"hello":"world"}',
    bodySize: 18,
    timing: { total: 142, dns: 2, tcp: 5, tls: 8, ttfb: 100, download: 27 },
    cookies: [
      { name: 'sid', value: 'abc', domain: 'example.com', path: '/', httpOnly: true, secure: true },
    ],
    testResults: [
      {
        assertion: { id: 'a1', name: 'Status is 200', type: 'status_equals', enabled: true },
        passed: true,
      },
      {
        assertion: { id: 'a2', name: 'Body has id', type: 'body_contains', enabled: true },
        passed: false,
        error: 'expected body to contain "id"',
      },
    ],
    actualRequest: {
      method: 'POST',
      url: 'https://api.example.com/users',
      headers: { 'content-type': 'application/json' },
    },
  }
}

beforeEach(() => {
  mockWindowApi()
  useResponseStore.setState({ response: baseResponse(), isLoading: false })
})

afterEach(() => {
  cleanup()
})

describe('Response screens — smoke mount', () => {
  it('ResponsePane (with a populated response)', () => {
    mountsWithoutCrash(<ResponsePane />)
  })

  it('ResponsePane (loading state)', () => {
    useResponseStore.setState({ response: null, isLoading: true })
    mountsWithoutCrash(<ResponsePane />)
  })

  it('ResponsePane (empty / no response)', () => {
    useResponseStore.setState({ response: null, isLoading: false })
    mountsWithoutCrash(<ResponsePane />)
  })

  it('ResponsePane (transport error, no status)', () => {
    useResponseStore.setState({
      response: { requestId: 'e1', protocol: 'http', error: 'ECONNREFUSED', timing: { total: 0 } },
      isLoading: false,
    })
    mountsWithoutCrash(<ResponsePane />)
  })

  it('ResponseBody', () => {
    mountsWithoutCrash(<ResponseBody />)
  })

  it('CookieTab', () => {
    mountsWithoutCrash(<CookieTab />)
  })

  it('HeadersTab', () => {
    mountsWithoutCrash(<HeadersTab />)
  })

  it('TestResultsTab', () => {
    mountsWithoutCrash(<TestResultsTab />)
  })

  it('EventsTab (with parsed SSE events)', () => {
    useResponseStore.setState({
      response: {
        ...baseResponse(),
        sseEvents: [
          { type: 'message', data: '{"n":1}', timestamp: 1, id: '1' },
          { type: 'update', data: 'plain', timestamp: 2 },
        ],
      },
    })
    mountsWithoutCrash(<EventsTab />)
  })

  it('EventsTab (empty)', () => {
    mountsWithoutCrash(<EventsTab />)
  })

  it('ConsoleTab', () => {
    mountsWithoutCrash(<ConsoleTab />)
  })
})
