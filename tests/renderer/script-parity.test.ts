/**
 * Send-path half of the Send≡Run script-parity proof.
 *
 * Drives every fixture in tests/fixtures/script-parity.ts through the RENDERER
 * scripting path: createPmApi(response, env, globals) + runScript(script, pm).
 * Asserts the deterministic env writes (out.envUpdates) and pm.test outcomes
 * (out.results) match the shared expectEnv / expectTests.
 *
 * The MAIN half (tests/main/script-parity.test.ts) runs the SAME fixtures with
 * the SAME expectations through the Collection Runner. Both green ⇒ parity.
 */
import { describe, expect, it } from 'vitest'
import { createPmApi, runScript } from '../../src/renderer/lib/test-runner'
import type { ApiResponse } from '../../src/renderer/types'
import { parityCases, type ParityResponse } from '../fixtures/script-parity'

function toApiResponse(r: ParityResponse): ApiResponse {
  return {
    requestId: 'parity',
    protocol: 'http',
    status: r.status,
    statusText: r.statusText,
    headers: r.headers,
    body: r.body,
    cookies: r.cookies ?? [],
    bodySize: r.body.length,
    timing: { total: 1 },
  }
}

describe('script parity — Send path', () => {
  for (const c of parityCases) {
    // Cases tagged with a known shared-runtime bug describe the INTENDED
    // behaviour the runtime does not yet deliver — run them under it.fails so
    // the suite stays green AND the bug is reproduced in executable form.
    const test = c.knownRuntimeBug ? it.fails : it
    test(c.name, async () => {
      const pm = createPmApi(
        toApiResponse(c.response),
        new Map<string, string>(),
        new Map<string, string>(),
        { eventName: 'test', requestName: c.name },
      )
      const out = await runScript(c.script, pm)

      // Env writes — subset match (script may set helper keys we don't pin).
      for (const [key, value] of Object.entries(c.expectEnv)) {
        expect(out.envUpdates[key], `env ${key}`).toBe(value)
      }

      // pm.test / legacy tests[] outcomes — match by name.
      for (const t of c.expectTests) {
        const hit = out.results.find((r) => r.assertion.name === t.name)
        expect(hit, `test "${t.name}" present`).toBeDefined()
        expect(hit!.passed, `test "${t.name}" passed (${hit!.error ?? ''})`).toBe(t.passed)
      }
    })
  }
})
