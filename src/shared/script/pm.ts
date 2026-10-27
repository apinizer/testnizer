/**
 * `createPm` — the ONE `pm` object both script paths run against (issue #281).
 *
 * Before this, Send (`test-runner.ts` createPmApi) and Run (`runner.handler.ts`
 * buildPm) each hand-built the variable scopes, `pm.test`, `pm.info`,
 * `pm.execution`, `pm.request` and `pm.sendRequest`, and they had drifted
 * (research D1–D12): a missing variable was `undefined` on Send but `''` on
 * Run, globals and local variables shared the environment map on Run,
 * `pm.info.eventName` was always 'test' on Run, `skipRequest()` stopped the
 * script on Send but not on Run.
 *
 * A host now supplies only what genuinely differs per path:
 *   - the variable backing stores (renderer Maps vs the runner's run state),
 *   - the `pm.sendRequest` transport (IPC vs direct engine call),
 *   - a console sink.
 * Everything a script can observe is built here, once.
 *
 * Postman semantics followed (learning.postman.com pm-variables / pm-execution /
 * pm-info, postman-collection VariableScope):
 *   - `get` of a missing key is `undefined` on every scope;
 *   - `pm.variables.get` precedence: local > data > environment > collection > global;
 *   - `pm.variables.set` writes a LOCAL variable;
 *   - `pm.execution.skipRequest()` is pre-request only and stops the script.
 *
 * Testnizer mapping (issue #281): a Testnizer project is the Postman
 * collection, so `pm.collectionVariables` and `pm.globals` are ONE scope — the
 * project variables ("Globals" list) — and `pm.vault` is the secret subset of
 * it. `pm.collectionVariables` used to alias `pm.environment`.
 */
import { expect as chaiExpect } from './expect'
import { createPmResponse } from './response'
import { HeaderCollection } from './headers'
import { createTestRecorder, drainPending, errorMessage, type TestRecorder } from './pm-test'
import { createPmRequestBody, PmUrl, type PmRequestBodyInput } from './pm-request'
import {
  buildPmSendResponse,
  normalizePmSendInput,
  type PmSendResponse,
  type PmSendTransport,
} from './send-request'
import { resolveTemplate } from '../dynamic-variables'
import type { PmLike, PmScope } from './pm-types'
import type { NormalizedResponse, ScriptTestResult } from './types'

export type PmEventName = 'prerequest' | 'test'

/** A mutable string store. `Map<string, string>` satisfies it. */
export interface PmVarStore {
  get(key: string): string | undefined
  has(key: string): boolean
  set(key: string, value: string): unknown
  delete(key: string): unknown
  keys(): Iterable<string>
}

/** One variable scope as the host keeps it. */
export interface PmScopeBacking {
  /** Live values the script reads and writes. */
  values: PmVarStore
  /** Write-through channel the host persists or propagates ('' = unset). */
  updates?: PmVarStore
}

/**
 * `pm.vault` backing: which project variables are SECRET. Their values live in
 * the globals (project-variable) scope like every other project variable, so
 * `{{name}}` and `pm.globals.get` see a vault write at once.
 */
export interface PmVaultBacking {
  /** Keys of the secret project variables. `Set<string>` satisfies it. */
  secretKeys: { has(key: string): boolean; add(key: string): unknown; delete(key: string): unknown }
  /**
   * Persistence channel the host applies AFTER its globals writes: a value =
   * create / update the project variable as secret; null = delete it. A key
   * written by a later `pm.globals` / `pm.collectionVariables` call leaves
   * this channel (that plain write is the last word). `Map` satisfies it.
   */
  updates: { set(key: string, value: string | null): unknown; delete(key: string): unknown }
}

/** Adapt a plain record (the runner's run state) to a PmVarStore. */
export function recordStore(obj: Record<string, string>): PmVarStore {
  return {
    get: (k) => (Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined),
    has: (k) => Object.prototype.hasOwnProperty.call(obj, k),
    set: (k, v) => {
      obj[k] = v
    },
    delete: (k) => {
      delete obj[k]
    },
    keys: () => Object.keys(obj),
  }
}

/** Thrown by `pm.execution.skipRequest()`; hosts treat it as a clean stop. */
export class SkipRequestSignal extends Error {
  constructor() {
    super('__pm_skip_request_signal__')
    this.name = 'SkipRequestSignal'
  }
}

export function isSkipRequestSignal(e: unknown): boolean {
  return (
    e instanceof SkipRequestSignal ||
    (e instanceof Error && e.message === '__pm_skip_request_signal__')
  )
}

export interface CreatePmOptions {
  eventName: PmEventName
  iteration?: number
  iterationCount?: number
  requestName?: string
  requestId?: string
  /** Folder names, outermost first, then the request name — `pm.execution.location`. */
  location?: string[]
  scopes: {
    /**
     * The project variables — `pm.globals` AND `pm.collectionVariables`
     * (issue #281: a Testnizer project is the Postman collection).
     */
    globals: PmScopeBacking
    environment: PmScopeBacking & { name?: string }
    /** Secret project variables (`pm.vault`). Omitted → `pm.vault` rejects. */
    vault?: PmVaultBacking
    locals: PmScopeBacking
    /** The iteration data row (Run); empty on Send. */
    data?: Record<string, string>
  }
  request: {
    method: string
    url: string
    headers: HeaderCollection
    body?: PmRequestBodyInput | null
    id?: string
    name?: string
  }
  /** Null in pre-request scope (and for Run hooks, which have no response). */
  response: NormalizedResponse | null
  /** `pm.sendRequest` transport for this path. */
  send: PmSendTransport
  /** Console sink for runtime notices and late async errors. */
  log: (level: 'log' | 'warn' | 'error', message: string) => void
  /** Overrides DONE_CALLBACK_TIMEOUT_MS (tests). */
  doneTimeoutMs?: number
  /** Host-owned sinks, so existing references stay valid. */
  results?: ScriptTestResult[]
  pendingTests?: Promise<void>[]
  pendingSends?: Promise<unknown>[]
}

export interface PmRuntimeState {
  skipRequested: boolean
  /** Set when the script called setNextRequest (null = stop the iteration). */
  nextRequest?: { name: string | null }
}

export interface PmRuntime {
  pm: PmLike
  recorder: TestRecorder
  results: ScriptTestResult[]
  pendingTests: Promise<void>[]
  pendingSends: Promise<unknown>[]
  state: PmRuntimeState
  /** Await every pending send and test (loops while either refills). */
  drain(): Promise<void>
}

/** Postman stores variables as strings; so do both paths now. */
function toVarString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === undefined || v === null) return ''
  if (typeof v === 'object') {
    // A Url-like value (pm.request.url) has a meaningful toString.
    const s = String(v)
    if (s !== '[object Object]') return s
    try {
      return JSON.stringify(v)
    } catch {
      return s
    }
  }
  return String(v)
}

/**
 * `replaceIn` accepts a string or (like Postman) an object/array whose string
 * leaves are replaced. `{{$dynamic}}` placeholders resolve too (research D12).
 */
function replaceInValue(value: unknown, lookup: (name: string) => string | undefined): unknown {
  if (typeof value === 'string') return resolveTemplate(value, lookup)
  if (Array.isArray(value)) return value.map((v) => replaceInValue(v, lookup))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = replaceInValue(v, lookup)
    return out
  }
  return value
}

function entriesOf(store: PmVarStore): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of store.keys()) {
    const v = store.get(k)
    if (v !== undefined) out[k] = v
  }
  return out
}

function makeScope(back: PmScopeBacking, onWrite?: (key: string) => void): PmScope {
  const scope: PmScope = {
    get: (k) => back.values.get(k),
    set: (k, v) => {
      const s = toVarString(v)
      back.values.set(k, s)
      back.updates?.set(k, s)
      onWrite?.(k)
    },
    has: (k) => back.values.has(k),
    unset: (k) => {
      back.values.delete(k)
      back.updates?.set(k, '')
      onWrite?.(k)
    },
    clear: () => {
      for (const k of Array.from(back.values.keys())) scope.unset(k)
    },
    toObject: () => entriesOf(back.values),
    replaceIn: (t) => replaceInValue(t, (k) => back.values.get(k)) as string,
  }
  return scope
}

export function createPm(opts: CreatePmOptions): PmRuntime {
  const results = opts.results ?? []
  const pendingTests = opts.pendingTests ?? []
  const pendingSends = opts.pendingSends ?? []
  const state: PmRuntimeState = { skipRequested: false }
  const isPreRequest = opts.eventName === 'prerequest'

  const recorder = createTestRecorder({
    results,
    pending: pendingTests,
    doneTimeoutMs: opts.doneTimeoutMs,
    onAsyncError: (e) => {
      // skipRequest() from a late callback still records the skip (below).
      if (!isSkipRequestSignal(e)) opts.log('error', `Script error: ${errorMessage(e)}`)
    },
  })

  // ── variable scopes ──
  const { scopes } = opts
  const vaultBack = scopes.vault
  // A plain project-variable write after a vault write is the last word.
  const globals = makeScope(scopes.globals, (k) => vaultBack?.updates.delete(k))
  const environment = Object.assign(makeScope(scopes.environment), {
    name: scopes.environment.name,
  })
  // ONE scope (issue #281): Postman collection variables are Testnizer project
  // variables. This used to fall back to the environment store.
  const collectionVariables = globals
  const locals = makeScope(scopes.locals)
  const data: Record<string, string> = { ...(scopes.data ?? {}) }
  const hasData = (k: string): boolean => Object.prototype.hasOwnProperty.call(data, k)

  /** Narrowest scope wins: local > data > environment > collection / global. */
  const lookup = (k: string): string | undefined => {
    if (scopes.locals.values.has(k)) return scopes.locals.values.get(k)
    if (hasData(k)) return data[k]
    if (scopes.environment.values.has(k)) return scopes.environment.values.get(k)
    if (scopes.globals.values.has(k)) return scopes.globals.values.get(k)
    return undefined
  }
  const variables: PmScope = {
    get: lookup,
    has: (k) => lookup(k) !== undefined,
    set: locals.set,
    unset: locals.unset,
    clear: locals.clear,
    toObject: () => ({
      ...globals.toObject(),
      ...environment.toObject(),
      ...data,
      ...locals.toObject(),
    }),
    replaceIn: (t) => replaceInValue(t, lookup) as string,
  }

  const iterationData = {
    get: (k: string): string | undefined => (hasData(k) ? data[k] : undefined),
    has: (k: string): boolean => hasData(k),
    toObject: (): Record<string, string> => ({ ...data }),
    toJSON: (): Record<string, string> => ({ ...data }),
    unset: (k: string): void => {
      delete data[k]
    },
  }

  // ── request ──
  const requestName = opts.requestName ?? opts.request.name ?? ''
  const request = {
    method: opts.request.method,
    url: new PmUrl(opts.request.url),
    headers: opts.request.headers,
    body: createPmRequestBody(opts.request.body),
    id: opts.request.id ?? opts.requestId,
    name: requestName,
  }

  // ── execution ──
  const locationList = opts.location && opts.location.length ? opts.location : [requestName]
  const location = Object.assign([...locationList], {
    current: locationList[locationList.length - 1] ?? '',
  })
  const execution = {
    skipRequest(): void {
      if (!isPreRequest) {
        throw new Error('pm.execution.skipRequest() is only available in pre-request scripts')
      }
      state.skipRequested = true
      // Postman stops the pre-request script here: nothing after the call runs.
      throw new SkipRequestSignal()
    },
    setNextRequest(name: string | null): void {
      state.nextRequest = { name }
    },
    location,
  }

  // ── vault (secret project variables) ──
  const noVault = (): Promise<never> =>
    Promise.reject(new Error('pm.vault is not available in this context'))
  const vault = {
    get: async (key: string): Promise<string | undefined> => {
      if (!vaultBack) return noVault()
      return vaultBack.secretKeys.has(key) ? scopes.globals.values.get(key) : undefined
    },
    set: async (key: string, value: unknown): Promise<void> => {
      if (!vaultBack) return noVault()
      const s = toVarString(value)
      // Live in the project-variable scope like any project variable…
      scopes.globals.values.set(key, s)
      scopes.globals.updates?.set(key, s)
      // …and recorded as secret: the host persists this AFTER the globals.
      vaultBack.secretKeys.add(key)
      vaultBack.updates.set(key, s)
    },
    unset: async (key: string): Promise<void> => {
      if (!vaultBack) return noVault()
      // Only a secret variable is the vault's to delete.
      if (!vaultBack.secretKeys.has(key)) return
      scopes.globals.values.delete(key)
      scopes.globals.updates?.set(key, '')
      vaultBack.secretKeys.delete(key)
      vaultBack.updates.set(key, null)
    },
  }

  // ── pm.require: Postman package libraries do not exist here ──
  const pmRequire = (name: string): never => {
    throw new Error(`pm.require is not supported in Testnizer: ${String(name)}`)
  }

  // ── visualizer (no pane in Testnizer) ──
  let visualizerNoted = false
  const noteVisualizer = (): void => {
    if (visualizerNoted) return
    visualizerNoted = true
    opts.log(
      'log',
      'pm.visualizer: Testnizer does not show visualizer output; the call was ignored.',
    )
  }
  const visualizer = {
    set: (): void => noteVisualizer(),
    clear: (): void => noteVisualizer(),
  }

  // ── sendRequest ──
  const sendRequest = (
    input: unknown,
    cb?: (err: Error | null, res: PmSendResponse | null) => void,
  ): Promise<PmSendResponse | undefined> => {
    // Normalize inside the promise: an unsupported body (a formdata file part)
    // reaches the callback / rejection like any other send failure.
    const run = Promise.resolve()
      .then(() => opts.send(normalizePmSendInput(input)))
      .then(buildPmSendResponse)
    // Bound NOW, while the calling pm.test is still current: a throw from the
    // callback fails that test instead of vanishing (issue #274).
    const boundCb = cb ? recorder.bindCallback(cb) : undefined
    const handled = run.then(
      (res) => {
        if (boundCb) boundCb(null, res)
        return res
      },
      (err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err))
        if (boundCb) {
          boundCb(e, null)
          return undefined
        }
        throw e
      },
    )
    // Tracked so the host awaits even the callback-only form; swallowed here so
    // the drain never sees a rejection already routed to `cb`.
    pendingSends.push(handled.catch(() => undefined))
    return handled
  }

  const cookieList = opts.response?.cookies ?? []
  const findCookie = (n: string) => cookieList.find((c) => c.name.toLowerCase() === n.toLowerCase())

  const pm: PmLike = {
    info: {
      eventName: opts.eventName,
      iteration: opts.iteration ?? 0,
      iterationCount: opts.iterationCount ?? 1,
      requestName,
      requestId: opts.requestId ?? opts.request.id ?? '',
    },
    environment,
    globals,
    collectionVariables,
    variables,
    iterationData,
    request,
    response: opts.response ? createPmResponse(opts.response) : null,
    cookies: {
      get: (n) => findCookie(n)?.value,
      has: (n) => !!findCookie(n),
      toObject: () => Object.fromEntries(cookieList.map((c) => [c.name, c.value])),
    },
    test: recorder.test,
    expect: chaiExpect,
    sendRequest,
    execution,
    visualizer,
    vault,
    require: pmRequire,
  }

  // Pre-request: there is no response yet, and `pm.response` does not exist —
  // exactly like postman-sandbox (execution.js only builds a response for the
  // 'test' target; pmapi.js `_assignDefinedReadonly` skips undefined values),
  // so the common `if (pm.response) { … }` guard in shared collection-level
  // scripts works. It used to throw here on Send (BUG-07), which made that
  // guard abort the request.
  if (isPreRequest) delete (pm as { response?: unknown }).response

  return {
    pm,
    recorder,
    results,
    pendingTests,
    pendingSends,
    state,
    drain: () => drainPending(pendingSends, pendingTests),
  }
}

export { HeaderCollection }
