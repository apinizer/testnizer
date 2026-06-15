/**
 * Legacy (pre-`pm`) Postman sandbox interface — still emitted by many exported
 * collections. Shared by Send and Run. Returns the globals to bind plus the
 * mutable `tests` object the caller drains into test results after the script.
 *
 * Mirrors postman-sandbox/lib/sandbox/postman-legacy-interface.js.
 */
import * as xml2js from 'xml2js'
import type { ScriptHostContext } from './pm-types'

export interface LegacyBindings {
  /** Name → value map to spread into the script's global scope. */
  globals: Record<string, unknown>
  /** Mutable legacy `tests` object; drain into results after the script runs. */
  tests: Record<string, boolean>
}

function xml2Json(xml: string): unknown {
  let out: unknown
  // xml2js.parseString invokes its callback synchronously for string input.
  xml2js.parseString(
    xml,
    { explicitArray: false, async: false },
    (err: Error | null, res: unknown) => {
      if (err) throw err
      out = res
    },
  )
  return out
}

export function buildLegacyGlobals(ctx: ScriptHostContext): LegacyBindings {
  const { pm, normalizedResponse: r } = ctx
  const tests: Record<string, boolean> = {}

  const postman = {
    setEnvironmentVariable: (k: string, v: unknown) => pm.environment.set(k, v),
    getEnvironmentVariable: (k: string) => pm.environment.get(k),
    clearEnvironmentVariable: (k: string) => pm.environment.unset(k),
    clearEnvironmentVariables: () => pm.environment.clear(),
    setGlobalVariable: (k: string, v: unknown) => pm.globals.set(k, v),
    getGlobalVariable: (k: string) => pm.globals.get(k),
    clearGlobalVariable: (k: string) => pm.globals.unset(k),
    clearGlobalVariables: () => pm.globals.clear(),
    setNextRequest: (name: string | null) => pm.execution.setNextRequest(name),
    getResponseCookie: (name: string) => pm.cookies.get(name),
    getResponseHeader: (name: string) => pm.response?.headers.get(name),
  }

  const globals: Record<string, unknown> = {
    postman,
    tests,
    xml2Json,
    // Variable snapshots (legacy reads; writes go through postman.* / pm.*).
    environment: pm.environment.toObject(),
    globals: pm.globals.toObject(),
    data: pm.iterationData.toObject(),
    iteration: pm.info.iteration,
    request: {
      id: pm.request.id,
      name: pm.request.name,
      method: pm.request.method,
      url: typeof pm.request.url === 'string' ? pm.request.url : String(pm.request.url ?? ''),
      headers: pm.request.headers,
    },
  }

  if (r) {
    globals.responseBody = r.body
    globals.responseCode = { code: r.code, name: r.statusText, details: r.statusText }
    globals.responseHeaders = { ...r.headers }
    globals.responseTime = r.responseTime
    globals.responseCookies = r.cookies
  }

  return { globals, tests }
}
