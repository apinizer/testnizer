/**
 * Issue #284 audit (P2) — `{{var}}` autocomplete and highlighting on the
 * realtime connection fields, like the MCP bar.
 *
 * The MQTT broker URL, client ID and password and the WebSocket / SSE /
 * Socket.IO URLs were plain inputs: typing `{{` offered nothing and a
 * variable was not coloured. They are `VariableAutocompleteInput`s now (the
 * testids stay on the real `<input>`, a fieldset carries the disabled state);
 * the password keeps `type="password"` and draws no clear-text overlay. The
 * MQTT will payload is a Monaco editor like the composer (its variables are
 * highlighted and completed there).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WsConnectionBar from '../../src/renderer/components/protocols/WsConnectionBar'
import SseConnectionBar from '../../src/renderer/components/protocols/SseConnectionBar'
import SocketIOConnectionBar from '../../src/renderer/components/protocols/socketio/SocketIOConnectionBar'
import MqttConnectionBar from '../../src/renderer/components/protocols/mqtt/MqttConnectionBar'
import { MqttAuthTab } from '../../src/renderer/components/protocols/mqtt/MqttConnectTabs'
import MqttWillTab from '../../src/renderer/components/protocols/mqtt/MqttWillTab'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useMqttStore } from '../../src/renderer/stores/mqtt.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'

vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => React.createElement('div', { 'data-testid': 'monaco-stub' }),
}))

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

beforeEach(() => {
  useEnvironmentStore.setState({
    environments: [
      {
        id: 'env-1',
        name: 'Dev',
        variables: [{ key: 'brokerHost', value: '127.0.0.1', enabled: true }],
      },
    ],
    activeEnvironmentId: 'env-1',
    globalVariables: [],
  } as never)
})
afterEach(cleanup)

const FIELDS: Array<{
  name: string
  testId: string
  mount: () => void
  read: () => string
}> = [
  {
    name: 'MQTT broker URL',
    testId: 'mqtt-url',
    mount: () => {
      useMqttStore.setState({ url: '', connectionState: 'disconnected' })
      render(React.createElement(MqttConnectionBar))
    },
    read: () => useMqttStore.getState().url,
  },
  {
    name: 'MQTT client ID',
    testId: 'mqtt-client-id',
    mount: () => {
      useMqttStore.setState({ clientId: '', connectionState: 'disconnected' })
      render(React.createElement(MqttConnectionBar))
    },
    read: () => useMqttStore.getState().clientId,
  },
  {
    name: 'MQTT password',
    testId: 'mqtt-password',
    mount: () => {
      useMqttStore.setState({ password: '' })
      render(React.createElement(MqttAuthTab))
    },
    read: () => useMqttStore.getState().password,
  },
  {
    name: 'WebSocket URL',
    testId: 'ws-url',
    mount: () => {
      useWebSocketStore.setState({ url: '', connectionState: 'disconnected' })
      render(React.createElement(WsConnectionBar))
    },
    read: () => useWebSocketStore.getState().url,
  },
  {
    name: 'SSE URL',
    testId: 'sse-url',
    mount: () => {
      useSseStore.setState({ url: '', connectionState: 'disconnected' })
      render(React.createElement(SseConnectionBar))
    },
    read: () => useSseStore.getState().url,
  },
  {
    name: 'Socket.IO URL',
    testId: 'socketio-url',
    mount: () => {
      useSocketIOStore.setState({ url: '', connectionState: 'disconnected' })
      render(React.createElement(SocketIOConnectionBar))
    },
    read: () => useSocketIOStore.getState().url,
  },
]

describe('connection fields offer {{var}} autocomplete (issue #284 audit)', () => {
  for (const f of FIELDS) {
    it(`${f.name}: typing {{ suggests variables; picking one writes it`, () => {
      f.mount()
      const input = screen.getByTestId(f.testId) as HTMLInputElement
      expect(input.tagName).toBe('INPUT')
      fireEvent.change(input, { target: { value: '{{', selectionStart: 2 } })
      expect(screen.getByTestId('var-autocomplete')).toHaveTextContent('brokerHost')
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(f.read()).toBe('{{brokerHost}}')
    })
  }

  it('a {{variable}} in a URL is highlighted', () => {
    useWebSocketStore.setState({ url: 'ws://{{brokerHost}}/ws', connectionState: 'disconnected' })
    const { container } = render(React.createElement(WsConnectionBar))
    const token = [...container.querySelectorAll('span')].find(
      (s) => s.textContent === '{{brokerHost}}',
    )
    expect(token).toBeTruthy()
  })

  it('the password stays masked: type=password and no clear-text overlay', () => {
    useMqttStore.setState({ password: 's3cret-{{brokerHost}}' })
    const { container } = render(React.createElement(MqttAuthTab))
    const input = screen.getByTestId('mqtt-password')
    expect(input).toHaveAttribute('type', 'password')
    expect(container.textContent).not.toContain('s3cret')
  })

  it('connected: the URL field is disabled through its fieldset', () => {
    useWebSocketStore.setState({ url: 'ws://x', connectionState: 'connected' })
    render(React.createElement(WsConnectionBar))
    expect(screen.getByTestId('ws-url')).toBeDisabled()
  })

  it('MQTT will payload is an editor like the composer', () => {
    render(React.createElement(MqttWillTab))
    const box = screen.getByTestId('mqtt-will-payload')
    expect(box.tagName).not.toBe('TEXTAREA')
  })
})
