/**
 * Structural contract the shared legacy + alias layers consume. Each path
 * (Send renderer / Run main) assembles a `PmLike` from its own backing stores
 * and the shared response/expect builders; legacy.ts and aliases.ts then work
 * against this shape uniformly — so `insomnia.*`, `bru`/`req`/`res`, and the
 * legacy `postman.*`/`responseBody`/`tests` globals stay identical on both.
 */
import type { Expect } from './expect'
import type { JoseHelper } from './jose'
import type { PmResponse } from './response'
import type { NormalizedResponse } from './types'
import type { McpScriptInfo } from '../mcp-response'
import type { PmTestFunction, SandboxTimers } from './pm-test'
import type { PmRequestBody, PmUrl } from './pm-request'

export interface PmScope {
  /** `undefined` for a missing key — on every scope, on both paths (Postman). */
  get(key: string): string | undefined
  set(key: string, value: unknown): void
  has(key: string): boolean
  unset(key: string): void
  clear(): void
  toObject(): Record<string, unknown>
  /** Resolves `{{var}}` and `{{$dynamic}}`; objects/arrays have their strings replaced. */
  replaceIn(template: string): string
}

export interface PmRequestLike {
  method: string
  /** Postman Url shape; `String(url)` is the URL as written. */
  url: PmUrl
  headers: unknown
  /** Postman RequestBody shape; undefined when the request has no body. */
  body?: PmRequestBody
  id?: string
  name?: string
}

export interface PmLike {
  info: {
    eventName: string
    iteration: number
    iterationCount: number
    requestName: string
    requestId: string
  }
  environment: PmScope & { name?: string }
  globals: PmScope
  collectionVariables: PmScope
  variables: PmScope
  iterationData: {
    get(k: string): unknown
    has(k: string): boolean
    toObject(): Record<string, unknown>
    toJSON?(): Record<string, unknown>
    unset?(k: string): void
  }
  request: PmRequestLike
  /** Absent in pre-request scope (Postman); null for a Run hook without a response. */
  response?: PmResponse | null
  cookies: {
    get(name: string): string | undefined
    has(name: string): boolean
    toObject(): Record<string, string>
  }
  test: PmTestFunction
  expect: Expect
  sendRequest: (input: unknown, cb?: (err: Error | null, res: unknown) => void) => Promise<unknown>
  execution: {
    setNextRequest(name: string | null): void
    skipRequest(): void
    /** Folder names + request name; `.current` is the last entry. */
    location?: string[] & { current: string }
  }
  /** No visualizer pane in Testnizer: set/clear are accepted and ignored. */
  visualizer?: { set(...args: unknown[]): void; clear(): void }
  /** JWS/JWT helper (#73). Hosts do NOT supply it — `buildScriptBindings`
   *  attaches the one shared instance, so Send and Run get the same object. */
  jose?: JoseHelper
  /** MCP call view (issues #160, #161) — `undefined` for non-MCP requests.
   *  Hosts do NOT set it: `buildScriptBindings` copies `ScriptHostContext.mcp`. */
  mcp?: McpScriptInfo
}

/** Everything a host (each path) must supply to build the full pm + aliases. */
export interface ScriptHostContext {
  pm: PmLike
  /** Normalized response (null in pre-request scope) — alias layers need the
   *  raw numeric/string fields (Insomnia's response.status = numeric code). */
  normalizedResponse: NormalizedResponse | null
  /**
   * The MCP call this script runs after (post-response scope of an MCP
   * request), built with `mcpScriptInfo` from `src/shared/mcp-response.ts`.
   * Exposed as `pm.mcp`; omit for every non-MCP request.
   */
  mcp?: McpScriptInfo
  /**
   * Timers bound into the sandbox (`setTimeout` & co). They come from the
   * shared pm.test recorder so a throw inside a timer fails the done-style test
   * that scheduled it instead of escaping as an uncaught exception (issue #274).
   */
  timers?: SandboxTimers
}
