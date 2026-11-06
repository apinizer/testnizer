/**
 * What the proxy setting means for a realtime connection. `custom` with a host and
 * `none` are the setting; anything else reads the environment, as HTTP Send does
 * through axios. Fail-before: there was no such rule outside HTTP Send.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveConnectionProxy } from '../../src/main/lib/proxy-tunnel'
import { classifyTransportError } from '../../src/main/lib/error-classifier'

const VARS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'WS_PROXY',
  'WSS_PROXY',
  'MQTT_PROXY',
]
const names = [...VARS, ...VARS.map((v) => v.toLowerCase())]
let saved: Record<string, string | undefined>
beforeEach(() => {
  saved = Object.fromEntries(names.map((n) => [n, process.env[n]]))
  for (const n of names) delete process.env[n]
})
afterEach(() => {
  for (const n of names) {
    if (saved[n] === undefined) delete process.env[n]
    else process.env[n] = saved[n]
  }
})

describe('the setting', () => {
  it('"none" is no proxy, even with the environment set and a host left in the form', () => {
    process.env.HTTP_PROXY = 'http://env.test:3128'
    expect(
      resolveConnectionProxy({ mode: 'none', host: 'left.test', port: 1 }, 'ws://s.test'),
    ).toBeNull()
  })

  it('"custom" is that proxy; the port defaults like HTTP Send', () => {
    expect(resolveConnectionProxy({ mode: 'custom', host: 'p.test' }, 'ws://s.test')).toEqual({
      origin: 'http://p.test:8080',
    })
    expect(
      resolveConnectionProxy({ mode: 'custom', host: 'p.test', port: 3128 }, 'ws://s.test'),
    ).toEqual({
      origin: 'http://p.test:3128',
    })
  })

  it('credentials stay out of the origin, whatever they hold', () => {
    const auth = { username: 'a@b', password: 'p:/@%41' }
    const proxy = resolveConnectionProxy(
      { mode: 'custom', host: 'p.test', port: 1, auth },
      'ws://s.test',
    )
    expect(proxy).toEqual({ origin: 'http://p.test:1', auth })
  })

  it('an IPv6 host', () => {
    expect(
      resolveConnectionProxy({ mode: 'custom', host: '::1', port: 3128 }, 'ws://s.test')?.origin,
    ).toBe('http://[::1]:3128')
  })

  it('"custom" with no host is no proxy', () => {
    process.env.HTTP_PROXY = 'http://env.test:1'
    expect(resolveConnectionProxy({ mode: 'custom' }, 'ws://s.test')).toBeNull()
  })
})

describe('a saved SOCKS proxy', () => {
  const setting = { mode: 'custom' as const, host: 'p.test', port: 1, proxyType: 'socks' as const }

  it('is refused, never sent directly or as HTTP', () => {
    expect(() => resolveConnectionProxy(setting, 'wss://a.test/x')).toThrow(/SOCKS proxies/)
  })

  it('a host on its bypass list still goes out directly', () => {
    expect(resolveConnectionProxy({ ...setting, bypass: 'a.test' }, 'wss://a.test/x')).toBeNull()
  })
})

describe('the bypass list', () => {
  it('a listed host goes out directly, another through the proxy', () => {
    const setting = { mode: 'custom' as const, host: 'p.test', port: 1, bypass: '*.internal' }
    expect(resolveConnectionProxy(setting, 'wss://a.internal/x')).toBeNull()
    expect(resolveConnectionProxy(setting, 'wss://a.public/x')?.origin).toBe('http://p.test:1')
  })
})

describe('the environment', () => {
  it.each([undefined, null, { mode: 'system' as const }])(
    '%j is no proxy, whatever the variables say: these connections never read them',
    (setting) => {
      process.env.HTTP_PROXY = 'http://env.test:1'
      process.env.HTTPS_PROXY = 'http://env.test:1'
      process.env.ALL_PROXY = 'http://env.test:1'
      expect(resolveConnectionProxy(setting, 'ws://s.test')).toBeNull()
    },
  )
})

describe('classifying a failure with the proxy in the way', () => {
  const ctx = { protocol: 'websocket' as const, url: 'http://p.test:1', viaProxy: true }
  it('a 407 names the credentials', () => {
    const info = classifyTransportError(new Error('Unexpected server response: 407'), {
      ...ctx,
      proxyStatus: 407,
    })
    expect(info.kind).toBe('proxy')
    expect(info.detail).toMatch(/rejected the credentials/)
    expect(info.target).toBe('p.test:1')
  })
  it('a refused port is the proxy', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    expect(classifyTransportError(err, ctx).kind).toBe('proxy')
  })
  it("the user's own Cancel stays a cancel", () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(classifyTransportError(err, ctx).kind).toBe('aborted')
  })
  it('undici reports a refused tunnel as an abort, with the status known', () => {
    const err = Object.assign(new Error('Proxy response (407) !== 200 when HTTP Tunneling'), {
      code: 'UND_ERR_ABORTED',
    })
    expect(classifyTransportError(err, { ...ctx, proxyStatus: 407 }).kind).toBe('proxy')
  })
})
