/**
 * AI Chat provider API keys at rest (issue #188).
 *
 * The keys live in the main process only, encrypted with Electron safeStorage
 * (OS keychain), inside the `settings` electron-store under one key —
 * {@link AI_KEYS_STORE_KEY} — as a map `scope → "enc:v1:…"`. A scope is the
 * provider id, or `custom:<base URL>` for the Custom provider (see the
 * renderer's `aiKeyScope`).
 *
 * Rules:
 *   - Nothing is ever written in plaintext. When safeStorage cannot encrypt
 *     (headless Linux without libsecret, locked keychain) `setAiKey` writes
 *     nothing and reports `persisted: false`; the renderer keeps the key in
 *     memory for the session and tells the user.
 *   - Only `enc:v1:` values are read back; anything else in the map is ignored.
 *   - The map's keys are not in the settings handler's `SENSITIVE_FIELDS`, so
 *     the generic `settings:get` never decrypts them — a renderer reading
 *     `settings:get('aiChatApiKeys')` sees ciphertext only.
 *
 * electron-store is ESM-only and must stay a dynamic import (v1.4.19 class,
 * guarded by tests/main/jwks.test.ts).
 */
import {
  decryptSecret,
  encryptSecretStrict,
  isEncryptedSecret,
  isEncryptionAvailable,
} from './secure-storage'

export const AI_KEYS_STORE_KEY = 'aiChatApiKeys'

/** Upper bound on a scope string — a provider id or `custom:` + a URL. */
const MAX_SCOPE_LENGTH = 2048

interface KeyStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

let override: KeyStore | null | undefined
let storePromise: Promise<KeyStore | null> | null = null

/** Test seam: an in-memory store (or `null` = no store); `undefined` restores electron-store. */
export function setAiKeyStoreForTests(store: KeyStore | null | undefined): void {
  override = store
  storePromise = null
}

async function getStore(): Promise<KeyStore | null> {
  if (override !== undefined) return override
  if (!storePromise) {
    storePromise = (async () => {
      try {
        const { default: Store } = await import('electron-store')
        // The settings file the settings handler writes (local app data only).
        return new Store({ name: 'settings' }) as unknown as KeyStore
      } catch {
        return null
      }
    })()
  }
  return storePromise
}

function validScope(scope: unknown): scope is string {
  return typeof scope === 'string' && scope.length > 0 && scope.length <= MAX_SCOPE_LENGTH
}

function mapOf(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isEncryptedSecret(v)) out[k] = v
  }
  return out
}

export interface AiKeyRead {
  /** Decrypted key, '' when none is stored (or it cannot be decrypted). */
  key: string
  encryptionAvailable: boolean
}

export interface AiKeyWrite {
  /** True when the key is now on disk encrypted (or a blank key was removed). */
  persisted: boolean
  encryptionAvailable: boolean
}

export async function getAiKey(scope: string): Promise<AiKeyRead> {
  const encryptionAvailable = isEncryptionAvailable()
  if (!validScope(scope)) throw new Error('Invalid key scope')
  const store = await getStore()
  if (!store || !encryptionAvailable) return { key: '', encryptionAvailable }
  const stored = mapOf(store.get(AI_KEYS_STORE_KEY))[scope]
  return { key: stored ? (decryptSecret(stored) ?? '') : '', encryptionAvailable }
}

/**
 * Store `key` for `scope` encrypted; a blank key removes the entry. Never
 * writes plaintext — see the module comment.
 */
export async function setAiKey(scope: string, key: string): Promise<AiKeyWrite> {
  if (!validScope(scope)) throw new Error('Invalid key scope')
  if (typeof key !== 'string') throw new Error('Invalid key')
  const encryptionAvailable = isEncryptionAvailable()
  const store = await getStore()
  if (!store) return { persisted: false, encryptionAvailable }
  const all = mapOf(store.get(AI_KEYS_STORE_KEY))
  if (key === '') {
    delete all[scope]
    store.set(AI_KEYS_STORE_KEY, all)
    return { persisted: true, encryptionAvailable }
  }
  const sealed = encryptSecretStrict(key)
  if (!sealed) return { persisted: false, encryptionAvailable: false }
  all[scope] = sealed
  store.set(AI_KEYS_STORE_KEY, all)
  return { persisted: true, encryptionAvailable: true }
}
