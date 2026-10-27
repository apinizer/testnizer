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
  expectTests: Array<{ name: string; passed: boolean; skipped?: boolean }>
  /**
   * 'prerequest' runs the script as the request's pre-request script (Send:
   * eventName 'prerequest', no response; Run: the endpoint's preScript).
   * Default: post-response.
   */
  phase?: 'prerequest' | 'test'
  /** Active-environment / project-global variables both paths start with. */
  seedEnv?: Record<string, string>
  seedGlobals?: Record<string, string>
  /** Project variables marked SECRET (what `pm.vault` reads) — issue #281. */
  seedSecretGlobals?: Record<string, string>
  /**
   * No environment selected (Send: no active environment; Run: none requested
   * and none active). Default: one is selected, seeded with `seedEnv`.
   */
  noActiveEnvironment?: boolean
  /** Project-variable writes (pm.globals / pm.collectionVariables), subset match. */
  expectGlobals?: Record<string, string>
  /**
   * `pm.vault` outcome: a value = the project variable exists as a secret with
   * that value afterwards, null = it was deleted (Send: `vaultUpdates`; Run:
   * the persisted row).
   */
  expectVault?: Record<string, string | null>
  /** `pm.info.requestName` (Send meta / Run endpoint name). Default: `name`. */
  requestName?: string
  /** The request as defined (Run: the endpoint; Send: createPmApi meta). */
  request?: {
    method?: string
    url?: string
    headers?: Array<{ key: string; value: string }>
    body?: {
      type: string
      content?: string
      urlEncoded?: Array<{ key: string; value: string; enabled?: boolean }>
    }
  }
  /** Env keys the script must NOT have written. */
  expectNoEnv?: string[]
  /** The request must be skipped (pm.execution.skipRequest()). */
  expectSkip?: boolean
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

/** Both harness transports answer this URL with `{ method, body }` of the request. */
export const ECHO_URL = 'http://parity.test/echo'

const GUARD_SCRIPT = `
  if (pm.response) {
    pm.environment.set('guard', 'post:' + pm.response.code);
  } else {
    pm.environment.set('guard', 'pre');
  }
  pm.environment.set('afterGuard', 'ran');
`

import { assertionsToScript } from '../../src/shared/assertions-to-script'

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

  // l2. issue #274: `pm.test(name, function (done) { … })` — Postman's
  //     callback form. Both paths used to call fn() with no argument and record
  //     a PASS the moment it returned, so a done-style test that failed later
  //     (in a timer or a pm.sendRequest callback) was a silent false-green, and
  //     the late `done()` threw "done is not a function" outside any try/catch.
  //     The result must now be decided by done()/done(err)/a throw.
  {
    name: 'pm.test done-callback form waits for done() on BOTH paths (issue #274)',
    script: `
      pm.test('done called synchronously', function (done) {
        pm.expect(pm.response.code).to.equal(200);
        done();
      });
      pm.test('done called later', function (done) {
        setTimeout(function () {
          pm.expect(pm.response.json().access_token).to.equal('TOK');
          done();
        }, 5);
      });
      pm.test('done(err) fails the test', function (done) {
        setTimeout(function () { done(new Error('late failure')); }, 5);
      });
      pm.test('assertion in a timer fails the test', function (done) {
        setTimeout(function () {
          pm.expect(1).to.equal(2);
          done();
        }, 5);
      });
      pm.test('throw before done fails the test', function (done) {
        throw new Error('early failure');
      });
      pm.test('sync form unchanged', function () {
        pm.expect(true).to.equal(true);
      });
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {},
    expectTests: [
      { name: 'done called synchronously', passed: true },
      { name: 'done called later', passed: true },
      { name: 'done(err) fails the test', passed: false },
      { name: 'assertion in a timer fails the test', passed: false },
      { name: 'throw before done fails the test', passed: false },
      { name: 'sync form unchanged', passed: true },
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
  // m. Issue #270: Tests-tab rows exported as generated pm.test code run the
  //    same on Send and Run (a re-imported collection runs this block).
  {
    name: 'exported Tests-tab assertion block (issue #270)',
    script: assertionsToScript([
      { name: 'gen status', type: 'status_equals', enabled: true, expected: 201 },
      { name: 'gen status wrong', type: 'status_equals', enabled: true, expected: 200 },
      { name: 'gen range', type: 'status_in_range', enabled: true, rangeMin: 200, rangeMax: 299 },
      {
        name: 'gen header case',
        type: 'header_equals',
        enabled: true,
        headerName: ' x-trace ',
        expected: 'abc',
      },
      { name: 'gen header missing', type: 'header_exists', enabled: true, headerName: 'X-Nope' },
      { name: 'gen contains', type: 'body_contains', enabled: true, expected: '"n":2' },
      {
        name: 'gen jsonpath',
        type: 'body_jsonpath',
        enabled: true,
        jsonPath: '$.items[*].n',
        expected: '[1,2]',
      },
      {
        name: 'gen json order',
        type: 'body_equals_json',
        enabled: true,
        expected: '{"items":[{"n":1},{"n":2}],"id":1}',
      },
      { name: 'gen size', type: 'response_size_under', enabled: true, expected: 1000 },
    ]),
    response: {
      status: 201,
      statusText: 'Created',
      headers: { 'Content-Type': 'application/json', 'X-Trace': ' abc ' },
      body: '{"id":1,"items":[{"n":1},{"n":2}]}',
    },
    expectEnv: {},
    expectTests: [
      { name: 'gen status', passed: true },
      { name: 'gen status wrong', passed: false },
      { name: 'gen range', passed: true },
      { name: 'gen header case', passed: true },
      { name: 'gen header missing', passed: false },
      { name: 'gen contains', passed: true },
      { name: 'gen jsonpath', passed: true },
      { name: 'gen json order', passed: false },
      { name: 'gen size', passed: true },
    ],
  },

  // ── issue #281: one shared `pm` factory (src/shared/script/pm.ts) ─────────
  // Each case below pins a former Send/Run divergence (research D1–D12) to
  // Postman's behaviour.

  // D1/D11: `get` of a missing key is `undefined` on every scope (Run said '').
  {
    name: 'missing variable is undefined on every scope (issue #281 D1/D11)',
    script: `
      pm.environment.set('d1', [
        typeof pm.environment.get('nope'),
        typeof pm.globals.get('nope'),
        typeof pm.collectionVariables.get('nope'),
        typeof pm.variables.get('nope'),
        typeof pm.iterationData.get('nope'),
      ].join(','));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { d1: 'undefined,undefined,undefined,undefined,undefined' },
    expectTests: [],
  },

  // D2/D4: globals, environment and local variables are separate scopes; the
  // merged pm.variables view is local > environment > global. Run used one map
  // for all three; Send seeded pm.environment with globals too.
  {
    name: 'globals / environment / local variables are separate scopes (issue #281 D2/D4)',
    seedEnv: { shared: 'E', onlyEnv: 'E1' },
    seedGlobals: { shared: 'G', onlyGlobal: 'G1' },
    script: `
      pm.variables.set('loc', 'L');
      pm.globals.set('gNew', 'GN');
      pm.environment.set('scopes', [
        String(pm.environment.get('onlyGlobal')),
        String(pm.globals.get('onlyEnv')),
        pm.globals.get('shared'),
        pm.environment.get('shared'),
        pm.variables.get('shared'),
        String(pm.environment.get('loc')),
        pm.variables.get('loc'),
        String(pm.environment.get('gNew')),
        pm.variables.get('gNew'),
        String(pm.environment.has('onlyGlobal')),
      ].join(','));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { scopes: 'undefined,undefined,G,E,E,undefined,L,undefined,GN,false' },
    expectTests: [],
  },

  // D5/D6: pm.info in a pre-request script (Run said eventName 'test',
  // requestName ''), plus pm.execution.location (new).
  {
    name: 'pm.info and pm.execution.location in a pre-request script (issue #281 D5/D6)',
    phase: 'prerequest',
    requestName: 'Get user',
    script: `
      pm.environment.set('event', pm.info.eventName);
      pm.environment.set('reqName', pm.info.requestName);
      pm.environment.set('loc', JSON.stringify(pm.execution.location) + '|' + pm.execution.location.current);
      pm.environment.set('respInPre', String(pm.response) + '|' + String('response' in pm));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {
      event: 'prerequest',
      reqName: 'Get user',
      loc: '["Get user"]|Get user',
      respInPre: 'undefined|false',
    },
    expectTests: [],
  },

  // D7: skipRequest() stops the rest of the script (Run kept running it).
  {
    name: 'pm.execution.skipRequest() stops the script and skips the request (issue #281 D7)',
    phase: 'prerequest',
    script: `
      pm.environment.set('beforeSkip', 'yes');
      pm.execution.skipRequest();
      pm.environment.set('afterSkip', 'LEAKED');
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { beforeSkip: 'yes' },
    expectNoEnv: ['afterSkip'],
    expectSkip: true,
    expectTests: [],
  },

  // D8: skipRequest() outside pre-request is an error (Run accepted it silently).
  {
    name: 'pm.execution.skipRequest() in a post-response script throws (issue #281 D8)',
    script: `
      let msg = 'none';
      try { pm.execution.skipRequest() } catch (e) { msg = e.message }
      pm.environment.set('postSkip', msg);
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { postSkip: 'pm.execution.skipRequest() is only available in pre-request scripts' },
    expectTests: [],
  },

  // D12: replaceIn resolves {{$dynamic}} too; unknown dynamic names stay as written.
  {
    name: 'replaceIn resolves dynamic variables (issue #281 D12)',
    seedEnv: { host: 'api.test' },
    script: `
      const out = pm.variables.replaceIn('{{host}}/{{$guid}}/{{$notAPostmanName}}/{{$randomFirstName}}');
      const parts = out.split('/');
      pm.environment.set('ri', [
        parts[0],
        /^[0-9a-f-]{36}$/.test(parts[1]) ? 'guid' : parts[1],
        parts[2],
        /^[A-Za-z' -]+$/.test(parts[3]) ? 'firstName' : parts[3],
      ].join('|'));
      const n = pm.environment.replaceIn('{{$randomInt}}');
      pm.environment.set('riEnv', /^\\d+$/.test(n) ? 'int' : n);
      const o = pm.variables.replaceIn({ u: '{{host}}', list: ['{{host}}'] });
      pm.environment.set('riObj', JSON.stringify(o));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {
      ri: 'api.test|guid|{{$notAPostmanName}}|firstName',
      riEnv: 'int',
      riObj: '{"u":"api.test","list":["api.test"]}',
    },
    expectTests: [],
  },

  // pm.request.url (Url object) + pm.request.body (RequestBody) — strings and
  // undefined before; signing scripts call getHost()/getPathWithQuery()/body.raw.
  {
    name: 'pm.request.url is a Url object and pm.request.body a RequestBody (issue #281)',
    phase: 'prerequest',
    request: {
      method: 'POST',
      url: 'https://api.parity.test:8443/v1/users?a=1&b=two',
      headers: [{ key: 'X-H', value: '1' }],
      body: { type: 'json', content: '{"n":1}' },
    },
    script: `
      const u = pm.request.url;
      pm.environment.set('url', [
        u.toString(), u.getHost(), u.getPath(), u.getQueryString(), u.getPathWithQuery(),
        u.port, u.query.get('b'), String(u.query.count()), u.protocol,
      ].join('|'));
      pm.environment.set('urlStr', pm.request.url);
      const b = pm.request.body;
      pm.environment.set('body', [b.mode, b.raw, b.options.raw.language, String(b.isEmpty())].join('|'));
      pm.environment.set('method', pm.request.method);
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {
      url: 'https://api.parity.test:8443/v1/users?a=1&b=two|api.parity.test|/v1/users|a=1&b=two|/v1/users?a=1&b=two|8443|two|2|https',
      urlStr: 'https://api.parity.test:8443/v1/users?a=1&b=two',
      body: 'raw|{"n":1}|json|false',
      method: 'POST',
    },
    expectTests: [],
  },
  {
    name: 'pm.request.body urlencoded mode, post-response (issue #281)',
    request: {
      method: 'POST',
      url: 'http://parity.test/form-body',
      body: {
        type: 'urlencoded',
        urlEncoded: [
          { key: 'a', value: '1', enabled: true },
          { key: 'b', value: '2', enabled: false },
        ],
      },
    },
    script: `
      const b = pm.request.body;
      pm.environment.set('ue', b.mode + '|' + JSON.stringify(b.urlencoded.toObject()) + '|' + b.toString());
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { ue: 'urlencoded|{"a":"1"}|a=1' },
    expectTests: [],
  },

  // pm.visualizer is a no-op (it threw and aborted the script), pm.test.skip
  // records a skipped test without running it, pm.test.index() counts.
  {
    name: 'pm.visualizer no-op, pm.test.skip and pm.test.index (issue #281)',
    script: `
      pm.visualizer.set('<b>{{x}}</b>', { x: 1 });
      pm.visualizer.clear();
      pm.test.skip('skipped one', () => { throw new Error('must not run'); });
      pm.test('counted', () => {});
      pm.environment.set('idx', String(pm.test.index()));
      pm.environment.set('afterVis', 'ran');
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { idx: '2', afterVis: 'ran' },
    expectTests: [
      { name: 'skipped one', passed: true, skipped: true },
      { name: 'counted', passed: true },
    ],
  },

  // D9: pm.response.responseTime on Run was always 0 (Send had the real time),
  // and pm.sendRequest answered with two different thin objects. Both paths
  // now get the engine timing and the full pm.response surface.
  {
    name: 'pm.response.responseTime and the pm.sendRequest response match (issue #281 D9)',
    script: `
      pm.environment.set('rt', String(pm.response.responseTime));
      const r = await pm.sendRequest('http://parity.test/aux');
      pm.environment.set('aux', [
        r.code, r.status, r.responseTime, typeof r.to.have.jsonBody,
        JSON.stringify(r.json()), String(r.size().body),
      ].join('|'));
      pm.test('aux status', () => r.to.have.status(200));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { rt: '1', aux: '200|OK|1|function|{}|2' },
    expectTests: [{ name: 'aux status', passed: true }],
  },

  // `if (pm.response)` guard in a script shared by both phases (collection /
  // folder level). Postman has no pm.response in pre-request (postman-sandbox
  // execution.js builds one only for 'test'); Send used to THROW on access and
  // Run returned null — the guard must simply take the pre-request branch.
  {
    name: 'if (pm.response) guard takes the pre-request branch without an error (issue #281)',
    phase: 'prerequest',
    script: GUARD_SCRIPT,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { guard: 'pre', afterGuard: 'ran' },
    expectSkip: false,
    expectTests: [],
  },
  {
    name: 'if (pm.response) guard takes the post-response branch (issue #281)',
    script: GUARD_SCRIPT,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { guard: 'post:200', afterGuard: 'ran' },
    expectTests: [],
  },

  // pm.sendRequest urlencoded / formdata / raw-language bodies (issue #281).
  // Both paths dropped every non-raw body. The harness transports echo
  // `{ method, body }` back for ECHO_URL, so this pins the shared normalizer's
  // output — what the engine receives — byte for byte on both paths.
  {
    name: 'pm.sendRequest sends urlencoded / formdata / raw-language bodies (issue #281)',
    script: `
      const post = (body) => pm.sendRequest({ url: '${ECHO_URL}', method: 'POST', body });
      const ue = await post({
        mode: 'urlencoded',
        urlencoded: [{ key: 'a', value: '1' }, { key: 'b', value: 2, disabled: true }],
      });
      pm.environment.set('ue', JSON.stringify(ue.json()));
      const fd = await post({ mode: 'formdata', formdata: [{ key: 'f', value: 'v', type: 'text' }] });
      pm.environment.set('fd', JSON.stringify(fd.json()));
      const xml = await post({ mode: 'raw', raw: '<a/>', options: { raw: { language: 'xml' } } });
      pm.environment.set('xml', JSON.stringify(xml.json()));
      let fileErr = 'none';
      try {
        await post({ mode: 'formdata', formdata: [{ key: 'up', type: 'file', src: '/etc/hosts' }] });
      } catch (e) { fileErr = e.message }
      pm.environment.set('fileErr', fileErr);
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {
      ue: JSON.stringify({
        method: 'POST',
        body: {
          type: 'urlencoded',
          urlEncoded: [
            { id: 'pm-ue-0', key: 'a', value: '1', enabled: true },
            { id: 'pm-ue-1', key: 'b', value: '2', enabled: false },
          ],
        },
      }),
      fd: JSON.stringify({
        method: 'POST',
        body: {
          type: 'form-data',
          formData: [{ id: 'pm-fd-0', key: 'f', value: 'v', enabled: true, type: 'text' }],
        },
      }),
      xml: JSON.stringify({ method: 'POST', body: { type: 'xml', content: '<a/>' } }),
      fileErr: 'pm.sendRequest: file part "up" in a formdata body is not supported in scripts',
    },
    expectTests: [],
  },

  // ── issue #281: collection variables = project variables; pm.vault ─────────
  // A Testnizer project is the Postman collection: pm.collectionVariables reads
  // and writes the project variables (the "Globals" list), the SAME scope as
  // pm.globals. It used to alias pm.environment on both paths.
  {
    name: 'pm.collectionVariables is the project-variable scope (issue #281)',
    seedEnv: { both: 'E' },
    seedGlobals: { cvSeed: 'C', both: 'G' },
    script: `
      pm.collectionVariables.set('cvNew', 'N');
      pm.environment.set('cv281', [
        pm.collectionVariables.get('cvSeed'),
        pm.globals.get('cvNew'),
        typeof pm.environment.get('cvNew'),
        typeof pm.environment.get('cvSeed'),
        pm.variables.get('both'),
        insomnia.baseEnvironment.get('cvSeed'),
        bru.getCollectionVar('cvNew'),
      ].join(','));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { cv281: 'C,N,undefined,undefined,E,C,N' },
    expectGlobals: { cvNew: 'N' },
    expectNoEnv: ['cvNew'],
    expectTests: [],
  },

  // ── issue #289: insomnia.environment is Insomnia's ACTIVE environment ──────
  // With no sub-environment selected Insomnia's active environment IS the base
  // environment (network.ts: `activeEnvironment || baseEnvironment`). The
  // importer writes the base environment to the project variables, so with no
  // Testnizer environment selected insomnia.environment reads and writes them.
  {
    name: 'insomnia.environment with no environment selected is the base environment (issue #289)',
    noActiveEnvironment: true,
    phase: 'prerequest',
    seedGlobals: { AccessURL: 'http://base' },
    script: `
      insomnia.environment.set('token289', 'T-' + insomnia.environment.get('AccessURL'));
      pm.globals.set('seen289', [
        insomnia.environment.get('token289'),
        insomnia.baseEnvironment.get('token289'),
        typeof pm.environment.get('token289'),
        String(insomnia.environment.has('AccessURL')),
      ].join(','));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {},
    expectGlobals: {
      token289: 'T-http://base',
      seen289: 'T-http://base,T-http://base,undefined,true',
    },
    expectNoEnv: ['token289', 'seen289'],
    expectTests: [],
  },
  // A selected environment stays insomnia.environment — what a project
  // imported before issue #289 has (its base environment became an ordinary,
  // active environment); it behaves exactly as before.
  {
    name: 'insomnia.environment with an environment selected is that environment (issue #289)',
    phase: 'prerequest',
    seedEnv: { AccessURL: 'http://env' },
    seedGlobals: { AccessURL: 'http://base' },
    script: `
      insomnia.environment.set('token289b', 'T-' + insomnia.environment.get('AccessURL'));
      insomnia.environment.set('seen289b', [
        insomnia.environment.get('token289b'),
        typeof insomnia.baseEnvironment.get('token289b'),
        insomnia.baseEnvironment.get('AccessURL'),
        pm.environment.get('token289b'),
      ].join(','));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {
      token289b: 'T-http://env',
      seen289b: 'T-http://env,undefined,http://base,T-http://env',
    },
    expectTests: [],
  },

  // pm.vault → the project's SECRET variables: get reads only secret ones, set
  // creates/updates one as secret (and it resolves at once like any project
  // variable), unset deletes it.
  {
    name: 'pm.vault reads and writes secret project variables (issue #281)',
    seedGlobals: { plain: 'P' },
    seedSecretGlobals: { vaultTok: 'S1', keepMe: 'K' },
    script: `
      const a = await pm.vault.get('vaultTok');
      const b = await pm.vault.get('plain');
      await pm.vault.set('newSecret', 'NS');
      const c = pm.globals.get('newSecret');
      await pm.vault.unset('vaultTok');
      await pm.vault.unset('plain');
      pm.environment.set('vault281', [
        a,
        typeof b,
        c,
        await pm.vault.get('newSecret'),
        typeof pm.globals.get('vaultTok'),
        pm.globals.get('plain'),
      ].join(','));
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: { vault281: 'S1,undefined,NS,NS,undefined,P' },
    expectVault: { newSecret: 'NS', vaultTok: null },
    expectTests: [],
  },

  // pm.require (Postman package library) is not supported: a clear error names
  // the package instead of "pm.require is not a function".
  {
    name: 'pm.require throws a clear error naming the package (issue #281)',
    script: `
      pm.test('pm.require explains itself', () => {
        pm.expect(() => pm.require('npm:lodash@4.17.21')).to.throw(
          'pm.require is not supported in Testnizer: npm:lodash@4.17.21',
        );
      });
    `,
    response: { status: 200, statusText: 'OK', headers: jsonHeaders, body: TOKEN_BODY },
    expectEnv: {},
    expectTests: [{ name: 'pm.require explains itself', passed: true }],
  },
]
