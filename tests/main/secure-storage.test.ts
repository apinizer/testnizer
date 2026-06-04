import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub the `electron` module so secure-storage.ts can be imported in a
// non-Electron Vitest environment. We expose a configurable `safeStorage`
// double per test case to exercise the encrypted, unavailable, and error
// branches independently.
let mockAvailable = true
let mockShouldThrow = false

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockAvailable,
    encryptString: (plaintext: string): Buffer => {
      if (mockShouldThrow) throw new Error('keychain locked')
      // Reversible "encryption" purely for the test — reverse the bytes.
      return Buffer.from(plaintext).reverse()
    },
    decryptString: (buf: Buffer): string => {
      if (mockShouldThrow) throw new Error('keychain locked')
      return Buffer.from(buf).reverse().toString('utf8')
    },
  },
}))

import { encryptSecret, decryptSecret, isEncryptionAvailable } from '../../src/main/lib/secure-storage'

beforeEach(() => {
  mockAvailable = true
  mockShouldThrow = false
})

describe('encryptSecret', () => {
  it('returns null for null/undefined/empty', () => {
    expect(encryptSecret(null)).toBeNull()
    expect(encryptSecret(undefined)).toBeNull()
    expect(encryptSecret('')).toBeNull()
  })

  it('produces a prefixed encrypted string', () => {
    const out = encryptSecret('hello')
    expect(out).not.toBeNull()
    expect(out!.startsWith('enc:v1:')).toBe(true)
  })

  it('is idempotent on already-encrypted values', () => {
    const once = encryptSecret('hello')!
    const twice = encryptSecret(once)
    expect(twice).toBe(once)
  })

  it('falls back to plaintext when encryption unavailable', () => {
    mockAvailable = false
    expect(encryptSecret('hello')).toBe('hello')
  })

  it('falls back to plaintext when keychain throws', () => {
    mockShouldThrow = true
    expect(encryptSecret('hello')).toBe('hello')
  })
})

describe('decryptSecret', () => {
  it('returns null for null/undefined/empty', () => {
    expect(decryptSecret(null)).toBeNull()
    expect(decryptSecret(undefined)).toBeNull()
    expect(decryptSecret('')).toBeNull()
  })

  it('passes legacy plaintext through unchanged', () => {
    expect(decryptSecret('legacy-plain')).toBe('legacy-plain')
  })

  it('round-trips through encryptSecret', () => {
    const enc = encryptSecret('hello world')
    expect(decryptSecret(enc)).toBe('hello world')
  })

  it('returns null when encryption unavailable on encrypted value', () => {
    const enc = encryptSecret('hello')!
    mockAvailable = false
    expect(decryptSecret(enc)).toBeNull()
  })

  it('returns null when decrypt throws', () => {
    const enc = encryptSecret('hello')!
    mockShouldThrow = true
    expect(decryptSecret(enc)).toBeNull()
  })
})

describe('isEncryptionAvailable', () => {
  it('returns true on supported platforms', () => {
    expect(isEncryptionAvailable()).toBe(true)
  })

  it('returns false when safeStorage reports unavailable', () => {
    mockAvailable = false
    expect(isEncryptionAvailable()).toBe(false)
  })
})
