/**
 * A proxy password this machine cannot decrypt reaches the Settings form as empty.
 * Any Save then sent that empty value back and the stored ciphertext was gone, even
 * when the keychain was only unavailable for a while. Database secrets already had
 * this rule (`keepUndecryptable`); settings.json did not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, makeElectronMock, setupHandlerHarness } from './helpers'

const harness = setupHandlerHarness()

/** Ciphertext names the key it was sealed with; another key cannot open it. */
const keychain = vi.hoisted(() => ({ key: 1 }))
vi.mock('electron', () => ({
  ...makeElectronMock(),
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`${keychain.key}:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => {
      const [key, ...rest] = b.toString('utf-8').split(':')
      if (Number(key) !== keychain.key) throw new Error('wrong key')
      return rest.join(':')
    },
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

class FakeStore {
  store: Record<string, unknown>
  constructor(opts: { defaults?: Record<string, unknown> }) {
    this.store = { ...(opts.defaults ?? {}) }
  }
  get(key: string): unknown {
    return this.store[key]
  }
  set(key: string, value: unknown): void {
    this.store[key] = value
  }
  clear(): void {
    this.store = {}
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerSettingsHandlers } = await import('../../../src/main/ipc/settings.handler')

type Proxy = { mode: string; host?: string; auth?: { username: string; password: string | null } }
const PROJECT_KEY = 'project.p1.settings'

async function get<T>(key: string): Promise<T> {
  const res = (await harness.invoke('settings:get', key)) as { success: boolean; data?: T }
  expect(res.success).toBe(true)
  return res.data as T
}

function proxy(password: string): Proxy {
  return { mode: 'custom', host: 'p.test', auth: { username: 'alice', password } }
}

beforeEach(() => {
  testDb = createTestDb()
  keychain.key = 1
  harness.reset()
  registerSettingsHandlers()
})

describe('app proxy password the keychain cannot open', () => {
  it('survives a Save of the empty form and opens again with the keychain back', async () => {
    await harness.invoke('settings:setAll', { proxy: proxy('s3cret') })

    keychain.key = 2
    expect((await get<Proxy>('proxy')).auth?.password).toBeNull()
    await harness.invoke('settings:setAll', { proxy: proxy('') })

    keychain.key = 1
    expect((await get<Proxy>('proxy')).auth?.password).toBe('s3cret')
  })

  it('a new password typed meanwhile replaces it', async () => {
    await harness.invoke('settings:setAll', { proxy: proxy('s3cret') })

    keychain.key = 2
    await harness.invoke('settings:setAll', { proxy: proxy('n3w') })

    expect((await get<Proxy>('proxy')).auth?.password).toBe('n3w')
  })

  it('other fields of the Save still apply', async () => {
    await harness.invoke('settings:setAll', { proxy: proxy('s3cret') })

    keychain.key = 2
    await harness.invoke('settings:setAll', { proxy: { ...proxy(''), host: 'q.test' } })

    keychain.key = 1
    const saved = await get<Proxy>('proxy')
    expect(saved.host).toBe('q.test')
    expect(saved.auth?.password).toBe('s3cret')
  })
})

describe('with a working keychain', () => {
  it('clearing the password still clears it', async () => {
    await harness.invoke('settings:setAll', { proxy: proxy('s3cret') })
    await harness.invoke('settings:setAll', { proxy: proxy('') })
    expect((await get<Proxy>('proxy')).auth?.password).toBeNull()
  })
})

describe('project proxy password the keychain cannot open', () => {
  it('survives a Save of the empty form', async () => {
    await harness.invoke('settings:set', PROJECT_KEY, { proxy: proxy('s3cret') })

    keychain.key = 2
    await harness.invoke('settings:set', PROJECT_KEY, { proxy: proxy('') })

    keychain.key = 1
    expect((await get<{ proxy: Proxy }>(PROJECT_KEY)).proxy.auth?.password).toBe('s3cret')
  })

  it('"Use app setting" still removes the project proxy', async () => {
    await harness.invoke('settings:set', PROJECT_KEY, { proxy: proxy('s3cret') })

    keychain.key = 2
    await harness.invoke('settings:set', PROJECT_KEY, { proxy: null })

    keychain.key = 1
    expect((await get<{ proxy?: Proxy }>(PROJECT_KEY)).proxy).toBeUndefined()
  })
})
