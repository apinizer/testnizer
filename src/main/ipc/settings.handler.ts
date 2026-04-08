import { ipcMain } from 'electron'

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
    mode: 'system'
  },
  autoUpdate: true
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
    defaults
  }) as unknown as StoreInstance
  return storeInstance
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:getAll', async () => {
    try {
      const store = await getStore()
      const data = store.store
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('settings:get', async (_event, key: string) => {
    try {
      const store = await getStore()
      const data = store.get(key)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    try {
      const store = await getStore()
      store.set(key, value)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('settings:setAll', async (_event, settings: Partial<AppSettings>) => {
    try {
      const store = await getStore()
      for (const [key, value] of Object.entries(settings)) {
        store.set(key, value)
      }
      return { success: true, data: store.store }
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
