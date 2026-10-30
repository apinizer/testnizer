/**
 * Issues #244 / #247 — the restart hint in every collapsible header /
 * metadata editor (WebSocket, SSE, GraphQL headers + variables, gRPC
 * metadata) and under the SOAP UsernameToken password. Before, an unsaved
 * draft's credential value came back empty after a restart with no word on
 * screen. Expand the section → the hint is there for a literal credential
 * row, absent for a `{{var}}` one.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { KeyValuePair } from '../../src/renderer/types'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => React.createElement('div', { 'data-testid': 'monaco' }),
}))

import WebSocketEditor from '../../src/renderer/components/protocols/WebSocketEditor'
import SseEditor from '../../src/renderer/components/protocols/SseEditor'
import GraphQLQueryPane from '../../src/renderer/components/protocols/GraphQLQueryPane'
import GrpcRequestPane from '../../src/renderer/components/protocols/GrpcRequestPane'
import SoapSecuritySection from '../../src/renderer/components/protocols/SoapSecuritySection'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'

const rows = (value: string): KeyValuePair[] => [
  { id: 'r1', key: 'Authorization', value, enabled: true },
]

afterEach(cleanup)

const CASES: Array<{
  name: string
  set: (value: string) => void
  el: () => React.ReactElement
  /** The collapsed section's toggle; null when the section starts open. */
  toggle: RegExp | null
  /** The toggle's role: a section button, or a request tab (issue #282). */
  toggleRole?: 'button' | 'tab'
  testId: string
}> = [
  {
    name: 'WebSocket custom headers',
    set: (v) => useWebSocketStore.setState({ customHeaders: rows(v) }),
    el: () => React.createElement(WebSocketEditor),
    toggle: /^Headers/,
    toggleRole: 'tab',
    testId: 'ws-headers-restart-hint',
  },
  {
    name: 'SSE custom headers',
    set: (v) => useSseStore.setState({ customHeaders: rows(v) }),
    el: () => React.createElement(SseEditor),
    toggle: /Custom Headers/,
    testId: 'sse-headers-restart-hint',
  },
  {
    name: 'GraphQL headers',
    set: (v) => useGraphQLStore.setState({ headers: rows(v) }),
    el: () => React.createElement(GraphQLQueryPane),
    toggle: /^Headers/,
    testId: 'graphql-headers-restart-hint',
  },
  {
    name: 'GraphQL variables',
    set: (v) => useGraphQLStore.setState({ variables: `{ "token": "${v}" }` }),
    el: () => React.createElement(GraphQLQueryPane),
    toggle: null,
    testId: 'graphql-variables-restart-hint',
  },
  {
    name: 'gRPC metadata',
    set: (v) => useGrpcStore.setState({ protoLoaded: true, metadata: rows(v) } as never),
    el: () => React.createElement(GrpcRequestPane),
    toggle: /Metadata/,
    testId: 'grpc-metadata-restart-hint',
  },
]

describe('restart hint in the collapsible editors', () => {
  for (const c of CASES) {
    it(`${c.name}: shown for a literal value, not for {{var}}`, () => {
      c.set('Bearer {{token}}')
      const { unmount } = render(c.el())
      if (c.toggle) fireEvent.click(screen.getByRole(c.toggleRole ?? 'button', { name: c.toggle }))
      expect(screen.queryByTestId(c.testId)).toBeNull()
      unmount()

      c.set('Bearer literal-abc')
      render(c.el())
      if (c.toggle) fireEvent.click(screen.getByRole(c.toggleRole ?? 'button', { name: c.toggle }))
      expect(screen.getByTestId(c.testId).textContent).toMatch(
        /not kept after a restart unless the request is saved/,
      )
    })
  }

  it('SOAP UsernameToken password', () => {
    useSoapStore.setState({
      wsSecurity: {
        ...useSoapStore.getState().wsSecurity,
        enabled: true,
        modes: ['username-token'],
      },
    })
    render(React.createElement(SoapSecuritySection))
    const hint = screen.getByTestId('soap-wss-restart-hint')
    expect(screen.getByPlaceholderText('Enter password').getAttribute('aria-describedby')).toBe(
      hint.id,
    )
  })
})
