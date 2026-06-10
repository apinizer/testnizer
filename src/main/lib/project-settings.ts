/**
 * Read a project's saved settings (project-level auth + pre/test scripts) that
 * the renderer's ProjectDetailModal persists to electron-store under the key
 * `project.<id>.settings`.
 *
 * The Collection Runner (main process) needs these to resolve a request's
 * inherited auth and to run the cascade pre/test scripts (project → folder →
 * request). The Send path reads the same key from the renderer side; this is the
 * main-process mirror — keep the two in lockstep (the same "paralellik" class as
 * env-vars / header-assertions in CLAUDE.md).
 *
 * Best-effort by design: any failure (no store yet, headless/test environment)
 * resolves to `undefined`, so the runner cleanly falls back to per-request
 * behavior instead of throwing.
 */

export interface StoredProjectAuth {
  type?: 'none' | 'inherit' | 'basic' | 'bearer' | 'api-key'
  bearerToken?: string
  basicUser?: string
  basicPass?: string
  apiKeyKey?: string
  apiKeyValue?: string
  apiKeyIn?: 'header' | 'query'
}

export interface StoredProjectSettings {
  auth?: StoredProjectAuth
  preScript?: string
  testScript?: string
}

interface MinimalStore {
  get(key: string): unknown
}

let storeInstance: MinimalStore | null = null

async function getStore(): Promise<MinimalStore> {
  if (storeInstance) return storeInstance

  const { default: Store } = await import('electron-store')
  // Same store file ('settings') the settings handler writes to, so we read the
  // exact rows ProjectDetailModal saved.
  storeInstance = new Store({ name: 'settings' }) as unknown as MinimalStore
  return storeInstance
}

export async function loadProjectSettings(
  projectId: string,
): Promise<StoredProjectSettings | undefined> {
  if (!projectId) return undefined
  try {
    const store = await getStore()
    const raw = store.get(`project.${projectId}.settings`)
    if (!raw || typeof raw !== 'object') return undefined
    // ProjectAuth's secret-ish fields (bearerToken/basicPass/apiKeyValue) are
    // NOT in the settings handler's SENSITIVE_FIELDS set, so they're stored in
    // plaintext — no decrypt step needed. If that ever changes, mirror the
    // settings handler's transformSecrets('decrypt') here.
    return raw as StoredProjectSettings
  } catch {
    return undefined
  }
}
