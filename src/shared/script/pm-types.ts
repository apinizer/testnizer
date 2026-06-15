/**
 * Structural contract the shared legacy + alias layers consume. Each path
 * (Send renderer / Run main) assembles a `PmLike` from its own backing stores
 * and the shared response/expect builders; legacy.ts and aliases.ts then work
 * against this shape uniformly — so `insomnia.*`, `bru`/`req`/`res`, and the
 * legacy `postman.*`/`responseBody`/`tests` globals stay identical on both.
 */
import type { Expect } from './expect'
import type { PmResponse } from './response'
import type { NormalizedResponse } from './types'

export interface PmScope {
  get(key: string): unknown
  set(key: string, value: unknown): void
  has(key: string): boolean
  unset(key: string): void
  clear(): void
  toObject(): Record<string, unknown>
  replaceIn(template: string): string
}

export interface PmRequestLike {
  method: string
  url: unknown
  headers: unknown
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
  }
  request: PmRequestLike
  response: PmResponse | null
  cookies: {
    get(name: string): string | undefined
    has(name: string): boolean
    toObject(): Record<string, string>
  }
  test: (name: string, fn: () => void | Promise<void>) => void
  expect: Expect
  sendRequest: (input: unknown, cb?: (err: Error | null, res: unknown) => void) => Promise<unknown>
  execution: { setNextRequest(name: string | null): void; skipRequest(): void }
}

/** Everything a host (each path) must supply to build the full pm + aliases. */
export interface ScriptHostContext {
  pm: PmLike
  /** Normalized response (null in pre-request scope) — alias layers need the
   *  raw numeric/string fields (Insomnia's response.status = numeric code). */
  normalizedResponse: NormalizedResponse | null
}
