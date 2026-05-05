import { ipcMain } from 'electron'
import { encryptSecret, decryptSecret } from '../lib/secure-storage'

// Field names that must never be written in plaintext. When writing/reading
// structured settings values we transparently run safeStorage encryption
// on any field whose key matches this set.
const SENSITIVE_FIELDS = new Set(['token', 'password', 'passphrase', 'secret', 'apiKey', 'api_key'])

function transformSecrets(value: unknown, mode: 'encrypt' | 'decrypt'): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    return value.map((v) => transformSecrets(v, mode))
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(source)) {
      if (SENSITIVE_FIELDS.has(k) && typeof v === 'string') {
        out[k] = mode === 'encrypt' ? encryptSecret(v) : decryptSecret(v)
      } else {
        out[k] = transformSecrets(v, mode)
      }
    }
    return out
  }
  return value
}

interface AppSettings {
  theme: string
  language: string
  fontSize: number
  defaultTimeout: number
  sslVerification: boolean
  followRedirects: boolean
  historyLimit: number
  proxy: {
    mode: string
    host?: string
    port?: number
    auth?: { username: string; password: string }
    ntlm?: { domain?: string }
  }
  autoUpdate: boolean
  /**
   * Crash + error reporting via Sentry. **Default off** — opt-in only.
   * When `true`, the main process initializes @sentry/electron at next
   * launch with the DSN configured at build time. No data leaves the user's
   * machine while this flag is false.
   */
  telemetryEnabled: boolean
}

const defaults: AppSettings = {
  theme: 'light',
  language: 'en',
  fontSize: 13,
  defaultTimeout: 30000,
  sslVerification: true,
  followRedirects: true,
  historyLimit: 500,
  proxy: {
    mode: 'system',
  },
  autoUpdate: true,
  telemetryEnabled: false,
}

interface StoreInstance {
  store: AppSettings
  get(key: string): unknown
  set(key: string, value: unknown): void
  clear(): void
}

let storeInstance: StoreInstance | null = null

async function getStore(): Promise<StoreInstance> {
  if (storeInstance) return storeInstance
  const { default: Store } = await import('electron-store')
  storeInstance = new Store<AppSettings>({
    name: 'settings',
    defaults,
  }) as unknown as StoreInstance
  return storeInstance
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:getAll', async () => {
    try {
      const store = await getStore()
      const data = transformSecrets(store.store, 'decrypt') as AppSettings
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('settings:get', async (_event, key: string) => {
    try {
      const store = await getStore()
      const data = transformSecrets(store.get(key), 'decrypt')
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    try {
      const store = await getStore()
      store.set(key, transformSecrets(value, 'encrypt'))
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('settings:setAll', async (_event, settings: Partial<AppSettings>) => {
    try {
      const store = await getStore()
      for (const [key, value] of Object.entries(settings)) {
        store.set(key, transformSecrets(value, 'encrypt'))
      }
      return { success: true, data: transformSecrets(store.store, 'decrypt') }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('settings:reset', async () => {
    try {
      const store = await getStore()
      store.clear()
      return { success: true, data: store.store }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
