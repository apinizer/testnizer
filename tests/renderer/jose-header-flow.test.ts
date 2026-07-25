/**
 * #73 Send half: pre-request script signs with `pm.jose`, writes the token to an
 * environment variable, and the header template resolves to the outgoing value.
 *
 * The sequence mirrors request.store.ts exactly:
 *   runScript(preScript, createPmApi(..., { eventName: 'prerequest' }))
 *     → scriptOverrides = { ...envUpdates }
 *     → resolveKeyValuePairs(headers, activeVars)
 *
 * It asserts the SAME literal from tests/fixtures/jose-header-flow.ts that the
 * Run half (tests/main/jose-header-flow.test.ts) asserts through the Collection
 * Runner — so Send ≡ Run is proven on bytes, not assumed.
 *
 * Also covers: an UNCAUGHT jose verify failure surfacing as an ordinary script
 * error (captured console entry, no crash, later assertions still reported).
 */
import { describe, expect, it } from 'vitest'
import { createPmApi, runScript } from '../../src/renderer/lib/test-runner'
import { resolveKeyValuePairs } from '../../src/renderer/lib/variable-resolver'
import type { ApiResponse } from '../../src/renderer/types'
import {
  JOSE_FLOW_EXPECTED_HEADER,
  JOSE_FLOW_EXPECTED_JWT,
  JOSE_FLOW_HEADER_TEMPLATE,
  JOSE_FLOW_PRE_SCRIPT,
  JOSE_FLOW_SECRET,
} from '../fixtures/jose-header-flow'

const emptyResponse: ApiResponse = {
  requestId: 'jose-flow',
  protocol: 'http',
  timing: { total: 0 },
}

async function runPreRequest(script: string): Promise<{
  envUpdates: Record<string, string>
  consoleLogs: Array<{ level: string; message: string }>
  results: Array<{ assertion: { name: string }; passed: boolean }>
}> {
  const pm = createPmApi(emptyResponse, new Map<string, string>(), new Map<string, string>(), {
    eventName: 'prerequest',
    requestName: 'jose flow',
    request: { method: 'GET', url: 'http://jose.test/protected', headers: [] },
  })
  return runScript(script, pm)
}

describe('#73 — signed token flows into a variable and out via a header (Send path)', () => {
  it('pm.jose.sign in a pre-request script resolves into the Authorization header', async () => {
    const out = await runPreRequest(JOSE_FLOW_PRE_SCRIPT)

    expect(out.envUpdates.mkkJwt).toBe(JOSE_FLOW_EXPECTED_JWT)

    // Same order request.store.ts uses: script writes first, then resolution.
    const activeVars: Record<string, string> = { ...out.envUpdates }
    const resolved = resolveKeyValuePairs(
      [{ id: 'h1', key: 'Authorization', value: JOSE_FLOW_HEADER_TEMPLATE, enabled: true }],
      activeVars,
    )
    expect(resolved[0].value).toBe(JOSE_FLOW_EXPECTED_HEADER)
  })

  it('the token is a real HS256 signature over the fixture secret', async () => {
    const out = await runPreRequest(JOSE_FLOW_PRE_SCRIPT)
    const { jwtVerify } = await import('jose')
    const { payload, protectedHeader } = await jwtVerify(
      out.envUpdates.mkkJwt,
      new TextEncoder().encode(JOSE_FLOW_SECRET),
    )
    expect(protectedHeader.alg).toBe('HS256')
    expect(payload.aud).toBe('mkk')
  })

  it('an UNCAUGHT verify failure surfaces as a normal script error, not a crash', async () => {
    const out = await runPreRequest(`
      pm.environment.set('before', 'written');
      const token = await pm.jose.sign({ a: 1 }, 'right-secret', { alg: 'HS256' });
      await pm.jose.verify(token, 'wrong-secret');
      pm.environment.set('after', 'never');
    `)

    // Writes before the throw survive; the script simply stops there.
    expect(out.envUpdates.before).toBe('written')
    expect(out.envUpdates.after).toBeUndefined()

    const errors = out.consoleLogs.filter((l) => l.level === 'error')
    expect(errors.some((l) => l.message.includes('signature verification failed'))).toBe(true)
    expect(errors.some((l) => l.message.startsWith('Script error:'))).toBe(true)
  })

  it('a missing alg for a PEM key fails with an actionable message', async () => {
    const out = await runPreRequest(`
      const kp = await pm.jose.generateKeyPair('ES256');
      try {
        await pm.jose.sign({ a: 1 }, kp.privateKey);
        pm.environment.set('pemErr', 'NO-THROW');
      } catch (e) {
        pm.environment.set('pemErr', e.message);
      }
      pm.environment.set('pemSigned', (await pm.jose.sign({ a: 1 }, kp.privateKey, { alg: 'ES256' })).split('.').length === 3 ? 'ok' : 'no');
    `)
    expect(out.envUpdates.pemErr).toContain('`alg` is required for PEM keys')
    expect(out.envUpdates.pemSigned).toBe('ok')
  })
})
