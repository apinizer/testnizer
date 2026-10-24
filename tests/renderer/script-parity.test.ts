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
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPmApi, runScript } from '../../src/renderer/lib/test-runner'
import type { ApiResponse } from '../../src/renderer/types'
import { ECHO_URL, parityCases, type ParityResponse } from '../fixtures/script-parity'

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

/**
 * `pm.sendRequest` transport on Send — answers like the Run half's engine mock:
 * a URL that belongs to a case gets that case's response, anything else 200 '{}'
 * with `timing.total = 1`.
 */
function installSendBridge(): void {
  const send = async (opts: { url: string; method?: string; body?: unknown }) => {
    if (opts.url === ECHO_URL) {
      const body = JSON.stringify({ method: opts.method, body: opts.body })
      return {
        success: true,
        data: {
          status: 200,
          statusText: 'OK',
          headers: {},
          body,
          bodySize: body.length,
          timing: { total: 1 },
        },
      }
    }
    const c = parityCases.find(
      (pc, i) => (pc.request?.url ?? `http://parity.test/case-${i}`) === opts.url,
    )
    const r = c?.response
    const body = r?.body ?? '{}'
    return {
      success: true,
      data: {
        status: r?.status ?? 200,
        statusText: r?.statusText ?? 'OK',
        headers: r?.headers ?? {},
        cookies: r?.cookies ?? [],
        body,
        bodySize: body.length,
        timing: { total: 1 },
      },
    }
  }
  ;(window as unknown as { api: unknown }).api = { request: { send } }
}

describe('script parity — Send path', () => {
  beforeAll(installSendBridge)
  afterAll(() => {
    delete (window as unknown as { api?: unknown }).api
  })
  for (const c of parityCases) {
    // Cases tagged with a known shared-runtime bug describe the INTENDED
    // behaviour the runtime does not yet deliver — run them under it.fails so
    // the suite stays green AND the bug is reproduced in executable form.
    const test = c.knownRuntimeBug ? it.fails : it
    test(c.name, async () => {
      const isPre = c.phase === 'prerequest'
      const pm = createPmApi(
        isPre
          ? { requestId: 'parity', protocol: 'http', timing: { total: 0 } }
          : toApiResponse(c.response),
        new Map<string, string>(Object.entries(c.seedEnv ?? {})),
        new Map<string, string>(Object.entries(c.seedGlobals ?? {})),
        {
          eventName: isPre ? 'prerequest' : 'test',
          requestName: c.requestName ?? c.name,
          ...(c.request
            ? {
                request: {
                  method: c.request.method ?? 'GET',
                  url: c.request.url ?? '',
                  headers: c.request.headers ?? [],
                },
                body: c.request.body,
              }
            : {}),
        },
      )
      const out = await runScript(c.script, pm)

      // Env writes — subset match (script may set helper keys we don't pin).
      for (const [key, value] of Object.entries(c.expectEnv)) {
        expect(out.envUpdates[key], `env ${key}`).toBe(value)
      }
      for (const key of c.expectNoEnv ?? []) {
        expect(out.envUpdates[key], `env ${key} must not be written`).toBeUndefined()
      }
      if (c.expectSkip !== undefined) expect(out.skipRequest).toBe(c.expectSkip)

      // pm.test / legacy tests[] outcomes — match by name.
      for (const t of c.expectTests) {
        const hit = out.results.find((r) => r.assertion.name === t.name)
        expect(hit, `test "${t.name}" present`).toBeDefined()
        expect(hit!.passed, `test "${t.name}" passed (${hit!.error ?? ''})`).toBe(t.passed)
        if (t.skipped !== undefined) expect(hit!.skipped === true).toBe(t.skipped)
      }
    })
  }
})
