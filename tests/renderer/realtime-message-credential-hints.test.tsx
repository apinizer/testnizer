/**
 * Issue #284 audit — the realtime message editors say what a restart does to
 * a literal credential in the body, like the HTTP JSON body (#247): the MQTT
 * composer and will payload, the WebSocket composer and the Socket.IO emit
 * arguments show the restart hint while their JSON-looking text holds a
 * literal credential member, and not for `{{var}}` or plain text.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useMqttStore } from '../../src/renderer/stores/mqtt.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import MqttComposer from '../../src/renderer/components/protocols/mqtt/MqttComposer'
import MqttWillTab from '../../src/renderer/components/protocols/mqtt/MqttWillTab'
import WsComposer from '../../src/renderer/components/protocols/WsComposer'
import SioComposer from '../../src/renderer/components/protocols/socketio/SioComposer'

vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

afterEach(cleanup)

const BODIES: Array<[string, string, boolean]> = [
  ['literal credential member', '{"password": "s3cret"}', true],
  ['{{var}} only', '{"password": "{{pw}}"}', false],
  ['plain text', 'password is s3cret', false],
]

describe('realtime message bodies: restart hint (issue #284 audit)', () => {
  for (const [name, body, shown] of BODIES) {
    const expectHint = (testId: string) => {
      const hint = screen.queryByTestId(testId)
      if (shown) expect(hint?.textContent).toMatch(/not kept after a restart/)
      else expect(hint).toBeNull()
    }

    it(`MQTT composer — ${name}`, () => {
      useMqttStore.setState({ composer: { ...useMqttStore.getState().composer, content: body } })
      render(React.createElement(MqttComposer))
      expectHint('mqtt-composer-restart-hint')
    })

    it(`MQTT will payload — ${name}`, () => {
      useMqttStore.setState({ lastWill: { ...useMqttStore.getState().lastWill, payload: body } })
      render(React.createElement(MqttWillTab))
      expectHint('mqtt-will-restart-hint')
    })

    it(`WebSocket composer — ${name}`, () => {
      useWebSocketStore.setState({ composerContent: body })
      render(React.createElement(WsComposer))
      expectHint('ws-composer-restart-hint')
    })

    it(`Socket.IO emit arguments — ${name}`, () => {
      useSocketIOStore.setState({
        emitArgs: [
          { id: 'a1', content: 'first', contentType: 'text' },
          { id: 'a2', content: body, contentType: 'json' },
        ],
      })
      render(React.createElement(SioComposer))
      expectHint('socketio-args-restart-hint')
    })
  }
})
