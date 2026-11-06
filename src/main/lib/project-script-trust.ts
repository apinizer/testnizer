/**
 * Consent for project scripts on this computer. Scripts are NOT sandboxed: a
 * project that came from git or a file can run code here. A project that came
 * from outside therefore does not run scripts until the user allows it.
 *
 * State: the BLOCKED project ids, in the LOCAL settings store (electron-store
 * `settings.json`, key below) and never in the database, the project file, git
 * or an export. Absence means allowed, so existing and locally created projects
 * need no migration and there is no second state.
 *
 * Only main writes it. `settings:set` / `setAll` refuse the key and
 * `settings:reset` keeps it (`settings.handler.ts`). `allowProjectScripts` has
 * one production caller: the click in the `projectTrust:ensure` dialog.
 *
 * Reads come from memory: the list is loaded once and every write goes to memory
 * first, then to the store. So an Allow whose store write fails still holds for
 * this session, and the per-request mock check is a Set lookup, not a file read.
 * A store that cannot be loaded starts empty: a block written earlier is not
 * seen until it loads again (known limit), and nothing is written over it.
 */

export const PROJECT_SCRIPT_BLOCKS_STORE_KEY = 'projectScriptBlocks'

/** Run-row text of a script that was not evaluated (same style as stdio trust). */
export const PROJECT_SCRIPTS_BLOCKED_MESSAGE =
  'Scripts from this project are not allowed on this computer. Start the run from its tab and choose Allow, or allow them in Project Settings.'

/** Mock answer + log text of a response script that was not evaluated. */
export const MOCK_SCRIPT_BLOCKED_MESSAGE =
  'This response script did not run: scripts from this project are not allowed on this computer. Allow them in Project Settings.'

interface TrustStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

const blocked = new Set<string>()
let override: TrustStore | null | undefined
let storePromise: Promise<TrustStore | null> | null = null
let loadPromise: Promise<void> | null = null
/** Set once the list was read. Unset = unreadable: writing memory over it would lose it. */
let loadedStore: TrustStore | null = null

/** Test seam: an in-memory store (or `null` = no store); `undefined` restores electron-store. */
export function setProjectScriptTrustStoreForTests(store: TrustStore | null | undefined): void {
  override = store
  storePromise = null
  loadPromise = null
  loadedStore = null
  blocked.clear()
}

async function getStore(): Promise<TrustStore | null> {
  if (override !== undefined) return override
  if (!storePromise) {
    storePromise = (async () => {
      try {
        const { default: Store } = await import('electron-store')
        // The settings file the settings handler writes (local app data only).
        return new Store({ name: 'settings' }) as unknown as TrustStore
      } catch {
        return null
      }
    })()
  }
  return storePromise
}

/** Called at startup too, so the store is ready before anything is imported. */
export function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const store = await getStore()
        if (!store) return
        const raw = store.get(PROJECT_SCRIPT_BLOCKS_STORE_KEY)
        if (Array.isArray(raw)) {
          for (const id of raw) if (typeof id === 'string') blocked.add(id)
        }
        loadedStore = store
      } catch {
        /* unreadable: memory only for this session */
      }
    })()
  }
  return loadPromise
}

function persist(): void {
  try {
    loadedStore?.set(PROJECT_SCRIPT_BLOCKS_STORE_KEY, [...blocked])
  } catch {
    /* memory still holds it for this session */
  }
}

/** The key, or a dotted path into it (electron-store reads dots as paths). */
export function isProjectScriptBlocksKey(key: unknown): boolean {
  return (
    typeof key === 'string' &&
    (key === PROJECT_SCRIPT_BLOCKS_STORE_KEY ||
      key.startsWith(`${PROJECT_SCRIPT_BLOCKS_STORE_KEY}.`))
  )
}

export async function isProjectScriptsBlocked(projectId: string): Promise<boolean> {
  await ensureLoaded()
  return blocked.has(projectId)
}

/**
 * Safe direction. Called before the incoming rows are written. Never rejects.
 *
 * Synchronous up to the first await on purpose: `importProjectData` writes its
 * rows in the same tick and its callers rely on that. Memory is set at once, and
 * so is the disk once the store is loaded (at startup, `registerProjectTrustHandlers`).
 */
export function blockProjectScripts(projectId: string): Promise<void> {
  blocked.add(projectId)
  persist()
  return loadedStore ? Promise.resolve() : ensureLoaded().then(persist)
}

/**
 * Clears the block. In production only for the Allow click in main, and for an
 * import that turned out to bring no script (`withImportScriptCheck`).
 */
export async function allowProjectScripts(projectId: string): Promise<void> {
  await ensureLoaded()
  if (blocked.delete(projectId)) persist()
}

/** The project is gone: forget it. */
export const dropProjectScriptTrust = allowProjectScripts

/** A duplicate is as trusted as its source (called before the copy's rows are written). */
export async function copyProjectScriptTrust(fromId: string, toId: string): Promise<void> {
  if (await isProjectScriptsBlocked(fromId)) await blockProjectScripts(toId)
}

/**
 * An import into an EXISTING project: blocked only if it added or changed a
 * script, which is known only afterwards. So the block goes on BEFORE any row is
 * written (a running mock reloads off the new rows before the import returns)
 * and comes off if the import brought no new script. A crash in between, or a
 * digest that cannot be read, leaves it blocked: the safe side.
 */
export async function withImportScriptCheck<T>(
  projectId: string,
  readFingerprints: () => readonly string[],
  run: () => T | Promise<T>,
): Promise<T> {
  const wasBlocked = await isProjectScriptsBlocked(projectId)
  let before: Set<string> | null = null
  try {
    before = new Set(readFingerprints())
  } catch {
    before = null
  }
  await blockProjectScripts(projectId)
  try {
    return await run()
  } finally {
    if (!wasBlocked && before) {
      const known = before
      let unchanged = false
      try {
        unchanged = readFingerprints().every((f) => known.has(f))
      } catch {
        unchanged = false
      }
      if (unchanged) await allowProjectScripts(projectId)
    }
  }
}

/** The UI language for the native prompt (`ui.locale`; the renderer defaults to 'en'). */
export async function promptLocale(): Promise<'en' | 'tr'> {
  try {
    const store = await getStore()
    return store?.get('ui.locale') === 'tr' ? 'tr' : 'en'
  } catch {
    return 'en'
  }
}
