/**
 * `pm.expect` / `insomnia.expect` / bare `expect` — backed by the REAL Chai
 * BDD library (the same engine Postman/Newman use), so every documented matcher
 * and flag works with zero hand-rolled drift. ONE source for both the Send path
 * (renderer) and Run path (main) — ends the assertion "paralellik" bug class.
 *
 * Chai is isomorphic (browser + node), so a single import works in both the
 * Vite renderer bundle and the electron-vite main bundle.
 */
import { expect as chaiExpect, util as chaiUtil } from 'chai'

export type Expect = typeof chaiExpect

/** The Chai `expect`, exposed verbatim. `expect.fail`, `.deep`, `.nested`,
 *  `.closeTo`, `.members`, `.throw`, etc. all come for free. */
export const expect: Expect = chaiExpect

/** Chai's deep-equality (deep-eql), reused by the response `jsonBody`/body
 *  assertions so they match `pm.expect(...).to.eql(...)` semantics exactly. */
const eql = (chaiUtil as unknown as { eql: (a: unknown, b: unknown) => boolean }).eql
export function deepEqual(a: unknown, b: unknown): boolean {
  return eql(a, b)
}
