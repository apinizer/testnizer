import { describe, expect, it } from 'vitest'
import { isProxyBypassed } from '../../../src/shared/proxy-bypass'

describe('isProxyBypassed', () => {
  it.each([
    ['localhost, *.internal', 'http://localhost:3000/x'],
    ['localhost, *.internal', 'wss://a.b.internal/x'],
    ['.internal', 'mqtt://broker.internal'],
    ['LOCALHOST', 'http://localhost'],
    ['a.test;b.test', 'https://b.test'],
    ['a.test b.test', 'https://b.test'],
    ['*', 'https://anything.test'],
    ['near.test:8080', 'ws://near.test:8080'],
    ['near.test:443', 'wss://near.test'],
    ['near.test:1883', 'mqtt://near.test'],
    ['127.0.0.1', 'http://127.0.0.1:9/x'],
    ['::1', 'http://[::1]:9/x'],
    ['[::1]:9', 'http://[::1]:9/x'],
  ])('%s covers %s', (list, url) => {
    expect(isProxyBypassed(list, url)).toBe(true)
  })

  it.each([
    [undefined, 'http://localhost'],
    ['', 'http://localhost'],
    ['  ', 'http://localhost'],
    ['localhost', 'http://localhost.evil.test'],
    ['*.internal', 'http://internal.evil.test'],
    ['*.internal', 'http://notinternal'],
    ['near.test:8080', 'ws://near.test:80'],
    ['near.test:1883', 'ws://near.test'],
    ['a.test', 'not a url'],
    // An unresolved variable has no host to compare.
    ['a.test', '{{baseUrl}}/x'],
  ])('%j does not cover %s', (list, url) => {
    expect(isProxyBypassed(list, url)).toBe(false)
  })
})
