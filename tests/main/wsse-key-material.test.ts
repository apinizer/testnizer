/**
 * Faz C EDIT 3 — WSSE `keySource` wiring (#60, design §2.5 EDIT 3 +
 * reconcile C-1..C-4).
 *
 * Every non-negotiable invariant is pinned here as a TEST, not a comment:
 *
 *  - ADDITIVE (C-3) — WSSE's only pre-existing key input is PEM-PASTE (no
 *    file/PFX path exists in WSSE today). All SIX surfaces from the reconcile's
 *    WSSE additive table get their own regression test: wsse:apply Sign,
 *    wsse:verify, wsse:apply Encrypt, wsse:decrypt, soap:execute Sign, and both
 *    entrypoints still accepting an inline-PEM config.
 *  - C-2 + C-4     — ONE shared helper (`resolveWsseKeyMaterial`) resolves the
 *    keySource at BOTH junctions (ipc `wsse:apply` AND `executeSoap`), in the
 *    orchestration layer; `applyWsSecurity`/`applySignature` stay pure.
 *  - FAIL LOUD     — sign mode with neither a keySource nor pasted PEM errors
 *    visibly on BOTH paths; a `sign`-less config keeps its old no-op behaviour.
 *  - NO-LEAK       — the resolved private key never appears in anything that
 *    goes back to the renderer.
 */

// reflect-metadata MUST load before @peculiar/x509 (see keystore.ts header) —
// the keystore bridge pulls it in through `lib/keystore`.
import 'reflect-metadata'
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { createPrivateKey } from 'node:crypto'
import path from 'node:path'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './handlers/helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerWsseHandlers } = await import('../../src/main/ipc/wsse.handler')
const { executeSoap } = await import('../../src/main/protocols/soap.engine')
const { applyWsSecurity, verifySignature } = await import('../../src/main/protocols/wsse.engine')
const { resolveWsseKeyMaterial } = await import('../../src/main/lib/wsse-key-material')
const { createKeystore } = await import('../../src/main/db/keystore.repo')
type WsSecurityConfig = import('../../src/main/protocols/wsse.engine').WsSecurityConfig

const CERTS = path.resolve(__dirname, '../fixtures/certs')
const FIX = path.resolve(__dirname, '../fixtures/wsse')
const SAMPLE_ENVELOPE = readFileSync(path.join(FIX, 'sample-envelope.xml'), 'utf8')
const KEYSTORE_PW = 'testpassword'

const serverCertPem = readFileSync(path.join(CERTS, 'server.crt'), 'utf8')
const serverKeyPem = readFileSync(path.join(CERTS, 'server.key'), 'utf8')
const clientCertPem = readFileSync(path.join(CERTS, 'client.crt'), 'utf8')

/** Pasted-PEM sign config — exactly what the two renderer surfaces produce today. */
function pastedSignConfig(): WsSecurityConfig {
  return {
    enabled: true,
    modes: ['sign'],
    sign: {
      privateKeyPem: serverKeyPem,
      certPem: serverCertPem,
      algorithm: 'RSA-SHA256',
      references: ['Body'],
      keyInfoStrategy: 'BinarySecurityToken',
    },
  }
}

/** Persist `client.jks` as a keystore-library row (plaintext blob — safeStorage is off in tests). */
function seedClientKeystore(opts: { remember?: boolean } = {}): string {
  const bytes = readFileSync(path.join(CERTS, 'client.jks'))
  return createKeystore({
    name: 'client.jks',
    type: 'JKS',
    blob: bytes.toString('base64'),
    store_password: opts.remember === false ? null : KEYSTORE_PW,
    size_bytes: bytes.length,
  }).id
}

type ApplyResult = { success: boolean; data?: string; error?: string }

// ─── Local SOAP endpoint for the executeSoap junction ────────────────────────

let server: Server
let port = 0
let capturedBody: string | null = null

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          capturedBody = Buffer.concat(chunks).toString('utf8')
          res.writeHead(200, { 'Content-Type': 'text/xml' })
          res.end('<Envelope><Body><Ok/></Body></Envelope>')
        })
      })
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') port = addr.port
        resolve()
      })
    }),
)

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  capturedBody = null
  registerWsseHandlers()
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. ADDITIVE — the six pre-existing PEM-paste surfaces keep working
// ═══════════════════════════════════════════════════════════════════════════

describe('ADDITIVE (a) — wsse:apply Sign with pasted cert + key PEM', () => {
  it('still signs, byte-for-byte the old path (no keySource anywhere)', async () => {
    const res = (await harness.invoke('wsse:apply', {
      envelope: SAMPLE_ENVELOPE,
      config: pastedSignConfig(),
    })) as ApplyResult

    expect(res.success).toBe(true)
    expect(res.data).toContain('Signature')
    expect(res.data).toContain('BinarySecurityToken')
    expect(verifySignature(res.data as string, serverCertPem).valid).toBe(true)
  })

  it('signs with IssuerSerial KeyInfo + a multi-reference pasted config too', async () => {
    const res = (await harness.invoke('wsse:apply', {
      envelope: SAMPLE_ENVELOPE,
      config: {
        enabled: true,
        modes: ['timestamp', 'sign'],
        timestamp: { ttlSeconds: 60 },
        sign: {
          privateKeyPem: serverKeyPem,
          certPem: serverCertPem,
          algorithm: 'RSA-SHA512',
          references: ['Body', 'Timestamp'],
          keyInfoStrategy: 'IssuerSerial',
        },
      } satisfies WsSecurityConfig,
    })) as ApplyResult

    expect(res.success).toBe(true)
    expect(res.data).toContain('X509IssuerSerial')
    expect(verifySignature(res.data as string, serverCertPem).valid).toBe(true)
  })
})

describe('ADDITIVE (b) — wsse:verify with a pasted certificate PEM', () => {
  it('verifies a signed envelope against the pasted cert, unchanged', async () => {
    const signed = await applyWsSecurity(SAMPLE_ENVELOPE, pastedSignConfig())
    const res = (await harness.invoke('wsse:verify', {
      envelope: signed,
      certPem: serverCertPem,
    })) as { success: boolean; data?: { valid: boolean; signedReferences: string[] } }

    expect(res.success).toBe(true)
    expect(res.data?.valid).toBe(true)
  })

  it('reports invalid for a pasted cert that did not sign the envelope', async () => {
    const signed = await applyWsSecurity(SAMPLE_ENVELOPE, pastedSignConfig())
    const res = (await harness.invoke('wsse:verify', {
      envelope: signed,
      certPem: clientCertPem,
    })) as { success: boolean; data?: { valid: boolean } }

    expect(res.success).toBe(true)
    expect(res.data?.valid).toBe(false)
  })
})

describe('ADDITIVE (c) — wsse:apply Encrypt with a pasted recipient cert PEM', () => {
  it('still encrypts the body, unchanged', async () => {
    const res = (await harness.invoke('wsse:apply', {
      envelope: SAMPLE_ENVELOPE,
      config: {
        enabled: true,
        modes: ['encrypt'],
        encrypt: {
          recipientCertPem: serverCertPem,
          algorithm: 'AES-256-CBC',
          keyWrap: 'RSA-OAEP',
        },
      } satisfies WsSecurityConfig,
    })) as ApplyResult

    expect(res.success).toBe(true)
    expect(res.data).toContain('EncryptedData')
    expect(res.data).not.toContain('<tns:Echo')
  })
})

describe('ADDITIVE (d) — wsse:decrypt with a pasted key PEM + passphrase', () => {
  const encryptConfig: WsSecurityConfig = {
    enabled: true,
    modes: ['encrypt'],
    encrypt: { recipientCertPem: serverCertPem, algorithm: 'AES-256-CBC', keyWrap: 'RSA-OAEP' },
  }

  it('decrypts with a pasted plain key PEM (no passphrase)', async () => {
    const encrypted = await applyWsSecurity(SAMPLE_ENVELOPE, encryptConfig)
    const res = (await harness.invoke('wsse:decrypt', {
      envelope: encrypted,
      privateKeyPem: serverKeyPem,
    })) as ApplyResult

    expect(res.success).toBe(true)
    expect(res.data).toContain('Hello, WSSE')
  })

  it('decrypts with a pasted ENCRYPTED key PEM + its passphrase', async () => {
    const encryptedKeyPem = createPrivateKey(serverKeyPem)
      .export({
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: 'wsse-pass',
      })
      .toString()
    const encrypted = await applyWsSecurity(SAMPLE_ENVELOPE, encryptConfig)

    const res = (await harness.invoke('wsse:decrypt', {
      envelope: encrypted,
      privateKeyPem: encryptedKeyPem,
      passphrase: 'wsse-pass',
    })) as ApplyResult

    expect(res.success).toBe(true)
    expect(res.data).toContain('Hello, WSSE')
  })
})

describe('ADDITIVE (e) — soap:execute Sign with pasted PEM', () => {
  it('still ships a signed envelope over the wire', async () => {
    const result = await executeSoap({
      wsdlUrl: '',
      endpointUrl: `http://127.0.0.1:${port}/svc`,
      operationName: 'Ping',
      soapVersion: 'soap11',
      params: {},
      wsSecurity: pastedSignConfig(),
    })

    expect(result.status).toBe(200)
    expect(capturedBody).toContain('Signature')
    expect(capturedBody).toContain('BinarySecurityToken')
    expect(verifySignature(capturedBody as string, serverCertPem).valid).toBe(true)
  })

  it('keeps the legacy single-mode UsernameToken config working (migrate path)', async () => {
    const result = await executeSoap({
      wsdlUrl: '',
      endpointUrl: `http://127.0.0.1:${port}/svc`,
      operationName: 'Ping',
      soapVersion: 'soap11',
      params: {},
      wsSecurity: {
        enabled: true,
        type: 'username-token',
        username: 'alice',
        password: 'secret',
        passwordType: 'PasswordText',
      },
    })

    expect(result.status).toBe(200)
    expect(capturedBody).toContain('<wsse:UsernameToken')
  })
})

describe('ADDITIVE (f) — both entrypoints keep accepting an inline-PEM config', () => {
  it('resolveWsseKeyMaterial returns the SAME object when there is no keySource', () => {
    const config = pastedSignConfig()
    expect(resolveWsseKeyMaterial(config)).toBe(config)
  })

  it('leaves non-sign configs untouched (UsernameToken / Timestamp / Encrypt)', () => {
    const ut: WsSecurityConfig = {
      enabled: true,
      modes: ['username-token'],
      usernameToken: {
        username: 'u',
        password: 'p',
        passwordType: 'PasswordText',
        nonce: false,
        created: false,
      },
    }
    expect(resolveWsseKeyMaterial(ut)).toBe(ut)

    const disabled: WsSecurityConfig = { enabled: false, modes: ['sign'] }
    expect(resolveWsseKeyMaterial(disabled)).toBe(disabled)
  })

  it('tolerates an empty/degenerate config object (old callers pass {})', () => {
    const empty = {} as WsSecurityConfig
    expect(resolveWsseKeyMaterial(empty)).toBe(empty)
  })

  it("guard (C-4): modes ['sign'] with NO sign block stays a no-op, as before", async () => {
    const config: WsSecurityConfig = { enabled: true, modes: ['sign'] }
    expect(resolveWsseKeyMaterial(config)).toBe(config)

    const res = (await harness.invoke('wsse:apply', {
      envelope: SAMPLE_ENVELOPE,
      config,
    })) as ApplyResult
    expect(res.success).toBe(true)
    expect(res.data).toContain('wsse:Security')
    expect(res.data).not.toContain('Signature')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. The ADDED arm — keySource resolved at BOTH junctions (C-2)
// ═══════════════════════════════════════════════════════════════════════════

describe('keySource — junction 1: ipc wsse:apply (standalone tool)', () => {
  it('signs with a keystore alias, no pasted PEM at all', async () => {
    const keystoreId = seedClientKeystore()
    const res = (await harness.invoke('wsse:apply', {
      envelope: SAMPLE_ENVELOPE,
      config: {
        enabled: true,
        modes: ['sign'],
        sign: {
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'BinarySecurityToken',
          keySource: { kind: 'keystore', keystoreId, alias: 'test-client' },
        },
      } satisfies WsSecurityConfig,
    })) as ApplyResult

    expect(res.success).toBe(true)
    // Signed by the keystore's client key — verifiable with the client cert.
    expect(verifySignature(res.data as string, clientCertPem).valid).toBe(true)
  })

  it('an inline keySource is equivalent to pasting the same PEM', async () => {
    const res = (await harness.invoke('wsse:apply', {
      envelope: SAMPLE_ENVELOPE,
      config: {
        enabled: true,
        modes: ['sign'],
        sign: {
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'BinarySecurityToken',
          keySource: { kind: 'inline', certPem: serverCertPem, keyPem: serverKeyPem },
        },
      } satisfies WsSecurityConfig,
    })) as ApplyResult

    expect(res.success).toBe(true)
    expect(verifySignature(res.data as string, serverCertPem).valid).toBe(true)
  })

  it('R11: FAILS LOUD when remember-password is off and no storePassword is supplied', async () => {
    const keystoreId = seedClientKeystore({ remember: false })
    const res = (await harness.invoke('wsse:apply', {
      envelope: SAMPLE_ENVELOPE,
      config: {
        enabled: true,
        modes: ['sign'],
        sign: {
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'BinarySecurityToken',
          keySource: { kind: 'keystore', keystoreId, alias: 'test-client' },
        },
      } satisfies WsSecurityConfig,
    })) as ApplyResult

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/store password required/i)
  })

  it('R11: the write-only storePassword makes a remember-off keystore usable', async () => {
    const keystoreId = seedClientKeystore({ remember: false })
    const res = (await harness.invoke('wsse:apply', {
      envelope: SAMPLE_ENVELOPE,
      config: {
        enabled: true,
        modes: ['sign'],
        sign: {
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'BinarySecurityToken',
          keySource: {
            kind: 'keystore',
            keystoreId,
            alias: 'test-client',
            storePassword: KEYSTORE_PW,
          },
        },
      } satisfies WsSecurityConfig,
    })) as ApplyResult

    expect(res.success).toBe(true)
    expect(verifySignature(res.data as string, clientCertPem).valid).toBe(true)
  })

  it('FAILS LOUD on an unknown alias instead of shipping an unsigned envelope', async () => {
    const keystoreId = seedClientKeystore()
    const res = (await harness.invoke('wsse:apply', {
      envelope: SAMPLE_ENVELOPE,
      config: {
        enabled: true,
        modes: ['sign'],
        sign: {
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'BinarySecurityToken',
          keySource: { kind: 'keystore', keystoreId, alias: 'does-not-exist' },
        },
      } satisfies WsSecurityConfig,
    })) as ApplyResult

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/does-not-exist/)
    expect(res.data).toBeUndefined()
  })
})

describe('keySource — junction 2: executeSoap (saved SOAP request)', () => {
  it('signs with the same keystore alias — Tool ≡ SOAP parity', async () => {
    const keystoreId = seedClientKeystore()
    const result = await executeSoap({
      wsdlUrl: '',
      endpointUrl: `http://127.0.0.1:${port}/svc`,
      operationName: 'Ping',
      soapVersion: 'soap11',
      params: {},
      wsSecurity: {
        enabled: true,
        modes: ['sign'],
        sign: {
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'BinarySecurityToken',
          keySource: { kind: 'keystore', keystoreId, alias: 'test-client' },
        },
      },
    })

    expect(result.status).toBe(200)
    expect(capturedBody).toContain('Signature')
    expect(verifySignature(capturedBody as string, clientCertPem).valid).toBe(true)
  })

  it('FAILS LOUD (visible {error}, request never sent) on an unresolvable keySource', async () => {
    const result = await executeSoap({
      wsdlUrl: '',
      endpointUrl: `http://127.0.0.1:${port}/svc`,
      operationName: 'Ping',
      soapVersion: 'soap11',
      params: {},
      wsSecurity: {
        enabled: true,
        modes: ['sign'],
        sign: {
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'BinarySecurityToken',
          keySource: { kind: 'keystore', keystoreId: 'nope', alias: 'test-client' },
        },
      },
    })

    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/Keystore not found/i)
    expect(capturedBody).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. FAIL LOUD — no keySource AND no pasted PEM
// ═══════════════════════════════════════════════════════════════════════════

describe('FAIL LOUD — sign mode with no key material at all', () => {
  const emptySign: WsSecurityConfig = {
    enabled: true,
    modes: ['sign'],
    sign: {
      privateKeyPem: '',
      certPem: '',
      algorithm: 'RSA-SHA256',
      references: ['Body'],
      keyInfoStrategy: 'BinarySecurityToken',
    },
  }

  it('wsse:apply returns a clear {error}, never a silently unsigned envelope', async () => {
    const res = (await harness.invoke('wsse:apply', {
      envelope: SAMPLE_ENVELOPE,
      config: emptySign,
    })) as ApplyResult

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/no key material/i)
    expect(res.data).toBeUndefined()
  })

  it('executeSoap surfaces the same failure and sends nothing', async () => {
    const result = await executeSoap({
      wsdlUrl: '',
      endpointUrl: `http://127.0.0.1:${port}/svc`,
      operationName: 'Ping',
      soapVersion: 'soap11',
      params: {},
      wsSecurity: emptySign,
    })

    expect(result.error).toMatch(/no key material/i)
    expect(capturedBody).toBeNull()
  })

  it('the pure engine also refuses a half-filled sign config (cert without key)', async () => {
    await expect(
      applyWsSecurity(SAMPLE_ENVELOPE, {
        enabled: true,
        modes: ['sign'],
        sign: {
          certPem: serverCertPem,
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'BinarySecurityToken',
        },
      }),
    ).rejects.toThrow(/requires a certificate and a private key/i)
  })

  it('BEHAVIOUR CHANGE: IssuerSerial with a BLANK certificate now fails instead of signing', async () => {
    // Pre-#60 this degenerate combination produced a signed envelope carrying an
    // EMPTY <X509IssuerName/><X509SerialNumber/> (the X509 parse failure was
    // swallowed) — a signature no counterparty could match to a certificate.
    // It is now refused. Documented in docs/release-notes/unreleased.md.
    await expect(
      applyWsSecurity(SAMPLE_ENVELOPE, {
        enabled: true,
        modes: ['sign'],
        sign: {
          certPem: '',
          privateKeyPem: serverKeyPem,
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'IssuerSerial',
        },
      }),
    ).rejects.toThrow(/requires a certificate and a private key/i)
  })

  it('a public-only keySource cannot sign — clear error, no envelope', () => {
    expect(() =>
      resolveWsseKeyMaterial({
        enabled: true,
        modes: ['sign'],
        sign: {
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'BinarySecurityToken',
          keySource: { kind: 'inline', certPem: serverCertPem },
        },
      }),
    ).toThrow(/no private key/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. NO-LEAK — resolved PEM never travels back to the renderer
// ═══════════════════════════════════════════════════════════════════════════

describe('NO-LEAK — the resolved private key stays in main', () => {
  it('wsse:apply response carries the signed XML only — no private key, no password', async () => {
    const keystoreId = seedClientKeystore({ remember: false })
    const res = (await harness.invoke('wsse:apply', {
      envelope: SAMPLE_ENVELOPE,
      config: {
        enabled: true,
        modes: ['sign'],
        sign: {
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'BinarySecurityToken',
          keySource: {
            kind: 'keystore',
            keystoreId,
            alias: 'test-client',
            storePassword: KEYSTORE_PW,
          },
        },
      } satisfies WsSecurityConfig,
    })) as ApplyResult

    const wire = JSON.stringify(res)
    expect(wire).not.toContain('PRIVATE KEY')
    expect(wire).not.toContain(KEYSTORE_PW)
  })

  it('the caller-supplied config object is never mutated with resolved key bytes', () => {
    const config: WsSecurityConfig = {
      enabled: true,
      modes: ['sign'],
      sign: {
        algorithm: 'RSA-SHA256',
        references: ['Body'],
        keyInfoStrategy: 'BinarySecurityToken',
        keySource: { kind: 'inline', certPem: serverCertPem, keyPem: serverKeyPem },
      },
    }

    const resolved = resolveWsseKeyMaterial(config)

    expect(resolved).not.toBe(config)
    expect(config.sign?.privateKeyPem).toBeUndefined()
    expect(config.sign?.certPem).toBeUndefined()
    expect(resolved.sign?.privateKeyPem).toContain('PRIVATE KEY')
  })

  it('strips the write-only keySource from the config handed to the pure engine', () => {
    const keystoreId = seedClientKeystore({ remember: false })
    const resolved = resolveWsseKeyMaterial({
      enabled: true,
      modes: ['sign'],
      sign: {
        algorithm: 'RSA-SHA256',
        references: ['Body'],
        keyInfoStrategy: 'BinarySecurityToken',
        keySource: {
          kind: 'keystore',
          keystoreId,
          alias: 'test-client',
          storePassword: KEYSTORE_PW,
        },
      },
    })

    expect(resolved.sign?.keySource).toBeUndefined()
    expect(JSON.stringify(resolved)).not.toContain(KEYSTORE_PW)
  })

  it('soap:execute actualRequest echoes the envelope only — never the signing key', async () => {
    const result = await executeSoap({
      wsdlUrl: '',
      endpointUrl: `http://127.0.0.1:${port}/svc`,
      operationName: 'Ping',
      soapVersion: 'soap11',
      params: {},
      wsSecurity: pastedSignConfig(),
    })

    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY')
  })
})
