/**
 * Sandboxed pre-response script runner.
 *
 * Each MockResponse may carry a `script` string (JavaScript) that runs before
 * the response is sent. The script can:
 *   - Inspect `request` (immutable snapshot)
 *   - Read & mutate `state` (server-wide, in-memory)
 *   - Mutate `response` to override status / headers / body
 *   - `console.log(...)` to push messages into the per-request log
 *
 * Sandboxing uses Node's `vm` module:
 *   - Fresh context per execution (no shared globals between scripts)
 *   - 5-second timeout (`vm.runInNewContext`)
 *   - No access to require / process / network / fs (we don't expose them)
 *   - Errors are caught and surfaced as a 500 with `error` populated in the log
 *
 * Note: vm sandboxes in Node are NOT a security boundary against truly hostile
 * code (a determined attacker can break out via prototype tricks). This is fine
 * for a local mock server — scripts come from the same user running the app.
 */

import vm from 'node:vm'

export interface ScriptRequest {
  method: string
  path: string
  headers: Record<string, string>
  query: Record<string, string>
  params: Record<string, string>
  body: unknown
  bodyText: string
}

export interface ScriptResponse {
  status: number
  headers: Record<string, string>
  /** Body as a string (already templated). Scripts may set this directly,
   *  or call `setJson()` to JSON-stringify a value. */
  body: string
}

export interface ScriptResult {
  ok: boolean
  /** Mutated response (always returned, even if script threw). */
  response: ScriptResponse
  /** Lines from console.log/info/warn/error in execution order. */
  consoleLines: string[]
  /** Error message if script threw or timed out. */
  error: string | null
}

const SCRIPT_TIMEOUT_MS = 5000

/**
 * Run a user-supplied script in a sandbox. Returns the (possibly mutated)
 * response and any console output. If the script doesn't run (empty source)
 * the response is returned unchanged.
 */
export function runScript(
  source: string,
  initial: ScriptResponse,
  request: ScriptRequest,
  state: Record<string, unknown>,
): ScriptResult {
  if (!source || !source.trim()) {
    return { ok: true, response: initial, consoleLines: [], error: null }
  }

  // Mutable copy of the response (script may overwrite any field).
  const response: ScriptResponse = {
    status: initial.status,
    headers: { ...initial.headers },
    body: initial.body,
  }

  const consoleLines: string[] = []
  const captureLog =
    (level: string) =>
    (...args: unknown[]): void => {
      consoleLines.push(`[${level}] ${args.map(formatArg).join(' ')}`)
    }

  const sandbox: Record<string, unknown> = {
    request: deepFreeze(request),
    state, // mutable, shared with the server
    response, // mutable
    console: {
      log: captureLog('log'),
      info: captureLog('info'),
      warn: captureLog('warn'),
      error: captureLog('error'),
    },
    // Tiny built-in helpers
    setJson: (value: unknown): void => {
      response.body = JSON.stringify(value)
      response.headers['content-type'] = 'application/json; charset=utf-8'
    },
    setStatus: (n: number): void => {
      response.status = n
    },
    setHeader: (name: string, value: string): void => {
      response.headers[name.toLowerCase()] = value
    },
  }

  try {
    vm.runInNewContext(source, sandbox, {
      timeout: SCRIPT_TIMEOUT_MS,
      // Wrap in `(function(){ ... })()` is not necessary — top-level await
      // not supported in vm.runInNewContext, but bare statements work fine.
    })
    return { ok: true, response, consoleLines, error: null }
  } catch (e) {
    return {
      ok: false,
      response,
      consoleLines,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

function formatArg(a: unknown): string {
  if (typeof a === 'string') return a
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

/** Recursively freeze an object so scripts can't mutate request data. */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) return obj
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    deepFreeze((obj as Record<string, unknown>)[key])
  }
  return Object.freeze(obj)
}
