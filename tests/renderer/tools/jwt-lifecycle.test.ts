/**
 * Renderer JWT helpers — what #63 ADDED, plus the regression that pins what it
 * must NOT have changed.
 *
 * The additive invariant is the whole point of this file. The JWT Debugger is a
 * live screen with 600+ users: pasting a secret or a PEM and hitting Decode /
 * Verify / Sign has to behave exactly as it did before the lifecycle work, and
 * the new claim editor, JWE vocabulary and structural inspection have to be
 * things a user can ignore entirely. So section 1 pins the OLD exports against
 * static fixtures, and only then does the rest test the new ones.
 */
import { describe, it, expect } from 'vitest'
import {
  // pre-existing — must keep working byte-for-byte
  decodeJwt,
  verifyJwt,
  signJwt,
  isExpired,
  isNotYetValid,
  secondsUntilExpiry,
  humanReadableClaims,
  claimsToTable,
  isAsymmetric,
  generateSampleJwt,
  JWT_ALGORITHMS,
  // added by #63
  JWE_KEY_ALGORITHMS,
  JWE_CONTENT_ENCRYPTIONS,
  isSymmetricJweAlgorithm,
  parseJoseHeader,
  parseDurationToSeconds,
  formatDuration,
  describeExpiry,
  applyClaimEdits,
  claimEditsFromPayload,
} from '../../../src/renderer/lib/tools/jwt'

/** jwt.io's canonical HS256 sample — the value the tool ships as its default. */
const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
const SAMPLE_SECRET = 'your-256-bit-secret'

const NOW = 1_700_000_000

// ═══════════════════════════════════════════════════════════════════════════
// 1. REGRESSION — the pre-#63 surface is untouched
// ═══════════════════════════════════════════════════════════════════════════

describe('the pre-existing decode / verify / sign path is unchanged', () => {
  it('decodes the sample token exactly as before', () => {
    const r = decodeJwt(SAMPLE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.jwt.header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(r.jwt.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 })
    expect(r.jwt.raw.signature).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')
  })

  it('still reports the same errors for malformed input', () => {
    expect(decodeJwt('')).toEqual({ ok: false, error: 'Token is empty' })
    expect(decodeJwt('a.b')).toMatchObject({ ok: false })
    expect(decodeJwt('a.b')).toMatchObject({ error: expect.stringContaining('3 dot-separated') })
  })

  it('verifies with a pasted secret, in the renderer, with no bridge involved', async () => {
    const good = await verifyJwt(SAMPLE, SAMPLE_SECRET, 'HS256')
    expect(good).toMatchObject({ ok: true, valid: true })

    const bad = await verifyJwt(SAMPLE, 'not-the-secret', 'HS256')
    expect(bad).toMatchObject({ ok: true, valid: false })
  })

  it('signs locally with a pasted secret and the token verifies', async () => {
    const signed = await signJwt({ sub: 'local' }, SAMPLE_SECRET, 'HS256')
    expect(signed.ok).toBe(true)
    if (!signed.ok) return
    await expect(verifyJwt(signed.token, SAMPLE_SECRET, 'HS256')).resolves.toMatchObject({
      valid: true,
    })
  })

  it('keeps the alg=none escape hatch and the claim/table helpers', async () => {
    const none = await signJwt({ sub: 'x' }, '', 'none')
    expect(none.ok).toBe(true)
    if (none.ok) expect(none.token.endsWith('.')).toBe(true)

    expect(isExpired({ exp: NOW - 1 }, NOW)).toBe(true)
    expect(isExpired({}, NOW)).toBe(false)
    expect(isNotYetValid({ nbf: NOW + 1 }, NOW)).toBe(true)
    expect(secondsUntilExpiry({ exp: NOW + 60 }, NOW)).toBe(60)
    expect(humanReadableClaims({ exp: 0 }).exp_iso).toBe('1970-01-01T00:00:00.000Z')
    expect(claimsToTable({ sub: 'a' })[0]).toMatchObject({ key: 'sub', value: 'a' })
    expect(isAsymmetric('RS256')).toBe(true)
    expect(isAsymmetric('HS256')).toBe(false)
  })

  it('still exposes the whole algorithm list, `none` included', () => {
    expect(JWT_ALGORITHMS).toContain('HS256')
    expect(JWT_ALGORITHMS).toContain('EdDSA')
    expect(JWT_ALGORITHMS).toContain('none')
  })

  it('still generates a runnable sample for an asymmetric algorithm', async () => {
    const r = await generateSampleJwt('ES256')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sample.privateKey).toContain('BEGIN PRIVATE KEY')
    expect(r.sample.publicKey).toContain('BEGIN PUBLIC KEY')
    await expect(
      verifyJwt(r.sample.token, r.sample.publicKey as string, 'ES256'),
    ).resolves.toMatchObject({ valid: true })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Structural inspection — no key, no crypto, no decryption
// ═══════════════════════════════════════════════════════════════════════════

describe('parseJoseHeader', () => {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')

  it('reads a JWS protected header and reports 3 segments', () => {
    const r = parseJoseHeader(SAMPLE)
    expect(r.kind).toBe('jws')
    expect(r.segments).toBe(3)
    if ('header' in r) expect(r.header.alg).toBe('HS256')
  })

  it('recognizes a 5-segment JWE and reads alg/enc WITHOUT decrypting', () => {
    const jwe = [b64({ alg: 'RSA-OAEP', enc: 'A256GCM' }), 'key', 'iv', 'ct', 'tag'].join('.')
    const r = parseJoseHeader(jwe)
    expect(r.kind).toBe('jwe')
    expect(r.segments).toBe(5)
    if ('header' in r) {
      expect(r.header.alg).toBe('RSA-OAEP')
      expect(r.header.enc).toBe('A256GCM')
    }
  })

  it('fails readably on the wrong number of segments or a broken header', () => {
    const wrongCount = parseJoseHeader('a.b')
    expect(wrongCount.kind).toBe('unknown')
    if ('error' in wrongCount) expect(wrongCount.error).toContain('3 segments')

    const brokenHeader = parseJoseHeader('!!!.b.c')
    expect(brokenHeader.kind).toBe('unknown')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. JWE vocabulary
// ═══════════════════════════════════════════════════════════════════════════

describe('JWE algorithm vocabulary', () => {
  it('offers the families the main-process handler can actually run', () => {
    expect(JWE_KEY_ALGORITHMS).toContain('RSA-OAEP-256')
    expect(JWE_KEY_ALGORITHMS).toContain('ECDH-ES')
    expect(JWE_KEY_ALGORITHMS).toContain('dir')
    expect(JWE_CONTENT_ENCRYPTIONS).toContain('A256GCM')
    expect(JWE_CONTENT_ENCRYPTIONS).toContain('A128CBC-HS256')
  })

  it("mirrors main's symmetric classification exactly", () => {
    // Kept structurally in sync with `isSymmetricJweAlg` in
    // src/main/lib/jose-runtime.ts — the renderer uses it only to label a
    // field, main re-decides it before touching a key.
    for (const alg of ['dir', 'A128KW', 'A256KW', 'A192GCMKW', 'PBES2-HS512+A256KW']) {
      expect(isSymmetricJweAlgorithm(alg)).toBe(true)
    }
    for (const alg of ['RSA-OAEP', 'RSA-OAEP-512', 'ECDH-ES', 'ECDH-ES+A128KW']) {
      expect(isSymmetricJweAlgorithm(alg)).toBe(false)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Human-readable time + the claim editor
// ═══════════════════════════════════════════════════════════════════════════

describe('durations and expiry', () => {
  it('parses the offsets a tester actually types', () => {
    expect(parseDurationToSeconds('45s')).toBe(45)
    expect(parseDurationToSeconds('15m')).toBe(900)
    expect(parseDurationToSeconds('2h')).toBe(7200)
    expect(parseDurationToSeconds('7d')).toBe(604800)
    expect(parseDurationToSeconds('1w')).toBe(604800)
    expect(parseDurationToSeconds('3600')).toBe(3600)
    expect(parseDurationToSeconds(-30)).toBe(-30)
    expect(parseDurationToSeconds('-30s')).toBe(-30)
  })

  it('returns null for anything it cannot read, instead of NaN', () => {
    expect(parseDurationToSeconds('')).toBeNull()
    expect(parseDurationToSeconds('soon')).toBeNull()
    expect(parseDurationToSeconds('15 fortnights')).toBeNull()
  })

  it('formats a duration to at most two units', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(3725)).toBe('1h 2m')
    expect(formatDuration(90061)).toBe('1d 1h')
    expect(formatDuration(-30)).toBe('30s')
  })

  it('describes expiry against an injected instant', () => {
    expect(describeExpiry({}, NOW)).toMatchObject({ state: 'none' })

    const valid = describeExpiry({ exp: NOW + 3725 }, NOW)
    expect(valid.state).toBe('valid')
    expect(valid.text).toBe('expires in 1h 2m')
    expect(valid.iso).toBe(new Date((NOW + 3725) * 1000).toISOString())

    const expired = describeExpiry({ exp: NOW - 90061 }, NOW)
    expect(expired.state).toBe('expired')
    expect(expired.text).toBe('expired 1d 1h ago')
    expect(expired.secondsRemaining).toBe(-90061)
  })
})

describe('applyClaimEdits', () => {
  const base = { sub: 'original', custom: { nested: true }, scope: 'read' }

  it('is a no-op with no edits — the additive invariant, in one assertion', () => {
    expect(applyClaimEdits(base, {}, NOW)).toEqual(base)
  })

  it('never mutates the payload it was given', () => {
    const snapshot = JSON.parse(JSON.stringify(base)) as typeof base
    applyClaimEdits(base, { sub: 'changed', expiresIn: '15m' }, NOW)
    expect(base).toEqual(snapshot)
  })

  it('sets the registered claims and preserves everything else', () => {
    const out = applyClaimEdits(
      base,
      {
        iss: 'https://idp.example.com',
        sub: 'user-123',
        aud: 'api://payments',
        jti: 'abc',
        issuedAt: true,
        expiresIn: '15m',
        notBeforeIn: '0s',
      },
      NOW,
    )
    expect(out).toMatchObject({
      iss: 'https://idp.example.com',
      sub: 'user-123',
      aud: 'api://payments',
      jti: 'abc',
      iat: NOW,
      exp: NOW + 900,
      nbf: NOW,
      // untouched custom claims survive — the form is a convenience over the
      // JSON editor, never a replacement for it
      custom: { nested: true },
      scope: 'read',
    })
  })

  it('removes a claim when the field is blanked — the only way to say "no expiry"', () => {
    const withExp = applyClaimEdits(base, { expiresIn: '15m', issuedAt: true }, NOW)
    const cleared = applyClaimEdits(withExp, { expiresIn: '', issuedAt: false, sub: '' }, NOW)
    expect(cleared).not.toHaveProperty('exp')
    expect(cleared).not.toHaveProperty('iat')
    expect(cleared).not.toHaveProperty('sub')
    expect(cleared.scope).toBe('read')
  })

  it('leaves an existing claim alone when the offset is unreadable', () => {
    const withExp = applyClaimEdits(base, { expiresIn: '15m' }, NOW)
    const unreadable = applyClaimEdits(withExp, { expiresIn: 'whenever' }, NOW)
    expect(unreadable.exp).toBe(NOW + 900)
  })

  it('accepts a negative offset so an already-expired token can be produced', () => {
    const out = applyClaimEdits(base, { expiresIn: '-60s' }, NOW)
    expect(out.exp).toBe(NOW - 60)
    expect(describeExpiry(out, NOW).state).toBe('expired')
  })
})

describe('claimEditsFromPayload', () => {
  it('round-trips through applyClaimEdits', () => {
    const payload = {
      iss: 'https://idp.example.com',
      sub: 'user-123',
      aud: 'api://payments',
      jti: 'abc',
      iat: NOW,
      exp: NOW + 900,
      nbf: NOW - 30,
      custom: 'kept',
    }
    const edits = claimEditsFromPayload(payload, NOW)
    expect(edits).toMatchObject({
      iss: 'https://idp.example.com',
      sub: 'user-123',
      issuedAt: true,
      expiresIn: '900s',
      notBeforeIn: '-30s',
    })
    expect(applyClaimEdits(payload, edits, NOW)).toEqual(payload)
  })

  it('renders an array audience readably and reports absent claims as empty', () => {
    const edits = claimEditsFromPayload({ aud: ['a', 'b'] }, NOW)
    expect(edits.aud).toBe('a,b')
    expect(edits.iss).toBe('')
    expect(edits.issuedAt).toBe(false)
    expect(edits.expiresIn).toBe('')
  })
})
