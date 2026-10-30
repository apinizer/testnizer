/**
 * Issue #287 — TLS certificate verification: ONE resolver for Send and Run,
 * and ONE persisted encoding for the request-level override.
 *
 * CONTRACT (the fix must provide exactly this; the other #287 test files build
 * on it):
 *
 *  1. `src/shared/request-settings.ts` exports
 *       resolveSslVerification(
 *         request: boolean | null | undefined,   // null/undefined = inherit
 *         project: boolean | null | undefined,   // project.<id>.settings.sslVerification
 *         app: boolean | null | undefined,       // app Settings `sslVerification`
 *       ): boolean
 *     Precedence: request → project → app → true (verify). Same shape as
 *     `resolveHttpTimeout`. Send (`request.store.ts` sendRequest) and Run
 *     (`runner.handler.ts` `buildRequestFromEndpoint`) both call it.
 *
 *  2. The request-level value is TRI-STATE like `requestTimeout`:
 *     `null`/absent = inherit, `true`/`false` = the user's explicit choice.
 *     An untouched request therefore persists NO ssl key (the old writer wrote
 *     `sslVerification: <store default true>` on every Ctrl+S, which shadowed
 *     the project's `false` forever — the root cause of issue #287).
 *
 *  3. Persisted encoding + migration rule (`readRequestSettings` is the single
 *     reader; Run, the tab-open paths and the exporters all go through it):
 *       - `sslVerification: false`                      -> explicit OFF. A stored
 *         false can only come from a user toggle / `curl -k` / Postman
 *         `strictSSL:false` (the default was true), so it is never ambiguous and
 *         is kept as is.
 *       - bare `sslVerification: true` (LEGACY shape)    -> NOT an override. It
 *         is byte-identical to what every pre-fix Ctrl+S wrote for a request
 *         nobody touched, so it is read as "inherit". Treating it as a
 *         deliberate choice would leave exactly the requests of the people who
 *         reported #287 unfixed.
 *       - `sslVerification: true` + `sslVerificationExplicit: true`
 *                                                        -> explicit ON (the
 *         writer adds the marker key ONLY for a user-chosen true). This keeps a
 *         deliberate "verify this one request although the project turned it
 *         off" choice alive across save / reopen / Run.
 *     The only choice the migration can change is a legacy request-level `true`
 *     under a project/app `false`: it now follows the project — the setting the
 *     user switched off deliberately, and the setting the legacy `true` was
 *     never a decision against.
 */
import { describe, expect, it } from 'vitest'
import * as requestSettings from '../../../src/shared/request-settings'

const { readRequestSettings } = requestSettings
// Import by name from the contract path: a missing export is the red state.
const resolve = (requestSettings as unknown as Record<string, unknown>).resolveSslVerification as (
  request: boolean | null | undefined,
  project: boolean | null | undefined,
  app: boolean | null | undefined,
) => boolean

describe('issue #287 — resolveSslVerification exists on the shared contract path', () => {
  it('src/shared/request-settings.ts exports resolveSslVerification', () => {
    expect(typeof resolve).toBe('function')
  })
})

describe('issue #287 — resolveSslVerification precedence: request → project → app → true', () => {
  const cases: Array<
    [
      string,
      boolean | null | undefined,
      boolean | null | undefined,
      boolean | null | undefined,
      boolean,
    ]
  > = [
    // nothing configured -> verify
    ['nothing configured verifies', undefined, undefined, undefined, true],
    ['null everywhere verifies', null, null, null, true],
    // app tier only
    ['app false', undefined, undefined, false, false],
    ['app true', undefined, undefined, true, true],
    // project beats app
    ['project false beats app true', undefined, false, true, false],
    ['project true beats app false', undefined, true, false, true],
    ['project false, app unset', undefined, false, undefined, false],
    ['project null falls through to app false', undefined, null, false, false],
    // request beats everything when explicitly set
    ['request false beats project true', false, true, true, false],
    ['request true beats project false', true, false, false, true],
    ['request true beats app false (no project)', true, undefined, false, true],
    ['request false beats app true (no project)', false, undefined, true, false],
    // request inherit (null / undefined) follows the project
    ['request null follows project false', null, false, true, false],
    ['request undefined follows project false', undefined, false, true, false],
    ['request null follows project true over app false', null, true, false, true],
  ]
  for (const [name, request, project, app, expected] of cases) {
    it(name, () => {
      expect(resolve(request, project, app)).toBe(expected)
    })
  }
})

describe('issue #287 — readRequestSettings: legacy true is inherit, false and marked true are explicit', () => {
  it('absent -> inherit (no sslVerification key)', () => {
    expect(readRequestSettings({}).sslVerification).toBeUndefined()
  })

  it('stored false -> explicit OFF', () => {
    expect(readRequestSettings({ sslVerification: false }).sslVerification).toBe(false)
  })

  it('LEGACY bare true -> inherit (it is what every untouched pre-fix save wrote)', () => {
    expect(readRequestSettings({ sslVerification: true }).sslVerification).toBeUndefined()
  })

  it('legacy bundle written by the old Ctrl+S (timeout/redirects/ssl all together) -> ssl inherit', () => {
    const r = readRequestSettings({ followRedirects: true, maxRedirects: 5, sslVerification: true })
    expect(r.sslVerification).toBeUndefined()
    // the other keys are untouched by the migration
    expect(r.followRedirects).toBe(true)
    expect(r.maxRedirects).toBe(5)
  })

  it('true + sslVerificationExplicit -> explicit ON', () => {
    expect(
      readRequestSettings({ sslVerification: true, sslVerificationExplicit: true }).sslVerification,
    ).toBe(true)
  })

  it('a non-boolean value is ignored (inherit)', () => {
    expect(readRequestSettings({ sslVerification: 'false' }).sslVerification).toBeUndefined()
    expect(readRequestSettings({ sslVerification: 0 }).sslVerification).toBeUndefined()
  })
})
