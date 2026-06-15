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
]
