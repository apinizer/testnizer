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
  /**
   * Project "general" request timeout (ms, 0 = none) — the second link of the
   * HTTP timeout chain Send and Run share (`resolveHttpTimeout`, issue #185).
   */
  requestTimeout?: number
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

/**
 * App-wide "general" timeout (Settings → `defaultTimeout`, ms) — the last link
 * of the HTTP timeout chain before the engine's own 30 s (issue #185). The
 * renderer's Send reads it through `settings:get`, whose store carries the
 * handler's `defaults` (30000); this store has none, so a never-saved value
 * comes back `undefined` and the engine default (also 30 s) applies — the
 * same number either way.
 */
export async function loadAppDefaultTimeout(): Promise<number | undefined> {
  try {
    const store = await getStore()
    const raw = store.get('defaultTimeout')
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined
  } catch {
    return undefined
  }
}
