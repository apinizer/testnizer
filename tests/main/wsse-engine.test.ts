import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  applyWsSecurity,
  verifySignature,
  decryptEnvelope,
  migrateLegacyConfig,
  WSSE_NS,
  WSU_NS,
  PASSWORD_TEXT_TYPE,
  PASSWORD_DIGEST_TYPE,
  type WsSecurityConfig,
  type EncryptConfig,
} from '../../src/main/protocols/wsse.engine'

const CERTS = path.resolve(__dirname, '../fixtures/certs')
const FIX = path.resolve(__dirname, '../fixtures/wsse')

const SAMPLE_ENVELOPE = readFileSync(path.join(FIX, 'sample-envelope.xml'), 'utf8')

let serverCertPem: string
let serverKeyPem: string
let clientCertPem: string

beforeAll(() => {
  serverCertPem = readFileSync(path.join(CERTS, 'server.crt'), 'utf8')
  serverKeyPem = readFileSync(path.join(CERTS, 'server.key'), 'utf8')
  clientCertPem = readFileSync(path.join(CERTS, 'client.crt'), 'utf8')
})

// ─── Disabled / passthrough ────────────────────────────────

describe('applyWsSecurity — disabled config', () => {
  it('returns envelope unchanged when enabled=false', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, { enabled: false, modes: [] })
    expect(result).toBe(SAMPLE_ENVELOPE)
  })

  it('returns envelope unchanged when modes is empty', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, { enabled: true, modes: [] })
    expect(result).toBe(SAMPLE_ENVELOPE)
  })
})

// ─── UsernameToken ─────────────────────────────────────────

describe('UsernameToken — PasswordText', () => {
  it('inserts UsernameToken with PasswordText', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['username-token'],
      usernameToken: {
        username: 'alice',
        password: 'secret',
        passwordType: 'PasswordText',
        nonce: false,
        created: false,
      },
    })
    expect(result).toContain('<wsse:Security')
    expect(result).toContain(WSSE_NS)
    expect(result).toContain('<wsse:Username>alice</wsse:Username>')
    expect(result).toContain(`Type="${PASSWORD_TEXT_TYPE}"`)
    expect(result).toContain('>secret<')
  })

  it('escapes special characters in username/password', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['username-token'],
      usernameToken: {
        username: 'a<b&c',
        password: 'p"d\'e',
        passwordType: 'PasswordText',
        nonce: false,
        created: false,
      },
    })
    expect(result).toContain('a&lt;b&amp;c')
    expect(result).toContain('p&quot;d&apos;e')
  })

  it('adds Nonce when requested', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['username-token'],
      usernameToken: {
        username: 'alice',
        password: 'secret',
        passwordType: 'PasswordText',
        nonce: true,
        created: false,
      },
    })
    expect(result).toContain('<wsse:Nonce')
  })

  it('adds Created timestamp when requested', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['username-token'],
      usernameToken: {
        username: 'alice',
        password: 'secret',
        passwordType: 'PasswordText',
        nonce: false,
        created: true,
      },
    })
    expect(result).toMatch(/<wsu:Created>\d{4}-\d{2}-\d{2}T/)
  })

  it('UsernameToken is wrapped in Security with mustUnderstand=1', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['username-token'],
      usernameToken: {
        username: 'alice',
        password: 'secret',
        passwordType: 'PasswordText',
        nonce: false,
        created: false,
      },
    })
    expect(result).toMatch(/<wsse:Security[^>]*mustUnderstand="1"/)
  })
})

describe('UsernameToken — PasswordDigest', () => {
  it('uses PasswordDigest type with Nonce + Created always present', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['username-token'],
      usernameToken: {
        username: 'alice',
        password: 'secret',
        passwordType: 'PasswordDigest',
        nonce: false,
        created: false,
      },
    })
    expect(result).toContain(`Type="${PASSWORD_DIGEST_TYPE}"`)
    expect(result).toContain('<wsse:Nonce')
    expect(result).toMatch(/<wsu:Created>\d{4}-\d{2}-\d{2}T/)
  })

  it('digest is base64 SHA-1 string (28 chars)', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['username-token'],
      usernameToken: {
        username: 'alice',
        password: 'secret',
        passwordType: 'PasswordDigest',
        nonce: false,
        created: false,
      },
    })
    const m = result.match(/<wsse:Password Type="[^"]*Digest"[^>]*>([^<]+)<\/wsse:Password>/)
    expect(m).not.toBeNull()
    // SHA-1 is 20 bytes → base64 28 chars
    expect(m![1]).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(m![1].length).toBe(28)
  })
})

// ─── Timestamp ──────────────────────────────────────────────

describe('Timestamp', () => {
  it('inserts Timestamp with Created and Expires', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['timestamp'],
      timestamp: { ttlSeconds: 60 },
    })
    expect(result).toContain('<wsu:Timestamp')
    expect(result).toContain(WSU_NS)
    expect(result).toMatch(/<wsu:Created>[^<]+<\/wsu:Created>/)
    expect(result).toMatch(/<wsu:Expires>[^<]+<\/wsu:Expires>/)
  })

  it('Expires is later than Created by ttlSeconds', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['timestamp'],
      timestamp: { ttlSeconds: 120 },
    })
    const created = result.match(/<wsu:Created>([^<]+)<\/wsu:Created>/)![1]
    const expires = result.match(/<wsu:Expires>([^<]+)<\/wsu:Expires>/)![1]
    const diff = (new Date(expires).getTime() - new Date(created).getTime()) / 1000
    expect(diff).toBeCloseTo(120, 0)
  })

  it('Timestamp + UsernameToken combine in same Security header', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['timestamp', 'username-token'],
      timestamp: { ttlSeconds: 60 },
      usernameToken: {
        username: 'alice',
        password: 'secret',
        passwordType: 'PasswordText',
        nonce: false,
        created: false,
      },
    })
    // Both inside one <wsse:Security> block
    const securityCount = (result.match(/<wsse:Security[^/]/g) ?? []).length
    expect(securityCount).toBe(1)
    expect(result).toContain('<wsse:UsernameToken')
    expect(result).toContain('<wsu:Timestamp')
  })
})

// ─── Header insertion ──────────────────────────────────────

describe('Security header insertion', () => {
  it('replaces empty <soap:Header/>', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['timestamp'],
      timestamp: { ttlSeconds: 60 },
    })
    expect(result).not.toContain('<soap:Header/>')
    expect(result).toMatch(/<soap:Header>[^]*<\/soap:Header>/)
  })

  it('preserves existing Header content', async () => {
    const env = SAMPLE_ENVELOPE.replace(
      '<soap:Header/>',
      '<soap:Header><tns:Existing>x</tns:Existing></soap:Header>'
    )
    const result = await applyWsSecurity(env, {
      enabled: true,
      modes: ['timestamp'],
      timestamp: { ttlSeconds: 60 },
    })
    expect(result).toContain('<tns:Existing>x</tns:Existing>')
    expect(result).toContain('<wsse:Security')
  })

  it('inserts Header when none exists', async () => {
    const env = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><tns:X/></soap:Body></soap:Envelope>`
    const result = await applyWsSecurity(env, {
      enabled: true,
      modes: ['timestamp'],
      timestamp: { ttlSeconds: 60 },
    })
    expect(result).toContain('<soap:Header>')
    expect(result).toContain('<wsse:Security')
  })
})

// ─── Sign + Verify ─────────────────────────────────────────

describe('Sign — RSA-SHA256 over Body', () => {
  let signed: string

  beforeAll(async () => {
    const config: WsSecurityConfig = {
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
    signed = await applyWsSecurity(SAMPLE_ENVELOPE, config)
  })

  it('produces a Signature element', () => {
    expect(signed).toContain('Signature')
    expect(signed).toContain('SignedInfo')
    expect(signed).toContain('SignatureValue')
  })

  it('uses RSA-SHA256 algorithm URI', () => {
    expect(signed).toContain('xmldsig-more#rsa-sha256')
  })

  it('uses exclusive C14N canonicalization', () => {
    expect(signed).toContain('xml-exc-c14n#')
  })

  it('embeds BinarySecurityToken', () => {
    expect(signed).toContain('<wsse:BinarySecurityToken')
    expect(signed).toContain('X509v3')
  })

  it('signature is verifiable with public cert', () => {
    const result = verifySignature(signed, serverCertPem)
    expect(result.valid).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(result.signedReferences.length).toBeGreaterThan(0)
  })

  it('signature fails verification with wrong cert', () => {
    const result = verifySignature(signed, clientCertPem)
    expect(result.valid).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('tampered signed body fails verification', () => {
    const tampered = signed.replace('Hello, WSSE', 'Hello, TAMPERED')
    const result = verifySignature(tampered, serverCertPem)
    expect(result.valid).toBe(false)
  })

  it('certInfo is populated on success', () => {
    const result = verifySignature(signed, serverCertPem)
    expect(result.certInfo).toBeDefined()
    expect(result.certInfo!.subject).toBeDefined()
    expect(result.certInfo!.issuer).toBeDefined()
  })
})

describe('Sign — algorithm variants', () => {
  it.each<['RSA-SHA1' | 'RSA-SHA256' | 'RSA-SHA512', string]>([
    ['RSA-SHA1', 'xmldsig#rsa-sha1'],
    ['RSA-SHA256', 'rsa-sha256'],
    ['RSA-SHA512', 'rsa-sha512'],
  ])('signs with %s and verifies', async (algo, expectedUriFragment) => {
    const signed = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['sign'],
      sign: {
        privateKeyPem: serverKeyPem,
        certPem: serverCertPem,
        algorithm: algo,
        references: ['Body'],
        keyInfoStrategy: 'BinarySecurityToken',
      },
    })
    expect(signed).toContain(expectedUriFragment)
    const result = verifySignature(signed, serverCertPem)
    expect(result.valid).toBe(true)
  })
})

describe('Sign — IssuerSerial KeyInfo strategy', () => {
  it('embeds X509IssuerSerial instead of BinarySecurityToken', async () => {
    const signed = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['sign'],
      sign: {
        privateKeyPem: serverKeyPem,
        certPem: serverCertPem,
        algorithm: 'RSA-SHA256',
        references: ['Body'],
        keyInfoStrategy: 'IssuerSerial',
      },
    })
    expect(signed).toContain('<X509IssuerSerial>')
    expect(signed).toContain('<X509SerialNumber>')
    expect(signed).not.toContain('<wsse:BinarySecurityToken')
  })
})

describe('Sign — multi-reference (Body + Timestamp)', () => {
  it('signs Body and Timestamp; both referenced', async () => {
    const signed = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['timestamp', 'sign'],
      timestamp: { ttlSeconds: 60 },
      sign: {
        privateKeyPem: serverKeyPem,
        certPem: serverCertPem,
        algorithm: 'RSA-SHA256',
        references: ['Body', 'Timestamp'],
        keyInfoStrategy: 'BinarySecurityToken',
      },
    })
    const refCount = (signed.match(/<ds:Reference/g) ?? signed.match(/<Reference/g) ?? []).length
    expect(refCount).toBeGreaterThanOrEqual(2)
    const verify = verifySignature(signed, serverCertPem)
    expect(verify.valid).toBe(true)
  })
})

describe('verifySignature — error cases', () => {
  it('returns valid=false when no signature element exists', () => {
    const result = verifySignature(SAMPLE_ENVELOPE, serverCertPem)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('No signature element')
  })

  it('returns valid=false on malformed signature XML', () => {
    const broken = SAMPLE_ENVELOPE + '<Signature>broken</Signature>'
    const result = verifySignature(broken, serverCertPem)
    expect(result.valid).toBe(false)
    expect(result.reason).toBeDefined()
  })
})

// ─── Encrypt + Decrypt ─────────────────────────────────────

describe('Encrypt — AES-256-CBC + RSA-OAEP', () => {
  let encrypted: string

  beforeAll(async () => {
    const config: WsSecurityConfig = {
      enabled: true,
      modes: ['encrypt'],
      encrypt: {
        recipientCertPem: serverCertPem,
        algorithm: 'AES-256-CBC',
        keyWrap: 'RSA-OAEP',
      },
    }
    encrypted = await applyWsSecurity(SAMPLE_ENVELOPE, config)
  })

  it('replaces body content with EncryptedData', () => {
    expect(encrypted).toContain('EncryptedData')
    expect(encrypted).toContain('CipherValue')
    expect(encrypted).not.toContain('<tns:Echo')
  })

  it('uses AES-256-CBC URI', () => {
    expect(encrypted).toContain('aes256-cbc')
  })

  it('uses RSA-OAEP key wrap URI', () => {
    expect(encrypted).toContain('rsa-oaep')
  })

  it('decrypts back to plaintext body', async () => {
    const decrypted = await decryptEnvelope(encrypted, serverKeyPem)
    expect(decrypted).toContain('<tns:Echo')
    expect(decrypted).toContain('Hello, WSSE')
  })
})

describe('Encrypt — algorithm variants', () => {
  const algorithms: Array<{
    algorithm: EncryptConfig['algorithm']
    keyWrap: EncryptConfig['keyWrap']
    fragment: string
  }> = [
    { algorithm: 'AES-128-CBC', keyWrap: 'RSA-OAEP', fragment: 'aes128-cbc' },
    { algorithm: 'AES-256-CBC', keyWrap: 'RSA-OAEP', fragment: 'aes256-cbc' },
    { algorithm: 'AES-128-GCM', keyWrap: 'RSA-OAEP', fragment: 'aes128-gcm' },
    { algorithm: 'AES-256-GCM', keyWrap: 'RSA-OAEP', fragment: 'aes256-gcm' },
  ]

  it.each(algorithms)('encrypts with $algorithm and decrypts back', async ({ algorithm, keyWrap, fragment }) => {
    const encrypted = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['encrypt'],
      encrypt: { recipientCertPem: serverCertPem, algorithm, keyWrap },
    })
    expect(encrypted).toContain(fragment)
    const decrypted = await decryptEnvelope(encrypted, serverKeyPem)
    expect(decrypted).toContain('Hello, WSSE')
  })
})

describe('decryptEnvelope — passthrough when no encryption', () => {
  it('returns envelope unchanged when no EncryptedData element', async () => {
    const result = await decryptEnvelope(SAMPLE_ENVELOPE, serverKeyPem)
    expect(result).toBe(SAMPLE_ENVELOPE)
  })
})

// ─── Multi-mode combinations ───────────────────────────────

describe('Multi-mode — UT + Timestamp + Sign', () => {
  it('produces a valid envelope with all three', async () => {
    const result = await applyWsSecurity(SAMPLE_ENVELOPE, {
      enabled: true,
      modes: ['username-token', 'timestamp', 'sign'],
      usernameToken: {
        username: 'alice',
        password: 'secret',
        passwordType: 'PasswordText',
        nonce: true,
        created: true,
      },
      timestamp: { ttlSeconds: 60 },
      sign: {
        privateKeyPem: serverKeyPem,
        certPem: serverCertPem,
        algorithm: 'RSA-SHA256',
        references: ['Body', 'Timestamp', 'UsernameToken'],
        keyInfoStrategy: 'BinarySecurityToken',
      },
    })
    expect(result).toContain('<wsse:UsernameToken')
    expect(result).toContain('<wsu:Timestamp')
    expect(result).toContain('Signature')
    const verify = verifySignature(result, serverCertPem)
    expect(verify.valid).toBe(true)
  })
})

// ─── migrateLegacyConfig ───────────────────────────────────

describe('migrateLegacyConfig', () => {
  it('returns disabled config for non-object input', () => {
    expect(migrateLegacyConfig(null)).toEqual({ enabled: false, modes: [] })
    expect(migrateLegacyConfig(undefined)).toEqual({ enabled: false, modes: [] })
  })

  it('passes through new-shape config unchanged', () => {
    const config: WsSecurityConfig = {
      enabled: true,
      modes: ['username-token'],
      usernameToken: {
        username: 'a',
        password: 'b',
        passwordType: 'PasswordText',
        nonce: false,
        created: false,
      },
    }
    const result = migrateLegacyConfig(config)
    expect(result).toEqual(config)
  })

  it('migrates legacy username-token shape', () => {
    const legacy = {
      enabled: true,
      type: 'username-token',
      username: 'alice',
      password: 'secret',
      passwordType: 'PasswordText',
      addTimestamp: false,
    }
    const result = migrateLegacyConfig(legacy)
    expect(result.enabled).toBe(true)
    expect(result.modes).toContain('username-token')
    expect(result.usernameToken?.username).toBe('alice')
    expect(result.usernameToken?.password).toBe('secret')
  })

  it('migrates legacy username-token with addTimestamp adds timestamp mode', () => {
    const legacy = {
      enabled: true,
      type: 'username-token',
      username: 'alice',
      password: 'secret',
      addTimestamp: true,
    }
    const result = migrateLegacyConfig(legacy)
    expect(result.modes).toContain('username-token')
    expect(result.modes).toContain('timestamp')
    expect(result.timestamp?.ttlSeconds).toBe(300)
  })

  it('migrates legacy timestamp-only shape', () => {
    const legacy = { enabled: true, type: 'timestamp' }
    const result = migrateLegacyConfig(legacy)
    expect(result.modes).toEqual(['timestamp'])
    expect(result.timestamp?.ttlSeconds).toBeGreaterThan(0)
  })

  it('preserves PasswordDigest passwordType in migration', () => {
    const legacy = {
      enabled: true,
      type: 'username-token',
      username: 'a',
      password: 'b',
      passwordType: 'PasswordDigest',
    }
    const result = migrateLegacyConfig(legacy)
    expect(result.usernameToken?.passwordType).toBe('PasswordDigest')
  })
})

