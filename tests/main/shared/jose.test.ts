/**
 * src/shared/script/jose.ts — the sandbox JOSE surface (#73).
 *
 * Unit-level coverage of BOTH exposure arms:
 *   • `require('jose')` — the raw library, registered in require.ts exactly like
 *     lodash/crypto-js, resolved from a statically imported namespace.
 *   • `pm.jose.*` — the documented helper wrapping the same primitives.
 * Cross-path behaviour (Send ≡ Run) is proven separately by the parity suites
 * (tests/{renderer,main}/script-parity.test.ts, cases h–k) and the header-flow
 * pair (tests/{renderer,main}/jose-header-flow.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sandboxRequire } from '../../../src/shared/script/require'
import { createJoseHelper, joseModule } from '../../../src/shared/script/jose'
import { buildScriptBindings } from '../../../src/shared/script/index'
import { makeFakePm } from './helpers'

const helper = createJoseHelper()
const SECRET = 'mkk-shared-secret'

describe("require('jose')", () => {
  it('resolves the jose namespace with the sign/verify primitives', () => {
    const jose = sandboxRequire('jose') as typeof import('jose')
    expect(typeof jose.SignJWT).toBe('function')
    expect(typeof jose.jwtVerify).toBe('function')
    expect(typeof jose.CompactSign).toBe('function')
    expect(typeof jose.compactVerify).toBe('function')
    expect(typeof jose.importPKCS8).toBe('function')
  })

  it('is the same module object the helper exposes as pm.jose.jose', () => {
    expect(sandboxRequire('jose')).toBe(joseModule)
    expect(helper.jose).toBe(joseModule)
  })

  it('does NOT open sub-path specifiers or Node builtins', () => {
    for (const name of ['jose/jwt/sign', 'jose/jwk/thumbprint', 'fs', 'node:crypto', 'axios']) {
      expect(() => sandboxRequire(name), name).toThrow(/Cannot find module/)
    }
  })
})

describe('pm.jose — JWT sign/verify', () => {
  it('HS256 with a raw secret is deterministic and verifies', async () => {
    const token = await helper.sign({ sub: 'MKK' }, SECRET, { alg: 'HS256' })
    expect(token).toBe(
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJNS0sifQ.1jq4zS0sREr069b62T-m2eaRPYgJAv8bEORCrfLV6Js',
    )
    const again = await helper.sign({ sub: 'MKK' }, SECRET, { alg: 'HS256' })
    expect(again).toBe(token)

    const { payload, header } = await helper.verify(token, SECRET)
    expect(payload.sub).toBe('MKK')
    expect(header.alg).toBe('HS256')
  })

  it('defaults to HS256 for a plain secret (no alg needed)', async () => {
    const token = await helper.sign({ a: 1 }, SECRET)
    expect(helper.decode(token).header.alg).toBe('HS256')
  })

  it('adds registered claims + extra protected-header members on request', async () => {
    const token = await helper.sign({ x: 1 }, SECRET, {
      alg: 'HS256',
      header: { kid: 'k-1', typ: 'JWT' },
      issuer: 'testnizer',
      audience: 'mkk',
      subject: 'user-9',
      jwtid: 'jti-1',
      expiresIn: '2h',
      notBefore: 0,
      issuedAt: true,
    })
    const { header, payload } = helper.decode(token)
    expect(header.kid).toBe('k-1')
    expect(header.typ).toBe('JWT')
    expect(payload.iss).toBe('testnizer')
    expect(payload.aud).toBe('mkk')
    expect(payload.sub).toBe('user-9')
    expect(payload.jti).toBe('jti-1')
    expect(typeof payload.iat).toBe('number')
    expect(payload.exp as number).toBeGreaterThan(payload.iat as number)
  })

  it('omits iat unless asked (keeps tokens reproducible)', async () => {
    const { payload } = helper.decode(await helper.sign({ a: 1 }, SECRET, { alg: 'HS256' }))
    expect(payload.iat).toBeUndefined()
  })

  it('verify failure throws a normal Error carrying jose semantics', async () => {
    const token = await helper.sign({ a: 1 }, 'right', { alg: 'HS256' })
    await expect(helper.verify(token, 'wrong')).rejects.toThrow('signature verification failed')
    const err = await helper.verify(token, 'wrong').catch((e: Error & { code?: string }) => e)
    expect((err as Error & { code?: string }).code).toBe('ERR_JWS_SIGNATURE_VERIFICATION_FAILED')
  })

  it('enforces the algorithms allow-list (alg-confusion guard)', async () => {
    const token = await helper.sign({ a: 1 }, SECRET, { alg: 'HS256' })
    await expect(helper.verify(token, SECRET, { algorithms: ['HS512'] })).rejects.toThrow(/alg/i)
  })

  it('enforces issuer/audience claim checks', async () => {
    const token = await helper.sign({ a: 1 }, SECRET, { alg: 'HS256', issuer: 'testnizer' })
    await expect(helper.verify(token, SECRET, { issuer: 'someone-else' })).rejects.toThrow(/iss/i)
    await expect(helper.verify(token, SECRET, { issuer: 'testnizer' })).resolves.toBeTruthy()
  })
})

describe('pm.jose — asymmetric keys', () => {
  it('round-trips ES256 through generated PKCS#8 / SPKI PEMs', async () => {
    const kp = await helper.generateKeyPair('ES256')
    expect(kp.privateKey).toContain('BEGIN PRIVATE KEY')
    expect(kp.publicKey).toContain('BEGIN PUBLIC KEY')

    const token = await helper.sign({ sub: 'ec' }, kp.privateKey, { alg: 'ES256' })
    // verify infers alg from the token header when not pinned
    const { payload } = await helper.verify(token, kp.publicKey)
    expect(payload.sub).toBe('ec')
  })

  it('round-trips RS256 and accepts a JWK key (alg inferred from kty)', async () => {
    const kp = await helper.generateKeyPair('RS256')
    const token = await helper.sign({ sub: 'rsa' }, kp.privateKey, { alg: 'RS256' })
    const { payload } = await helper.verify(token, kp.publicJwk)
    expect(payload.sub).toBe('rsa')
  })

  it('generateKeyPair returns a PUBLIC-only JWK (no private members)', async () => {
    const kp = await helper.generateKeyPair('ES256')
    for (const m of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k']) {
      expect(kp.publicJwk, `publicJwk.${m}`).not.toHaveProperty(m)
    }
  })

  it('requires an explicit alg for PEM keys and says so', async () => {
    const kp = await helper.generateKeyPair('ES256')
    await expect(helper.sign({ a: 1 }, kp.privateKey)).rejects.toThrow(
      /`alg` is required for PEM keys/,
    )
  })

  it('rejects PKCS#1 PEM with a conversion hint instead of a jose stack trace', async () => {
    const pkcs1 = '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----'
    await expect(helper.sign({ a: 1 }, pkcs1, { alg: 'RS256' })).rejects.toThrow(/PKCS#8/)
  })
})

describe('pm.jose — compact JWS over an arbitrary payload', () => {
  it('signs and verifies a raw string payload', async () => {
    const jws = await helper.signJws('raw-mkk-payload', SECRET, { alg: 'HS256' })
    expect(jws.split('.')).toHaveLength(3)
    const out = await helper.verifyJws(jws, SECRET)
    expect(out.payload).toBe('raw-mkk-payload')
    expect(out.header.alg).toBe('HS256')
    expect(new TextDecoder().decode(out.bytes)).toBe('raw-mkk-payload')
  })

  it('signs bytes too, and a tampered payload fails verification', async () => {
    const jws = await helper.signJws(new TextEncoder().encode('bytes'), SECRET, { alg: 'HS256' })
    expect((await helper.verifyJws(jws, SECRET)).payload).toBe('bytes')
    const [h, , s] = jws.split('.')
    await expect(helper.verifyJws(`${h}.dGFtcGVy.${s}`, SECRET)).rejects.toThrow(
      'signature verification failed',
    )
  })
})

describe('buildScriptBindings wiring', () => {
  const fakeCtx = () => makeFakePm().ctx

  it('attaches pm.jose exactly once, and the same instance for every run', () => {
    const a = fakeCtx()
    const b = fakeCtx()
    buildScriptBindings(a)
    buildScriptBindings(b)
    expect(a.pm.jose).toBeDefined()
    expect(a.pm.jose).toBe(b.pm.jose)
    expect(typeof a.pm.jose!.sign).toBe('function')
  })

  it('does not add a bare `jose` global (require/pm.jose are the only doors)', () => {
    const { bindings } = buildScriptBindings(fakeCtx())
    expect(bindings.jose).toBeUndefined()
    expect(typeof bindings.require).toBe('function')
  })
})

/**
 * ESM-in-main containment (the v1.4.19 ERR_REQUIRE_ESM launch-crash class).
 *
 * jose@6 is ESM-only. electron-vite externalizes every dependency to a runtime
 * `require()`, which Electron 33's Node 20 cannot do for an ES module — the app
 * would die before a window opens. Two things must therefore hold forever:
 *   1. jose stays in `externalizeDepsPlugin({ exclude: [...] })`, so Rollup
 *      BUNDLES it into out/main;
 *   2. every jose import is STATIC (no `await import`, no `require(varName)`),
 *      so both Rollup (main) and Vite (renderer) can see and bundle it.
 * These greps are the executable form of that contract — bare `node` cannot
 * prove it (Node ≥22 supports require(ESM) and hides the bug), so the real
 * gate is a production build + smoke; this test keeps the source honest.
 */
describe('ESM containment — jose enters the bundles statically', () => {
  const root = process.cwd()
  const read = (p: string): string => readFileSync(join(root, p), 'utf-8')

  /** Code lines only — comments mentioning jose don't count as imports. */
  function importsJose(source: string): boolean {
    return source
      .split('\n')
      .filter((l) => {
        const t = l.trim()
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
      })
      .some((l) =>
        // Both quote styles AND sub-path specifiers ('jose/jwt/sign'): a narrow
        // matcher would let a third door open without this guard noticing.
        /from\s+['"]jose(\/[^'"]*)?['"]|require\(\s*['"]jose(\/[^'"]*)?['"]\s*\)|import\(\s*['"]jose(\/[^'"]*)?['"]\s*\)/.test(
          l,
        ),
      )
  }

  function filesImportingJose(dir: string): string[] {
    const out: string[] = []
    const walk = (d: string): void => {
      for (const entry of readdirSync(join(root, d), { withFileTypes: true })) {
        const rel = `${d}/${entry.name}`
        if (entry.isDirectory()) walk(rel)
        else if (/\.tsx?$/.test(entry.name) && importsJose(read(rel))) out.push(rel)
      }
    }
    walk(dir)
    return out.sort()
  }

  it('the main graph imports jose from exactly two doors', () => {
    expect([...filesImportingJose('src/main'), ...filesImportingJose('src/shared')]).toEqual([
      'src/main/lib/jose-runtime.ts',
      'src/shared/script/jose.ts',
    ])
  })

  it('electron-vite still excludes jose from externalization', () => {
    const config = read('electron.vite.config.ts')
    expect(config).toMatch(/externalizeDepsPlugin\(\{\s*exclude:\s*\[[^\]]*'jose'[^\]]*\]/)
  })

  it('the shared runtime resolves jose statically, never dynamically', () => {
    const src = read('src/shared/script/jose.ts')
    expect(src).toContain("import * as jose from 'jose'")
    expect(src).not.toMatch(/import\(\s*['"`]jose/)
    // sandboxRequire is a lookup in a map built at module-eval time — no
    // bundler-invisible dynamic resolution anywhere in the require broker.
    const req = read('src/shared/script/require.ts')
    expect(req).toContain("import { joseModule } from './jose'")
    expect(req).not.toMatch(/import\(|createRequire|eval\(/)
  })
})
