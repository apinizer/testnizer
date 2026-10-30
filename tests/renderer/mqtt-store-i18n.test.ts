/**
 * Issue #284 audit — the MQTT store's own error texts are translated: the
 * fallbacks for a missing bridge, a failed connect, publish and subscribe
 * request used to be English literals in a Turkish UI.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { useMqttStore } from '../../src/renderer/stores/mqtt.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'

type Api = Record<string, unknown>
const setApi = (mqtt: Api | undefined) => {
  ;(window as unknown as { api: unknown }).api = mqtt ? { mqtt } : {}
}

afterEach(() => {
  setLocale('en')
  useUIStore.setState({ locale: 'en' })
  setApi(undefined)
})

const tr = () => {
  useUIStore.setState({ locale: 'tr' })
  setLocale('tr')
}

describe('MQTT store errors follow the UI language (issue #284 audit)', () => {
  it('no bridge: "MQTT kullanılamıyor"', async () => {
    tr()
    setApi(undefined)
    useMqttStore.setState({ url: 'mqtt://broker.test', connectionState: 'disconnected' })
    await useMqttStore.getState().connect()
    expect(useMqttStore.getState().errorMessage).toBe('MQTT kullanılamıyor')
  })

  it('connect / publish / subscribe without an engine message use the Turkish fallback', async () => {
    tr()
    const fail = async () => ({ success: false })
    setApi({
      connect: fail,
      publish: fail,
      subscribe: fail,
      onEvent: () => () => {},
      onClosed: () => () => {},
    })
    useMqttStore.setState({ url: 'mqtt://broker.test', connectionState: 'disconnected' })
    await useMqttStore.getState().connect()
    expect(useMqttStore.getState().errorMessage).toBe('Bağlantı başarısız')

    useMqttStore.setState({
      connectionId: 'c1',
      connectionState: 'connected',
      errorMessage: null,
      composer: { ...useMqttStore.getState().composer, topic: 'a/b', content: 'hi' },
    })
    await useMqttStore.getState().publish()
    expect(useMqttStore.getState().errorMessage).toBe('Yayınlama başarısız')

    useMqttStore.setState({
      errorMessage: null,
      topics: [{ id: 't1', name: 'a/#', qos: 0, subscribed: false } as never],
    })
    await useMqttStore.getState().toggleTopic('t1')
    expect(useMqttStore.getState().errorMessage).toBe('İstek başarısız')
  })
})
