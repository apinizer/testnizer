/**
 * Shared fixture for the "#73 signed token → variable → outgoing header" proof.
 *
 * The MKK flow: a PRE-REQUEST script signs a JWS/JWT with `pm.jose`, writes it to
 * an environment variable, and a later `{{var}}` in a header carries it out on
 * the wire. Both halves of that proof — tests/main/jose-header-flow.test.ts (Run,
 * through the real Collection Runner + http.engine) and
 * tests/renderer/jose-header-flow.test.ts (Send, runScript → resolveKeyValuePairs
 * exactly as request.store.ts sequences it) — import THIS file, so they assert
 * the same literal bytes. Divergence in either path fails one of the two.
 *
 * The token is deterministic: fixed protected header + fixed claims + fixed
 * secret and NO `iat`, so the compact serialization can be pinned exactly.
 */
export const JOSE_FLOW_SECRET = 'mkk-header-secret'

export const JOSE_FLOW_PRE_SCRIPT = `
  const token = await pm.jose.sign(
    { iss: 'testnizer', aud: 'mkk' },
    '${JOSE_FLOW_SECRET}',
    { alg: 'HS256', header: { typ: 'JWT' } },
  );
  pm.environment.set('mkkJwt', token);
`

export const JOSE_FLOW_VAR = 'mkkJwt'

export const JOSE_FLOW_EXPECTED_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ0ZXN0bml6ZXIiLCJhdWQiOiJta2sifQ.OvJuUE8S8uQd1bjWlPqKzcibkTjx3a9Ncmy2r0oeSqA'

/** What the user types in the Headers tab. */
export const JOSE_FLOW_HEADER_TEMPLATE = `Bearer {{${JOSE_FLOW_VAR}}}`

/** What must actually go out on the wire, on BOTH paths. */
export const JOSE_FLOW_EXPECTED_HEADER = `Bearer ${JOSE_FLOW_EXPECTED_JWT}`
