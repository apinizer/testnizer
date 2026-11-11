/**
 * Tester report 2026-11-11, finding 3 — proxy credentials typed and then
 * cleared. ONE rule (`proxyCredentials`, src/shared/request-settings.ts) for
 * every consumer: both fields empty = no proxy authentication; one filled =
 * a credential (a password-only proxy login is valid — the app Settings form
 * and the engine already accept it); a missing / null half reads as ''.
 *
 * The settings handler stores an empty password as `null` (`encryptSecret('')`),
 * so `settings:get` hands the renderer `{username:'alice', password:null}`;
 * the realtime CONNECT tunnel used to turn that into `alice:null`.
 */
import { describe, expect, it } from 'vitest'
import {
  proxyCredentials,
  resolveProxy,
  type ProxySetting,
} from '../../src/shared/request-settings'
import { resolveConnectionProxy } from '../../src/main/lib/proxy-tunnel'
import { buildCurlArgs } from '../../src/main/protocols/curl-shim'

const base: ProxySetting = { mode: 'custom', host: 'p.test', port: 3128 }
/** What IPC really delivers for a cleared password: null, not ''. */
const withNullPassword = (username: string): ProxySetting =>
  ({ ...base, auth: { username, password: null } }) as unknown as ProxySetting

describe('proxyCredentials — the one rule', () => {
  it('both empty, absent or null = no credentials', () => {
    expect(proxyCredentials(undefined)).toBeUndefined()
    expect(proxyCredentials({ username: '', password: '' })).toBeUndefined()
    expect(proxyCredentials({ username: null, password: null } as never)).toBeUndefined()
  })

  it('one half filled is a credential, the other half ""', () => {
    expect(proxyCredentials({ username: 'alice', password: null } as never)).toEqual({
      username: 'alice',
      password: '',
    })
    expect(proxyCredentials({ username: '', password: 'pw' })).toEqual({
      username: '',
      password: 'pw',
    })
  })
})

describe('resolveProxy — Send, realtime (renderer) and Run (main) share it', () => {
  it('drops an empty auth object, keeps every other key', () => {
    const p: ProxySetting = {
      ...base,
      bypass: 'a.test',
      proxyType: 'http',
      auth: { username: '', password: '' },
    }
    expect(resolveProxy(p, undefined)).toEqual({
      mode: 'custom',
      host: 'p.test',
      port: 3128,
      bypass: 'a.test',
      proxyType: 'http',
    })
    expect(resolveProxy(undefined, p)).not.toHaveProperty('auth')
  })

  it('a real credential is kept', () => {
    const p: ProxySetting = { ...base, auth: { username: 'u', password: 'p' } }
    expect(resolveProxy(p, undefined)?.auth).toEqual({ username: 'u', password: 'p' })
  })
})

describe('realtime CONNECT tunnel', () => {
  it('a cleared password is "", never the text "null"', () => {
    expect(resolveConnectionProxy(withNullPassword('alice'), 'ws://s.test')?.auth).toEqual({
      username: 'alice',
      password: '',
    })
  })

  it('both cleared = no Proxy-Authorization', () => {
    expect(resolveConnectionProxy(withNullPassword(''), 'ws://s.test')).toEqual({
      origin: 'http://p.test:3128',
    })
  })
})

describe('legacy-TLS curl sidecar (Send and Run both reach it through the engine)', () => {
  const input = {
    url: 'https://legacy.test/api',
    method: 'GET',
    headers: {},
    bodyMode: 'none' as const,
    tls: {},
    sslVerification: true,
    followRedirects: true,
    timeoutMs: 30000,
    proxyDisabled: false,
    headersDumpPath: '/tmp/h.txt',
    bodyOutputPath: '/tmp/b.bin',
  }
  const proxyUser = (auth: unknown): string | undefined => {
    const args = buildCurlArgs({
      ...input,
      proxy: { host: 'p.test', port: 3128, auth: auth as { username: string; password: string } },
    })
    const i = args.indexOf('--proxy-user')
    return i < 0 ? undefined : args[i + 1]
  }

  it('both cleared = no --proxy-user', () => {
    expect(proxyUser({ username: '', password: '' })).toBeUndefined()
    expect(proxyUser({ username: '', password: null })).toBeUndefined()
  })

  it('a cleared password is "", never "null"', () => {
    expect(proxyUser({ username: 'alice', password: null })).toBe('alice:')
  })
})
