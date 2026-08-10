/**
 * Send≡Run script-parity fixtures.
 *
 * One array of real-world imported scripts (Postman pm/legacy, Insomnia, Bruno,
 * library use, full chai, pm.response.to.*). Each case is run through BOTH the
 * Send path (renderer createPmApi + runScript) and the Run path (Collection
 * Runner) by tests/renderer/script-parity.test.ts and tests/main/script-parity.test.ts.
 *
 * Because the SAME fixtures + SAME expectations drive both tests, a green run on
 * both files is the parity proof: identical scripting behaviour across the two
 * code paths backed by the shared runtime (src/shared/script/*).
 *
 * Determinism rule: expectEnv / expectTests must be value-stable. For uuid-style
 * non-deterministic output we assert presence/length INSIDE the script (writing
 * a deterministic flag like 'ok') rather than pinning the random value.
 */

/** Normalized response fields both paths feed into the script runtime. */
export interface ParityResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  cookies?: Array<{ name: string; value: string }>
}

export interface ParityCase {
  name: string
  /** Post-response (Tests) script — runs after the response is available. */
  script: string
  response: ParityResponse
  /** Deterministic env writes the script must produce (subset match). */
  expectEnv: Record<string, string>
  /** pm.test() / legacy tests[...] outcomes the script must produce. */
  expectTests: Array<{ name: string; passed: boolean }>
  /**
   * KNOWN shared-runtime defect this case currently reproduces — set when the
   * expectEnv/expectTests above describe the CORRECT (intended) behaviour that
   * the runtime does NOT yet deliver. Both parity tests run such a case under
   * `it.fails` so the suites stay green while the bug is documented in code.
   * Crucially this is NOT a Send/Run parity bug: both paths fail identically.
   * Remove the flag once src/shared/script/* is fixed.
   */
  knownRuntimeBug?: string
}

const TOKEN_BODY = '{"access_token":"TOK"}'

const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' }

export const parityCases: ParityCase[] = [
  // a. Postman pm token script: json() → environment.set + pm.test on code.
  {
    name: 'postman pm token + pm.test(code===200)',
    script: `
      var j = pm.response.json();
      pm.environment.set('accessToken', j.access_token);
      pm.test('ok', () => pm.expect(pm.response.code).to.equal(200));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { accessToken: 'TOK' },
    expectTests: [{ name: 'ok', passed: true }],
  },

  // b. Postman legacy sandbox: JSON.parse(responseBody) + postman.* + tests[]/responseCode.
  {
    name: 'postman legacy responseBody + postman.setEnvironmentVariable + tests[]',
    script: `
      var d = JSON.parse(responseBody);
      postman.setEnvironmentVariable('tok', d.access_token);
      tests['legacy 200'] = responseCode.code === 200;
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { tok: 'TOK' },
    expectTests: [{ name: 'legacy 200', passed: true }],
  },

  // c. Insomnia: insomnia.* alias of pm; NOTE insomnia.response.status is NUMERIC.
  {
    name: 'insomnia alias + NUMERIC response.status',
    script: `
      insomnia.environment.set('x', insomnia.response.json().access_token);
      insomnia.test('inso', () => insomnia.expect(insomnia.response.status).to.equal(200));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { x: 'TOK' },
    expectTests: [{ name: 'inso', passed: true }],
  },

  // d. Bruno: bru.setEnvVar / bru.setVar, res.getBody() (parsed), res.getStatus() (numeric).
  {
    name: 'bruno bru.setEnvVar + res.getBody/getStatus',
    script: `
      bru.setEnvVar('b', res.getBody().access_token);
      bru.setVar('code', String(res.getStatus()));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    // bru.setVar writes a RUNTIME var (pm.variables) — not persisted to env, so
    // it is NOT asserted in expectEnv. Only bru.setEnvVar('b') persists.
    expectEnv: { b: 'TOK' },
    expectTests: [],
  },

  // e. Library use: require('lodash'|'crypto-js'|'uuid') + CryptoJS/_ globals.
  //    uuid value is non-deterministic → write a deterministic 'ok' flag instead.
  {
    name: 'require lodash + crypto-js + uuid',
    script: `
      const _ = require('lodash');
      pm.environment.set('up', _.toUpper('hi'));
      const CJS = require('crypto-js');
      pm.environment.set('h', CJS.SHA256('x').toString().slice(0, 8));
      pm.environment.set('id', (require('uuid').v4()).length > 0 ? 'ok' : 'no');
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    // SHA256('x') first 8 hex chars are deterministic.
    expectEnv: {
      up: 'HI',
      h: '2d711642',
      id: 'ok',
    },
    // `const _ = require('lodash')` now works: the script body is wrapped in a
    // `{ }` block so user const/let redeclarations shadow the injected globals
    // instead of colliding with them. Passes normally on both Send and Run.
    expectTests: [],
  },

  // f. Full chai surface: property/that.is.a/match/oneOf/include/and/lengthOf.
  {
    name: 'full chai chain',
    script: `
      var b = pm.response.json();
      pm.test('chai', () => {
        pm.expect(b).to.have.property('access_token').that.is.a('string');
        pm.expect(b.access_token).to.match(/TOK/);
        pm.expect(pm.response.code).to.be.oneOf([200, 201]);
        pm.expect([1, 2, 3]).to.include(2).and.to.have.lengthOf(3);
      });
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {},
    expectTests: [{ name: 'chai', passed: true }],
  },

  // g. pm.response.to.* assertion surface (status / be.success / jsonBody / not.be.error).
  //    NOTE: pm.response.to.be.success — verify the runtime exposes `.success`.
  {
    name: 'pm.response.to.* surface',
    script: `
      pm.test('resp', () => {
        pm.response.to.have.status(200);
        pm.response.to.be.success;
        pm.response.to.have.jsonBody('access_token');
        pm.response.to.not.be.error;
      });
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {},
    expectTests: [{ name: 'resp', passed: true }],
  },

  // ── #73 JOSE (JWS/JWT) in the sandbox ──────────────────────────────────────
  //
  // Every expected token below is a HS256 signature over a FIXED header+payload
  // with a FIXED secret and NO `iat` — i.e. byte-deterministic. Pinning the exact
  // compact serialization in `expectEnv` therefore makes these cases a strong
  // Send≡Run proof: both paths must emit the SAME bytes, not merely "a token".
  //
  // Async note: `await` at script top level is fine on both paths (both wrap the
  // body in an AsyncFunction), but pm.test callbacks are invoked synchronously on
  // the Run path — so every await happens OUTSIDE pm.test and the callbacks only
  // assert already-settled values. Keep new cases in that shape.

  // h. require('jose') — the raw library, exposed exactly like lodash/crypto-js.
  {
    name: "jose: require('jose') sign + verify (HS256, deterministic bytes)",
    script: `
      const jose = require('jose');
      const secret = new TextEncoder().encode('mkk-shared-secret');
      const token = await new jose.SignJWT({ sub: 'MKK', scope: 'settlement' })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .sign(secret);
      pm.environment.set('joseToken', token);
      const verified = await jose.jwtVerify(token, secret);
      pm.test('jose roundtrip', () => {
        pm.expect(verified.payload.sub).to.equal('MKK');
        pm.expect(verified.protectedHeader.alg).to.equal('HS256');
      });
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {
      joseToken:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJNS0siLCJzY29wZSI6InNldHRsZW1lbnQifQ.squmiEAP5wBZc2c59uxle7auWRdfp4Sqxo4vxcWw0C0',
    },
    expectTests: [{ name: 'jose roundtrip', passed: true }],
  },

  // i. pm.jose.* helper — sign into a variable (the MKK flow), verify, decode.
  {
    name: 'jose: pm.jose.sign → variable, pm.jose.verify + decode',
    script: `
      const token = await pm.jose.sign(
        { iss: 'testnizer', txn: 'TX-1' },
        'mkk-shared-secret',
        { alg: 'HS256', header: { kid: 'mkk-key-1' } },
      );
      pm.environment.set('mkkToken', token);
      const r = await pm.jose.verify(token, 'mkk-shared-secret');
      const d = pm.jose.decode(token);
      pm.environment.set('mkkKid', String(d.header.kid));
      pm.test('pm.jose verify', () => {
        pm.expect(r.payload.txn).to.equal('TX-1');
        pm.expect(r.header.kid).to.equal('mkk-key-1');
        pm.expect(d.payload.iss).to.equal('testnizer');
      });
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {
      mkkToken:
        'eyJhbGciOiJIUzI1NiIsImtpZCI6Im1ray1rZXktMSJ9.eyJpc3MiOiJ0ZXN0bml6ZXIiLCJ0eG4iOiJUWC0xIn0.BGBWkf3-cGGBWfyB-YVteMfipKgTzgpXrtr3hs2b4OQ',
      mkkKid: 'mkk-key-1',
    },
    expectTests: [{ name: 'pm.jose verify', passed: true }],
  },

  // j. Detached-style raw JWS payload + a verify FAILURE surfacing as an ordinary
  //    catchable script error (identical message/code on both paths).
  {
    name: 'jose: compact JWS payload + verify failure is a normal script error',
    script: `
      const jws = await pm.jose.signJws('raw-mkk-payload', 'mkk-shared-secret', { alg: 'HS256' });
      pm.environment.set('mkkJws', jws);
      const back = await pm.jose.verifyJws(jws, 'mkk-shared-secret');
      let failure = '';
      let code = '';
      try {
        await pm.jose.verify(
          await pm.jose.sign({ a: 1 }, 'right-secret', { alg: 'HS256' }),
          'wrong-secret',
        );
        failure = 'NO-THROW';
      } catch (e) {
        failure = e.message;
        code = String(e.code);
      }
      pm.environment.set('joseVerifyError', failure);
      pm.environment.set('joseVerifyCode', code);
      pm.test('jws + failure', () => {
        pm.expect(back.payload).to.equal('raw-mkk-payload');
        pm.expect(failure).to.equal('signature verification failed');
      });
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {
      mkkJws:
        'eyJhbGciOiJIUzI1NiJ9.cmF3LW1ray1wYXlsb2Fk.tzqYPHLRA5NRGeqT8qwhPAHbxMNp7LCzGtEcbfyBciA',
      joseVerifyError: 'signature verification failed',
      joseVerifyCode: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    },
    expectTests: [{ name: 'jws + failure', passed: true }],
  },

  // k. The allow-list still holds: adding jose must not open the sandbox to Node
  //    builtins or arbitrary packages (same rejection message on both paths).
  {
    name: 'jose: sandbox still refuses non-allowlisted modules',
    script: `
      const blocked = [];
      for (const name of ['fs', 'node:crypto', 'child_process', 'jose/jwt/sign', 'axios']) {
        try { require(name); blocked.push(name + ':LOADED'); }
        catch (e) { blocked.push(name + ':' + (e.message.startsWith('Cannot find module') ? 'blocked' : 'other')); }
      }
      pm.environment.set('blockedModules', blocked.join(','));
      pm.environment.set('joseAllowed', typeof require('jose').SignJWT === 'function' ? 'yes' : 'no');
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {
      blockedModules:
        'fs:blocked,node:crypto:blocked,child_process:blocked,jose/jwt/sign:blocked,axios:blocked',
      joseAllowed: 'yes',
    },
    expectTests: [],
  },

  // l. ASYNC pm.test — the divergence an adversarial review found: Run recorded
  //    a PASS the moment the callback returned a promise and never awaited it,
  //    so every `pm.test(async () => …)` was a silent false-green there while
  //    Send awaited it properly. `pm.jose.*` is async-only, so #73's idiomatic
  //    script lands exactly here.
  {
    name: 'async pm.test is awaited on BOTH paths (a failing async assertion fails)',
    script: `
      pm.test('async assertion that PASSES', async () => {
        const token = await pm.jose.sign({ sub: 'x' }, 'topsecret', { alg: 'HS256' });
        pm.expect(token.split('.').length).to.equal(3);
      });
      pm.test('async assertion that FAILS', async () => {
        await pm.jose.verify('eyJhbGciOiJIUzI1NiJ9.e30.bad-signature', 'topsecret');
      });
      pm.test('sync assertion still works', () => {
        pm.expect(pm.response.code).to.equal(200);
      });
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {},
    expectTests: [
      { name: 'async assertion that PASSES', passed: true },
      { name: 'async assertion that FAILS', passed: false },
      { name: 'sync assertion still works', passed: true },
    ],
  },

  // m. ASYMMETRIC parity. Every earlier jose case is HS256, so nothing proved
  //    that RSA/EC behave identically on the two hosts (Send runs on Chromium's
  //    WebCrypto, Run on Node's). Generate → sign → verify inside the script and
  //    assert only value-stable facts, since the key is random per run.
  {
    name: 'jose: RS256 and ES256 round-trip identically on both hosts',
    script: `
      const rsa = await pm.jose.generateKeyPair('RS256');
      const rsaToken = await pm.jose.sign({ sub: 'rs' }, rsa.privateKey, { alg: 'RS256' });
      const rsaClaims = await pm.jose.verify(rsaToken, rsa.publicKey, { alg: 'RS256' });
      pm.environment.set('rsaSub', String(rsaClaims.sub ?? rsaClaims.payload?.sub ?? ''));
      pm.environment.set('rsaHeaderAlg', String(pm.jose.decode(rsaToken).header.alg));

      const ec = await pm.jose.generateKeyPair('ES256');
      const ecToken = await pm.jose.sign({ sub: 'es' }, ec.privateKey, { alg: 'ES256' });
      const ecClaims = await pm.jose.verify(ecToken, ec.publicKey, { alg: 'ES256' });
      pm.environment.set('ecSub', String(ecClaims.sub ?? ecClaims.payload?.sub ?? ''));
      pm.environment.set('ecKty', String(ec.publicJwk.kty));

      // A wrong key must fail the same way on both paths.
      try {
        await pm.jose.verify(rsaToken, ec.publicKey, { alg: 'ES256' });
        pm.environment.set('crossVerify', 'ACCEPTED');
      } catch {
        pm.environment.set('crossVerify', 'rejected');
      }

      // Host-dependent algorithms are refused identically rather than working
      // on Run and throwing on Send.
      try {
        await pm.jose.generateKeyPair('EdDSA');
        pm.environment.set('eddsa', 'ALLOWED');
      } catch (e) {
        pm.environment.set('eddsa', e.message.includes('not available in scripts') ? 'refused' : 'other');
      }
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {
      rsaSub: 'rs',
      rsaHeaderAlg: 'RS256',
      ecSub: 'es',
      ecKty: 'EC',
      crossVerify: 'rejected',
      eddsa: 'refused',
    },
    expectTests: [],
  },
]
