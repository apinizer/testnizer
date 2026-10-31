/**
 * Read a project's saved settings (project-level auth + pre/test scripts) that
 * the renderer's ProjectDetailModal persists under the key
 * `project.<id>.settings`.
 *
 * ONE OWNER for the split (git fidelity): the settings that travel with the
 * project — `SHARED_PROJECT_SETTING_KEYS` — live in the `projects.
 * shared_settings` column, so they reach the project file, git, Duplicate
 * and a teammate's Pull like every other project row. The rest (proxy,
 * working directory, UI / updater flags) is per machine and stays in
 * electron-store. `settings:get` / `settings:set` for that key and the
 * Runner below all go through `mergeProjectSettings` /
 * `splitProjectSettings`, so the renderer still reads and writes one object.
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

import { getDb } from '../db/database'

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
  /**
   * Issue #287: the Certificates pane's "SSL certificate verification" and the
   * General pane's "Follow redirects" — the project link of
   * `resolveSslVerification` / `resolveFollowRedirects`. Absent = inherit the
   * app Settings value.
   */
  sslVerification?: boolean
  followRedirects?: boolean
  /** TLS protocol / cipher overrides (Certificates pane) — `resolveTlsPayload`. */
  tls?: {
    minVersion?: string
    maxVersion?: string
    cipherPreset?: 'modern' | 'intermediate' | 'legacy' | 'custom'
    ciphersCustom?: string
  }
  /**
   * Machine-local proxy (Proxy pane). `auth.password` is stored ENCRYPTED
   * (settings handler `SENSITIVE_FIELDS`) — decrypt before use.
   */
  proxy?: {
    mode?: 'system' | 'none' | 'custom'
    host?: string
    port?: number
    auth?: { username: string; password: string }
  }
  /**
   * Machine-local folder relative form-data / binary file paths resolve
   * against (`lib/working-directory.ts`, issue #276). Not shared: a folder on
   * one computer means nothing on another.
   */
  workingDirectory?: string
}

interface MinimalStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

/** Settings that describe the requests themselves, so the whole team needs them. */
export const SHARED_PROJECT_SETTING_KEYS = [
  'auth',
  'preScript',
  'testScript',
  'requestTimeout',
  'sslVerification',
  'followRedirects',
  'tls',
] as const

const SHARED = new Set<string>(SHARED_PROJECT_SETTING_KEYS)
const SETTINGS_KEY = /^project\.([^.]+)\.settings$/

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** `project.<id>.settings` → `<id>`; null for any other key. */
export function projectIdOfSettingsKey(key: unknown): string | null {
  if (typeof key !== 'string') return null
  return SETTINGS_KEY.exec(key)?.[1] ?? null
}

/** One settings object → its shared part (null when it has none) and its local part. */
export function splitProjectSettings(value: unknown): { shared: Obj | null; local: unknown } {
  if (!isObj(value)) return { shared: null, local: value }
  const shared: Obj = {}
  const local: Obj = {}
  for (const [k, v] of Object.entries(value)) (SHARED.has(k) ? shared : local)[k] = v
  return { shared: Object.keys(shared).length > 0 ? shared : null, local }
}

/**
 * What a reader sees: the local part with the shared part over it. `shared`
 * null (never written to the DB) → the stored object as it is.
 */
export function mergeProjectSettings(local: unknown, shared: Obj | null): unknown {
  if (!shared) return local
  return { ...(isObj(local) ? (splitProjectSettings(local).local as Obj) : {}), ...shared }
}

/** The project's shared settings from the DB, or null. */
export function readSharedProjectSettings(projectId: string): Obj | null {
  const row = getDb()
    .prepare('SELECT shared_settings FROM projects WHERE id = ?')
    .get(projectId) as { shared_settings: string | null } | undefined
  if (!row?.shared_settings) return null
  try {
    const v = JSON.parse(row.shared_settings) as unknown
    return isObj(v) ? v : null
  } catch {
    return null
  }
}

/**
 * Shared keys a project may hand back to the app Settings (issue #254, "Use
 * app setting"). For these, `null` in a save is an explicit DELETE marker —
 * omission keeps meaning "leave it alone", so a reset needs its own value.
 */
export const INHERITABLE_SHARED_KEYS = [
  'requestTimeout',
  'sslVerification',
  'followRedirects',
] as const
const INHERITABLE = new Set<string>(INHERITABLE_SHARED_KEYS)

/**
 * Write the shared part of a settings save; earlier shared keys the save omits
 * are kept. `null` on an inheritable key removes it (the null is never stored).
 */
export function writeSharedProjectSettings(projectId: string, shared: Obj): void {
  const next: Obj = { ...(readSharedProjectSettings(projectId) ?? {}), ...shared }
  for (const k of INHERITABLE) if (next[k] === null) delete next[k]
  getDb()
    .prepare('UPDATE projects SET shared_settings = ? WHERE id = ?')
    .run(JSON.stringify(next), projectId)
}

/**
 * One-time move for installs from before `shared_settings`: a project whose
 * column is still NULL and whose electron-store settings hold shared keys
 * gets them written to the DB (and dropped from the store). Idempotent —
 * the condition is false once done — and per-project best effort.
 */
export function migrateProjectSettingsToDb(store: MinimalStore): number {
  let moved = 0
  const rows = getDb().prepare('SELECT id FROM projects WHERE shared_settings IS NULL').all() as {
    id: string
  }[]
  for (const { id } of rows) {
    try {
      const key = `project.${id}.settings`
      const { shared, local } = splitProjectSettings(store.get(key))
      if (!shared) continue
      writeSharedProjectSettings(id, shared)
      store.set(key, local)
      moved++
    } catch {
      /* leave this project for the next start */
    }
  }
  return moved
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
    const raw = mergeProjectSettings(
      store.get(`project.${projectId}.settings`),
      readSharedProjectSettings(projectId),
    )
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

/**
 * App-wide "SSL certificate verification" and "Follow redirects" (Settings
 * modal, top-level keys) — the last link of `resolveSslVerification` /
 * `resolveFollowRedirects` before their `true` default (issue #287). A value
 * never saved comes back `undefined` (this store has no defaults) and the
 * resolver's `true` applies — what the settings handler's defaults say too.
 */
export async function loadAppNetworkDefaults(): Promise<{
  sslVerification?: boolean
  followRedirects?: boolean
  /**
   * App Settings proxy (issue #254) — the fallback below the project's own.
   * As stored: `auth.password` is ENCRYPTED (settings handler
   * `SENSITIVE_FIELDS`); `inheritedNetworkFor` decrypts it.
   */
  proxy?: StoredProjectSettings['proxy']
}> {
  try {
    const store = await getStore()
    const ssl = store.get('sslVerification')
    const follow = store.get('followRedirects')
    const proxy = store.get('proxy')
    return {
      ...(typeof ssl === 'boolean' ? { sslVerification: ssl } : {}),
      ...(typeof follow === 'boolean' ? { followRedirects: follow } : {}),
      ...(isObj(proxy) ? { proxy: proxy as StoredProjectSettings['proxy'] } : {}),
    }
  } catch {
    return {}
  }
}
