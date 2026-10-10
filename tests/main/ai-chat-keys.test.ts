/**
 * Issue #188 — AI Chat provider keys at rest: encrypted with safeStorage in
 * main, one per scope, never plaintext (not even as the fallback
 * `encryptSecret` uses), and only `enc:v1:` values are ever read back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const keychain = vi.hoisted(() => ({ available: true, throws: false }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    encryptString: (s: string): Buffer => {
      if (keychain.throws) throw new Error('keychain locked')
      return Buffer.from(s).reverse()
    },
    decryptString: (b: Buffer): string => Buffer.from(b).reverse().toString('utf8'),
  },
}))

import {
  AI_KEYS_STORE_KEY,
  getAiKey,
  setAiKey,
  setAiKeyStoreForTests,
} from '../../src/main/lib/ai-chat-keys'

let data: Record<string, unknown>

beforeEach(() => {
  keychain.available = true
  keychain.throws = false
  data = {}
  setAiKeyStoreForTests({
    get: (k) => data[k],
    set: (k, v) => {
      data[k] = v
    },
  })
})

const stored = (): Record<string, string> => (data[AI_KEYS_STORE_KEY] ?? {}) as Record<string, string>

describe('setAiKey / getAiKey', () => {
  it('stores per scope as enc:v1: ciphertext and reads it back', async () => {
    await setAiKey('openai', 'sk-o')
    await setAiKey('custom:https://gw.example', 'sk-c')
    expect(Object.keys(stored()).sort()).toEqual(['custom:https://gw.example', 'openai'])
    for (const v of Object.values(stored())) expect(v.startsWith('enc:v1:')).toBe(true)
    expect(JSON.stringify(data)).not.toMatch(/sk-o|sk-c/)
    expect((await getAiKey('openai')).key).toBe('sk-o')
    expect((await getAiKey('custom:https://gw.example')).key).toBe('sk-c')
    expect((await getAiKey('anthropic')).key).toBe('')
  })

  it('a blank key removes the entry', async () => {
    await setAiKey('openai', 'sk-o')
    const res = await setAiKey('openai', '')
    expect(res.persisted).toBe(true)
    expect(stored()).toEqual({})
  })

  it('never writes plaintext when encryption is unavailable or throws', async () => {
    keychain.available = false
    expect(await setAiKey('openai', 'sk-plain-1')).toEqual({
      persisted: false,
      encryptionAvailable: false,
    })
    keychain.available = true
    keychain.throws = true
    expect((await setAiKey('openai', 'sk-plain-2')).persisted).toBe(false)
    expect(JSON.stringify(data)).not.toMatch(/sk-plain/)
  })

  it('ignores a plaintext value someone left in the map (only enc:v1: is trusted)', async () => {
    data[AI_KEYS_STORE_KEY] = { openai: 'sk-plaintext-left-over' }
    expect((await getAiKey('openai')).key).toBe('')
    // The next write drops it.
    await setAiKey('anthropic', 'sk-a')
    expect(Object.keys(stored())).toEqual(['anthropic'])
  })

  it('rejects an empty or oversized scope', async () => {
    await expect(setAiKey('', 'x')).rejects.toThrow(/scope/)
    await expect(getAiKey('x'.repeat(5000))).rejects.toThrow(/scope/)
  })
})
