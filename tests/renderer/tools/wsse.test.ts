/**
 * Tests for the renderer-side WS-Security tool wrapper
 * (`src/renderer/lib/tools/wsse.ts`).
 *
 * That module is deliberately thin: the real sign/verify/encrypt/UsernameToken
 * logic lives in the main process (`src/main/protocols/wsse.engine.ts`) because
 * it needs Node's `crypto` + xml-crypto/xml-encryption, none of which run in the
 * browser. The renderer only bridges to it through `window.api.wsse`.
 *
 * So this file does two things:
 *   1. Exercises every branch of the wrapper (success, IPC error, undefined
 *      data, missing bridge) and the default-config helpers it exports.
 *   2. Wires the stubbed `apply` bridge to the REAL engine so we can make
 *      concrete WS-Security assertions on the produced envelope — including a
 *      hand-computed `Base64(SHA1(nonce + created + password))` PasswordDigest
 *      check, which the engine's own suite only loosely (length-only) asserts.
 *
 * NOTE: tests/renderer/tools/** run in the `tools` vitest project, which uses
 * `environment: 'node'` (see vitest.config.ts). There is no `window` global, so
 * we install one with `vi.stubGlobal`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'

import {
  applyWsSecurity,
  verifySignature,
  decryptEnvelope,
  defaultUsernameToken,
  defaultTimestamp,
  defaultSignConfig,
  defaultEncryptConfig,
  buildSingleModeConfig,
} from '../../../src/renderer/lib/tools/wsse'
import { applyWsSecurity as engineApply } from '../../../src/main/protocols/wsse.engine'
import type { WsSecurityConfig } from '../../../src/renderer/types'

const SAMPLE_ENVELOPE = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body>
    <tns:Echo xmlns:tns="http://testnizer.com/echo">
      <tns:Message>Hello, WSSE</tns:Message>
    </tns:Echo>
  </soap:Body>
</soap:Envelope>`

const PASSWORD_TEXT_TYPE =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText'
const PASSWORD_DIGEST_TYPE =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest'

interface WsseBridge {
  apply: ReturnType<typeof vi.fn>
  verify: ReturnType<typeof vi.fn>
  decrypt: ReturnType<typeof vi.fn>
}

let bridge: WsseBridge

/** Install a fresh `window.api.wsse` stub before each test. */
function installBridge(b: WsseBridge): void {
  vi.stubGlobal('window', { api: { wsse: b } })
}

beforeEach(() => {
  bridge = {
    apply: vi.fn(),
    verify: vi.fn(),
    decrypt: vi.fn(),
  }
  installBridge(bridge)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Wrapper plumbing: applyWsSecurity ──────────────────────────────────────

describe('applyWsSecurity wrapper', () => {
  it('returns data on success and forwards the exact { envelope, config } payload', async () => {
    bridge.apply.mockResolvedValue({ success: true, data: '<signed/>' })
    const config = buildSingleModeConfig('username-token', {
      usernameToken: { username: 'u', password: 'p', passwordType: 'PasswordText', nonce: false, created: false },
    })

    const out = await applyWsSecurity(SAMPLE_ENVELOPE, config)

    expect(out).toBe('<signed/>')
    expect(bridge.apply).toHaveBeenCalledWith({ envelope: SAMPLE_ENVELOPE, config })
  })

  it('throws with the IPC error message when success is false', async () => {
    bridge.apply.mockResolvedValue({ success: false, error: 'boom' })
    await expect(applyWsSecurity(SAMPLE_ENVELOPE, { enabled: true, modes: [] })).rejects.toThrow(
      'boom',
    )
  })

  it('throws a default message when success is false with no error string', async () => {
    bridge.apply.mockResolvedValue({ success: false })
    await expect(applyWsSecurity(SAMPLE_ENVELOPE, { enabled: true, modes: [] })).rejects.toThrow(
      'apply failed',
    )
  })

  it('throws when success is true but data is undefined', async () => {
    bridge.apply.mockResolvedValue({ success: true, data: undefined })
    await expect(applyWsSecurity(SAMPLE_ENVELOPE, { enabled: true, modes: [] })).rejects.toThrow(
      'apply failed',
    )
  })

  it('throws a clear error when the IPC bridge is unavailable', async () => {
    vi.stubGlobal('window', {})
    await expect(applyWsSecurity(SAMPLE_ENVELOPE, { enabled: true, modes: [] })).rejects.toThrow(
      /bridge unavailable/i,
    )
  })
})

describe('verifySignature wrapper', () => {
  it('returns the verify result on success', async () => {
    const result = { valid: true, signedReferences: ['#Body'] }
    bridge.verify.mockResolvedValue({ success: true, data: result })

    const out = await verifySignature('<env/>', '---CERT---')

    expect(out).toBe(result)
    expect(bridge.verify).toHaveBeenCalledWith({ envelope: '<env/>', certPem: '---CERT---' })
  })

  it('throws on IPC failure', async () => {
    bridge.verify.mockResolvedValue({ success: false, error: 'bad cert' })
    await expect(verifySignature('<env/>', 'x')).rejects.toThrow('bad cert')
  })

  it('throws the default message when data is missing', async () => {
    bridge.verify.mockResolvedValue({ success: true })
    await expect(verifySignature('<env/>', 'x')).rejects.toThrow('verify failed')
  })
})

describe('decryptEnvelope wrapper', () => {
  it('returns the decrypted envelope and forwards the passphrase', async () => {
    bridge.decrypt.mockResolvedValue({ success: true, data: '<plain/>' })

    const out = await decryptEnvelope('<enc/>', '---KEY---', 'secret')

    expect(out).toBe('<plain/>')
    expect(bridge.decrypt).toHaveBeenCalledWith({
      envelope: '<enc/>',
      privateKeyPem: '---KEY---',
      passphrase: 'secret',
    })
  })

  it('omits the passphrase argument when not provided', async () => {
    bridge.decrypt.mockResolvedValue({ success: true, data: '<plain/>' })
    await decryptEnvelope('<enc/>', '---KEY---')
    expect(bridge.decrypt).toHaveBeenCalledWith({
      envelope: '<enc/>',
      privateKeyPem: '---KEY---',
      passphrase: undefined,
    })
  })

  it('throws on IPC failure', async () => {
    bridge.decrypt.mockResolvedValue({ success: false, error: 'wrong key' })
    await expect(decryptEnvelope('<enc/>', 'k')).rejects.toThrow('wrong key')
  })
})

// ─── Default config helpers ─────────────────────────────────────────────────

describe('default config helpers', () => {
  it('defaultUsernameToken is an empty PasswordText token with no nonce/created', () => {
    expect(defaultUsernameToken()).toEqual({
      username: '',
      password: '',
      passwordType: 'PasswordText',
      nonce: false,
      created: false,
    })
  })

  it('defaultTimestamp has a 300s TTL', () => {
    expect(defaultTimestamp()).toEqual({ ttlSeconds: 300 })
  })

  it('defaultSignConfig signs the Body with RSA-SHA256 + BinarySecurityToken', () => {
    expect(defaultSignConfig()).toEqual({
      privateKeyPem: '',
      certPem: '',
      algorithm: 'RSA-SHA256',
      references: ['Body'],
      keyInfoStrategy: 'BinarySecurityToken',
    })
  })

  it('defaultEncryptConfig uses AES-256-CBC + RSA-OAEP', () => {
    expect(defaultEncryptConfig()).toEqual({
      recipientCertPem: '',
      algorithm: 'AES-256-CBC',
      keyWrap: 'RSA-OAEP',
    })
  })

  it('buildSingleModeConfig wraps a single enabled mode with only that mode populated', () => {
    const ut = defaultUsernameToken()
    const cfg = buildSingleModeConfig('username-token', { usernameToken: ut })
    expect(cfg).toEqual({
      enabled: true,
      modes: ['username-token'],
      usernameToken: ut,
      timestamp: undefined,
      sign: undefined,
      encrypt: undefined,
    })
  })
})

// ─── End-to-end through the real engine ─────────────────────────────────────
//
// Wire the stubbed `apply` bridge to the REAL main-process engine so the
// renderer wrapper produces a genuine WS-Security envelope. This lets us make
// concrete structural + cryptographic assertions on the output the way a user
// of the tool would see it.

describe('UsernameToken via the real engine (through the renderer wrapper)', () => {
  beforeEach(() => {
    bridge.apply.mockImplementation(async ({ envelope, config }: { envelope: string; config: WsSecurityConfig }) => {
      try {
        // Cast: the renderer WsSecurityConfig is structurally compatible with
        // the engine's. The engine performs the actual WS-Security work.
        const data = await engineApply(envelope, config as unknown as Parameters<typeof engineApply>[1])
        return { success: true, data }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    })
  })

  function utConfig(over: Partial<{
    username: string
    password: string
    passwordType: 'PasswordText' | 'PasswordDigest'
    nonce: boolean
    created: boolean
  }>): WsSecurityConfig {
    return buildSingleModeConfig('username-token', {
      usernameToken: {
        username: over.username ?? 'admin',
        password: over.password ?? 's3cret',
        passwordType: over.passwordType ?? 'PasswordText',
        nonce: over.nonce ?? false,
        created: over.created ?? false,
      },
    })
  }

  it('PasswordText emits the plaintext password and the #PasswordText type', async () => {
    const out = await applyWsSecurity(SAMPLE_ENVELOPE, utConfig({ passwordType: 'PasswordText' }))

    expect(out).toContain('<wsse:Security')
    expect(out).toContain('soap:mustUnderstand="1"')
    expect(out).toContain('<wsse:UsernameToken')
    expect(out).toContain('<wsse:Username>admin</wsse:Username>')
    expect(out).toContain(`Type="${PASSWORD_TEXT_TYPE}"`)
    // plaintext password is present verbatim
    expect(out).toContain('>s3cret</wsse:Password>')
    // no nonce/created unless asked
    expect(out).not.toContain('<wsse:Nonce')
    expect(out).not.toContain('<wsu:Created>')
  })

  it('PasswordText with nonce + created adds both elements', async () => {
    const out = await applyWsSecurity(
      SAMPLE_ENVELOPE,
      utConfig({ passwordType: 'PasswordText', nonce: true, created: true }),
    )
    expect(out).toContain('<wsse:Nonce')
    expect(out).toMatch(/<wsu:Created>\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/wsu:Created>/)
  })

  it('PasswordDigest always emits Nonce + Created and a base64 PasswordDigest', async () => {
    const password = 'p@ss w/special&chars'
    const out = await applyWsSecurity(
      SAMPLE_ENVELOPE,
      utConfig({ passwordType: 'PasswordDigest', password }),
    )

    expect(out).toContain(`Type="${PASSWORD_DIGEST_TYPE}"`)
    expect(out).toContain('<wsse:Nonce')
    expect(out).toMatch(/<wsu:Created>\d{4}-\d{2}-\d{2}T/)

    // Pull the nonce (base64), created (ISO), and digest out of the envelope.
    const nonceB64 = out.match(/<wsse:Nonce[^>]*>([^<]+)<\/wsse:Nonce>/)![1]
    const created = out.match(/<wsu:Created>([^<]+)<\/wsu:Created>/)![1]
    const digestB64 = out.match(/<wsse:Password [^>]*>([^<]+)<\/wsse:Password>/)![1]

    // Hand-compute Base64(SHA1(nonce-bytes + created-utf8 + password-utf8))
    // and confirm it matches what the engine produced.
    const expectedDigest = createHash('sha1')
      .update(
        Buffer.concat([
          Buffer.from(nonceB64, 'base64'),
          Buffer.from(created, 'utf8'),
          Buffer.from(password, 'utf8'),
        ]),
      )
      .digest('base64')

    expect(digestB64).toBe(expectedDigest)
    // base64 of a SHA-1 digest is always 28 chars (20 bytes -> 28 b64 chars)
    expect(digestB64).toHaveLength(28)
    // the plaintext password must NOT leak in digest mode
    expect(out).not.toContain(password)
  })

  it('escapes XML-special characters in username and password (PasswordText)', async () => {
    const out = await applyWsSecurity(
      SAMPLE_ENVELOPE,
      utConfig({ username: 'a<b&c', password: 'x"y\'z', passwordType: 'PasswordText' }),
    )
    expect(out).toContain('<wsse:Username>a&lt;b&amp;c</wsse:Username>')
    expect(out).toContain('x&quot;y&apos;z')
    // raw, unescaped forms must not appear inside the token values
    expect(out).not.toContain('a<b&c')
  })

  it('handles an empty password in PasswordText (renders an empty Password element)', async () => {
    const out = await applyWsSecurity(
      SAMPLE_ENVELOPE,
      utConfig({ password: '', passwordType: 'PasswordText' }),
    )
    expect(out).toMatch(/<wsse:Password [^>]*><\/wsse:Password>/)
  })

  it('still produces a valid base64 digest for an empty password (digest = SHA1(nonce+created))', async () => {
    const out = await applyWsSecurity(
      SAMPLE_ENVELOPE,
      utConfig({ password: '', passwordType: 'PasswordDigest' }),
    )
    const nonceB64 = out.match(/<wsse:Nonce[^>]*>([^<]+)<\/wsse:Nonce>/)![1]
    const created = out.match(/<wsu:Created>([^<]+)<\/wsu:Created>/)![1]
    const digestB64 = out.match(/<wsse:Password [^>]*>([^<]+)<\/wsse:Password>/)![1]

    const expectedDigest = createHash('sha1')
      .update(Buffer.concat([Buffer.from(nonceB64, 'base64'), Buffer.from(created, 'utf8')]))
      .digest('base64')

    expect(digestB64).toBe(expectedDigest)
    expect(digestB64).toHaveLength(28)
  })

  it('passes the engine error back through the wrapper as a thrown error', async () => {
    // enabled but no modes -> engine returns the envelope unchanged (success),
    // so force a failure by making the engine throw via a malformed config.
    bridge.apply.mockResolvedValueOnce({ success: false, error: 'engine exploded' })
    await expect(
      applyWsSecurity(SAMPLE_ENVELOPE, utConfig({ passwordType: 'PasswordText' })),
    ).rejects.toThrow('engine exploded')
  })
})
