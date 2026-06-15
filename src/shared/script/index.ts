/**
 * Shared script-runtime assembly. Both the Send path (renderer test-runner.ts)
 * and the Run path (main runner.handler.ts) build a `ScriptHostContext` from
 * their own backing stores, then call `buildScriptBindings` to get the EXACT
 * same global set bound into the sandbox — Postman `pm` + `t`/`insomnia`/`bru`
 * aliases, Bruno `req`/`res`, bare `expect`/`test`, `require`, the legacy
 * `postman.*`/`responseBody`/`tests`/`xml2Json` interface, and the library
 * globals (`CryptoJS`, `_`, `atob`, `btoa`). One source ⇒ no parity drift.
 */
import { expect } from './expect'
import { sandboxRequire, scriptGlobals } from './require'
import { buildInsomnia, buildBruno } from './aliases'
import { buildLegacyGlobals } from './legacy'
import type { ScriptHostContext } from './pm-types'

export { createPmResponse } from './response'
export type { PmResponse } from './response'
export { expect, deepEqual } from './expect'
export { sandboxRequire, scriptGlobals } from './require'
export type { NormalizedResponse, ScriptTestResult } from './types'
export type { PmLike, PmScope, ScriptHostContext } from './pm-types'

export interface ScriptBindings {
  /** name → value to inject as script globals (caller adds `console`). */
  bindings: Record<string, unknown>
  /** Legacy `tests` object; after the script runs, drain each [name, passed]
   *  into the path's test-result sink. */
  legacyTests: Record<string, boolean>
}

export function buildScriptBindings(ctx: ScriptHostContext): ScriptBindings {
  const insomnia = buildInsomnia(ctx)
  const { bru, req, res } = buildBruno(ctx)
  const legacy = buildLegacyGlobals(ctx)

  const bindings: Record<string, unknown> = {
    // Postman + Testnizer brand + Insomnia/Bruno aliases
    pm: ctx.pm,
    t: ctx.pm,
    insomnia,
    bru,
    req,
    res,
    // bare chai-style globals (Insomnia/Bruno/raw scripts use these)
    expect,
    test: (name: string, fn: () => void | Promise<void>) => ctx.pm.test(name, fn),
    // sandbox require + library globals
    require: sandboxRequire,
    ...scriptGlobals, // CryptoJS, _, atob, btoa
    // legacy interface: postman.*, tests, xml2Json, environment, globals, data, request, responseBody, ...
    ...legacy.globals,
  }

  return { bindings, legacyTests: legacy.tests }
}
