/**
 * SAML 2.0 engine (#65, Faz E) — the SECURITY tests are the deliverable.
 *
 * A validator that says "valid" for a wrapped document is worse than no
 * validator at all, so every negative here asserts the SPECIFIC rejection
 * reason (the failing check name), not merely `valid === false`.
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as zlib from 'node:zlib'
import { SignedXml } from 'xml-crypto'
import {
  SAML_NS,
  SAMLP_NS,
  NAMEID_FORMAT,
  BINDING_HTTP_POST,
  STATUS_SUCCESS,
  SIGN_ALGO_URI,
  HASH_ALGO_URI,
  assertNoDoctype,
  buildAssertion,
  buildAuthnRequest,
  buildResponse,
  decodePost,
  decodeRedirect,
  encodePost,
  encodeRedirect,
  encodeRedirectUrlParam,
  generateSamlId,
  isValidSamlId,
  signSaml,
  toSamlInstant,
  verifySaml,
  type SamlSignAlgorithm,
  type SamlVerifyResult,
} from '../../src/main/protocols/saml.engine'

const CERTS = path.resolve(__dirname, '../fixtures/certs')

const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'

let rsaCert: string
let rsaKey: string
let foreignCert: string
let ecCert: string
let ecKey: string

beforeAll(() => {
  rsaCert = readFileSync(path.join(CERTS, 'server.crt'), 'utf8')
  rsaKey = readFileSync(path.join(CERTS, 'server.key'), 'utf8')
  foreignCert = readFileSync(path.join(CERTS, 'client.crt'), 'utf8')
  ecCert = readFileSync(path.join(CERTS, 'ec-p256.crt'), 'utf8')
  ecKey = readFileSync(path.join(CERTS, 'ec-p256.pkcs8.key'), 'utf8')
})

// ─── helpers ────────────────────────────────────────────────

const ISSUER = 'https://idp.example.com'
const SP = 'https://sp.testnizer.com'

function failedCheck(res: SamlVerifyResult): string {
  const failed = res.checks.find((c) => !c.ok)
  return failed ? failed.name : '(none)'
}

function signatureBlock(xml: string): string {
  const match = xml.match(/<ds:Signature[\s\S]*?<\/ds:Signature>/)
  if (!match) throw new Error('test fixture has no ds:Signature')
  return match[0]
}

function goodAssertion(overrides: { id?: string; nameId?: string; now?: string } = {}): string {
  return buildAssertion({
    id: overrides.id ?? '_a1',
    issuer: ISSUER,
    now: overrides.now,
    subject: { nameId: overrides.nameId ?? 'alice@corp.example', recipient: `${SP}/acs` },
    audience: SP,
    sessionIndex: '_sess1',
    attributes: [{ name: 'role', values: ['admin'] }],
  }).xml
}

function signedAssertion(
  algorithm: SamlSignAlgorithm = 'RSA-SHA256',
  xml = goodAssertion(),
): string {
  return signSaml(xml, {
    privateKeyPem: rsaKey,
    certPem: rsaCert,
    algorithm,
    signatureTarget: 'assertion',
  })
}

/**
 * A WSSE-style naive verifier: first-match regex for the Signature, xml-crypto,
 * no XSW defense. Used to PROVE each wrapped document is cryptographically
 * valid — i.e. that our rejection is the only thing standing between the attack
 * and a "valid" verdict.
 */
function naiveVerifierAccepts(xml: string): boolean {
  const naive = new SignedXml({ publicCert: rsaCert })
  naive.loadSignature(signatureBlock(xml))
  return naive.checkSignature(xml)
}

function wrapInResponse(inner: string, responseId = '_r1'): string {
  return (
    `<samlp:Response xmlns:samlp="${SAMLP_NS}" xmlns:saml="${SAML_NS}" ID="${responseId}"` +
    ` Version="2.0" IssueInstant="${toSamlInstant(new Date())}" Destination="${SP}/acs">` +
    `<saml:Issuer>${ISSUER}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="${STATUS_SUCCESS}"/></samlp:Status>` +
    `${inner}</samlp:Response>`
  )
}

// ════════════════════════════════════════════════════════════
// BUILD — deterministic, byte-exact
// ════════════════════════════════════════════════════════════

describe('build — deterministic output', () => {
  it('buildAuthnRequest is byte-exact with an injected id + IssueInstant', () => {
    const built = buildAuthnRequest({
      id: '_req1',
      issueInstant: '2026-01-01T00:00:00Z',
      issuer: SP,
      destination: `${ISSUER}/sso`,
      assertionConsumerServiceURL: `${SP}/acs`,
      protocolBinding: BINDING_HTTP_POST,
      nameIdFormat: NAMEID_FORMAT.persistent,
      allowCreate: true,
      forceAuthn: true,
    })

    expect(built.id).toBe('_req1')
    expect(built.issueInstant).toBe('2026-01-01T00:00:00Z')
    expect(built.xml).toBe(
      `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"` +
        ` xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_req1" Version="2.0"` +
        ` IssueInstant="2026-01-01T00:00:00Z" Destination="https://idp.example.com/sso"` +
        ` AssertionConsumerServiceURL="https://sp.testnizer.com/acs"` +
        ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" ForceAuthn="true">` +
        `<saml:Issuer>https://sp.testnizer.com</saml:Issuer>` +
        `<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent" AllowCreate="true"/>` +
        `</samlp:AuthnRequest>`,
    )
  })

  it('buildAssertion is byte-exact with an injected id + clock (skews derived from `now`)', () => {
    const built = buildAssertion({
      id: '_a1',
      now: '2026-01-01T00:00:00Z',
      issuer: ISSUER,
      subject: {
        nameId: 'alice@corp.example',
        nameIdFormat: NAMEID_FORMAT.emailAddress,
        recipient: `${SP}/acs`,
        inResponseTo: '_req1',
      },
      audience: SP,
      sessionIndex: '_sess1',
      attributes: [
        { name: 'role', values: ['admin', 'user'] },
        { name: 'email', values: ['alice@corp.example'] },
        { name: 'seats', values: [3] },
        { name: 'active', values: [true] },
      ],
    })

    expect(built.xml).toBe(
      `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a1" Version="2.0" IssueInstant="2026-01-01T00:00:00Z">` +
        `<saml:Issuer>https://idp.example.com</saml:Issuer>` +
        `<saml:Subject>` +
        `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">alice@corp.example</saml:NameID>` +
        `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
        `<saml:SubjectConfirmationData NotOnOrAfter="2026-01-01T00:05:00Z" Recipient="https://sp.testnizer.com/acs" InResponseTo="_req1"/>` +
        `</saml:SubjectConfirmation></saml:Subject>` +
        `<saml:Conditions NotBefore="2025-12-31T23:59:00Z" NotOnOrAfter="2026-01-01T00:05:00Z">` +
        `<saml:AudienceRestriction><saml:Audience>https://sp.testnizer.com</saml:Audience></saml:AudienceRestriction>` +
        `</saml:Conditions>` +
        `<saml:AuthnStatement AuthnInstant="2026-01-01T00:00:00Z" SessionIndex="_sess1">` +
        `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
        `</saml:AuthnStatement>` +
        `<saml:AttributeStatement xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<saml:Attribute Name="role"><saml:AttributeValue xsi:type="xs:string">admin</saml:AttributeValue><saml:AttributeValue xsi:type="xs:string">user</saml:AttributeValue></saml:Attribute>` +
        `<saml:Attribute Name="email"><saml:AttributeValue xsi:type="xs:string">alice@corp.example</saml:AttributeValue></saml:Attribute>` +
        `<saml:Attribute Name="seats"><saml:AttributeValue xsi:type="xs:integer">3</saml:AttributeValue></saml:Attribute>` +
        `<saml:Attribute Name="active"><saml:AttributeValue xsi:type="xs:boolean">true</saml:AttributeValue></saml:Attribute>` +
        `</saml:AttributeStatement>` +
        `</saml:Assertion>`,
    )
  })

  it('buildResponse wraps an inline assertion with Status=Success and a distinct ID', () => {
    const built = buildResponse({
      id: '_r1',
      now: '2026-01-01T00:00:00Z',
      issuer: ISSUER,
      destination: `${SP}/acs`,
      inResponseTo: '_req1',
      assertion: { id: '_a1', issuer: ISSUER, subject: { nameId: 'alice@corp.example' } },
    })

    expect(built.id).toBe('_r1')
    expect(built.assertionId).toBe('_a1')
    expect(built.xml).toContain(`<samlp:StatusCode Value="${STATUS_SUCCESS}">`)
    expect(built.xml).toContain('<saml:Assertion xmlns:saml=')
    expect(built.xml).toContain('InResponseTo="_req1"')
    // The nested assertion inherits the response's injected clock.
    expect(built.xml).toContain('IssueInstant="2026-01-01T00:00:00Z"')
  })

  it('buildResponse embeds a pre-signed assertion VERBATIM (its digest must survive)', () => {
    const signed = signedAssertion()
    const built = buildResponse({ id: '_r1', issuer: ISSUER, assertionXml: signed })
    expect(built.xml).toContain(signed)
  })

  it('generated IDs are unique and NCName-valid', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const id = generateSamlId()
      expect(isValidSamlId(id)).toBe(true)
      expect(id).toMatch(/^_[0-9a-f]{32}$/)
      ids.add(id)
    }
    expect(ids.size).toBe(500)
  })

  it('rejects a non-NCName injected ID and missing required fields (fail loud)', () => {
    expect(() => buildAssertion({ id: '1bad', issuer: ISSUER, subject: { nameId: 'a' } })).toThrow(
      /not a valid ID/,
    )
    expect(() => buildAssertion({ issuer: '', subject: { nameId: 'a' } })).toThrow(/issuer/)
    expect(() => buildAssertion({ issuer: ISSUER, subject: { nameId: '' } })).toThrow(
      /subject\.nameId/,
    )
  })

  it('escapes user-controlled text so an attribute value cannot inject markup', () => {
    const xml = buildAssertion({
      id: '_a1',
      issuer: ISSUER,
      subject: { nameId: '<script>&"evil"' },
    }).xml
    expect(xml).toContain('&lt;script&gt;&amp;&quot;evil&quot;')
    expect(xml).not.toContain('<script>')
  })
})

// ════════════════════════════════════════════════════════════
// SIGN → VERIFY round trips
// ════════════════════════════════════════════════════════════

describe('sign → verify round trip', () => {
  it('ADDITIVE: signs with pasted inline PEMs and NO keySource (the default, mandatory path)', () => {
    const signed = signSaml(goodAssertion(), {
      privateKeyPem: rsaKey,
      certPem: rsaCert,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
    })
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(true)
    expect(res.signedReferences).toEqual(['_a1'])
  })

  it('places ds:Signature immediately after saml:Issuer with Reference URI="#ID"', () => {
    const signed = signedAssertion()
    expect(signed).toContain(`</saml:Issuer><ds:Signature`)
    expect(signed).toContain('URI="#_a1"')
    expect(signed).toContain('<X509Data><X509Certificate>')
    // WSSE's BST/SecurityTokenReference KeyInfo must NOT leak into SAML.
    expect(signed).not.toContain('SecurityTokenReference')
    expect(signed).not.toContain('BinarySecurityToken')
  })

  it('assertion-level signature verifies and reports the signed element', () => {
    const res = verifySaml(signedAssertion(), rsaCert)
    expect(res.valid).toBe(true)
    expect(res.reason).toBeUndefined()
    expect(res.signedElement).toEqual({ id: '_a1', localName: 'Assertion' })
    expect(res.subject?.nameId).toBe('alice@corp.example')
    expect(res.conditions?.audiences).toEqual([SP])
    expect(res.certInfo?.subject).toContain('localhost')
    expect(res.checks.every((c) => c.ok)).toBe(true)
  })

  it('response-level signature verifies (IdPs sign the Response too)', () => {
    const response = buildResponse({
      id: '_r1',
      issuer: ISSUER,
      assertion: { id: '_a1', issuer: ISSUER, subject: { nameId: 'alice@corp.example' } },
    }).xml
    const signed = signSaml(response, {
      privateKeyPem: rsaKey,
      certPem: rsaCert,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'response',
    })
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(true)
    expect(res.signedElement).toEqual({ id: '_r1', localName: 'Response' })
  })

  it('signs the ASSERTION nested inside a Response (Signature scoped to that Issuer)', () => {
    const response = buildResponse({
      id: '_r1',
      issuer: ISSUER,
      assertion: { id: '_a1', issuer: ISSUER, subject: { nameId: 'alice@corp.example' } },
    }).xml
    const signed = signSaml(response, {
      privateKeyPem: rsaKey,
      certPem: rsaCert,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
    })
    // The signature must sit inside the Assertion, not after the Response Issuer.
    expect(signed.indexOf('<ds:Signature')).toBeGreaterThan(signed.indexOf('<saml:Assertion'))
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(true)
    expect(res.signedElement).toEqual({ id: '_a1', localName: 'Assertion' })
  })

  it('signs an AuthnRequest at the document root', () => {
    const req = buildAuthnRequest({ id: '_req1', issuer: SP, destination: `${ISSUER}/sso` }).xml
    const signed = signSaml(req, {
      privateKeyPem: rsaKey,
      certPem: rsaCert,
      algorithm: 'RSA-SHA256',
    })
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(true)
    expect(res.signedElement).toEqual({ id: '_req1', localName: 'AuthnRequest' })
  })

  it.each<[SamlSignAlgorithm]>([['RSA-SHA256'], ['RSA-SHA512']])(
    'RSA algorithm %s writes an EXPLICIT SignatureMethod + DigestMethod and round-trips',
    (algorithm) => {
      const signed = signedAssertion(algorithm)
      expect(signed).toContain(`<ds:SignatureMethod Algorithm="${SIGN_ALGO_URI[algorithm]}"/>`)
      expect(signed).toContain(`<ds:DigestMethod Algorithm="${HASH_ALGO_URI[algorithm]}"/>`)
      const res = verifySaml(signed, rsaCert)
      expect(res.valid).toBe(true)
      expect(res.signatureMethod).toBe(SIGN_ALGO_URI[algorithm])
    },
  )

  it('never falls back to xml-crypto\u2019s RSA-SHA1 default when RSA-SHA256 is requested', () => {
    const signed = signedAssertion('RSA-SHA256')
    expect(signed).not.toContain('xmldsig#rsa-sha1')
    expect(signed).not.toContain('xmldsig#sha1')
  })

  it.each<[SamlSignAlgorithm]>([['ECDSA-SHA256'], ['ECDSA-SHA512']])(
    'ECDSA algorithm %s round-trips (IEEE-P1363 signature value)',
    (algorithm) => {
      const signed = signSaml(goodAssertion(), {
        privateKeyPem: ecKey,
        certPem: ecCert,
        algorithm,
        signatureTarget: 'assertion',
      })
      expect(signed).toContain(`<ds:SignatureMethod Algorithm="${SIGN_ALGO_URI[algorithm]}"/>`)
      const res = verifySaml(signed, ecCert)
      expect(res.valid).toBe(true)
      expect(res.signatureMethod).toBe(SIGN_ALGO_URI[algorithm])
      // Wrong trust anchor still fails for ECDSA.
      expect(verifySaml(signed, rsaCert).valid).toBe(false)
    },
  )

  it('FAIL LOUD: signing without resolved key material throws (never emits unsigned XML)', () => {
    expect(() =>
      signSaml(goodAssertion(), { algorithm: 'RSA-SHA256', signatureTarget: 'assertion' }),
    ).toThrow(/requires a certificate and a private key/)

    // A keySource alone is NOT enough: the pure engine never resolves it — the
    // orchestration layer must populate the PEMs first.
    expect(() =>
      signSaml(goodAssertion(), {
        algorithm: 'RSA-SHA256',
        signatureTarget: 'assertion',
        keySource: { kind: 'keystore', keystoreId: 'ks1', alias: 'signer' },
      }),
    ).toThrow(/requires a certificate and a private key/)
  })

  it('FAIL LOUD: refuses to sign a document with duplicate IDs', () => {
    const dup = wrapInResponse(goodAssertion({ id: '_a1' }) + goodAssertion({ id: '_a1' }))
    expect(() =>
      signSaml(dup, {
        privateKeyPem: rsaKey,
        certPem: rsaCert,
        algorithm: 'RSA-SHA256',
        signatureTarget: 'assertion',
      }),
    ).toThrow(/elements with ID "_a1"/)
  })
})

// ════════════════════════════════════════════════════════════
// VERIFY — tampering & trust anchor
// ════════════════════════════════════════════════════════════

describe('verify — tampering and trust anchor', () => {
  it('rejects a tampered attribute value (digest mismatch)', () => {
    const tampered = signedAssertion().replace('admin', 'superadmin')
    const res = verifySaml(tampered, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('signature-value')
    expect(res.signedReferences).toEqual([])
  })

  it('rejects a tampered NameID (the classic identity swap)', () => {
    const tampered = signedAssertion().replace('alice@corp.example', 'attacker@evil.example')
    const res = verifySaml(tampered, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('signature-value')
  })

  it('rejects verification against a FOREIGN certificate', () => {
    const res = verifySaml(signedAssertion(), foreignCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('signature-value')
    expect(res.reason).toMatch(/Signature validation failed/)
  })

  it('rejects an unsigned assertion', () => {
    const res = verifySaml(goodAssertion(), rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('signature-present')
    expect(res.reason).toMatch(/unsigned|No ds:Signature/i)
  })

  it('E-2: the trust anchor is the CALLER cert — a swapped KeyInfo cert changes nothing', () => {
    const signed = signedAssertion()
    const foreignB64 = foreignCert
      .replace(/-----BEGIN [^-]+-----/g, '')
      .replace(/-----END [^-]+-----/g, '')
      .replace(/\s+/g, '')
    const swapped = signed.replace(
      /<X509Certificate>[^<]+<\/X509Certificate>/,
      `<X509Certificate>${foreignB64}</X509Certificate>`,
    )
    expect(swapped).toContain(foreignB64)

    // Still valid under the caller's real cert…
    expect(verifySaml(swapped, rsaCert).valid).toBe(true)
    // …and NEVER valid under the attacker-planted KeyInfo cert.
    const asAttacker = verifySaml(swapped, foreignCert)
    expect(asAttacker.valid).toBe(false)
    expect(failedCheck(asAttacker)).toBe('signature-value')
  })

  it('rejects a missing / malformed verification certificate', () => {
    expect(verifySaml(signedAssertion(), '').reason).toMatch(/No verification certificate/)
    expect(verifySaml(signedAssertion(), 'not a pem').reason).toMatch(/not a valid PEM/)
  })

  it('rejects a malformed XML document without throwing', () => {
    const res = verifySaml('<saml:Assertion><oops></saml:Assertion>', rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('well-formed')
  })
})

// ════════════════════════════════════════════════════════════
// XSW BATTERY — every one MUST be rejected, with its own reason
// ════════════════════════════════════════════════════════════

describe('SECURITY: XML Signature Wrapping battery', () => {
  it('(a) signed assertion relocated into <Extensions>, evil unsigned assertion in its place', () => {
    const signedGood = signedAssertion('RSA-SHA256', goodAssertion({ id: '_good' }))
    const evil = goodAssertion({ id: '_evil', nameId: 'attacker@evil.example' })
    const wrapped =
      `<samlp:Response xmlns:samlp="${SAMLP_NS}" xmlns:saml="${SAML_NS}" ID="_r1" Version="2.0"` +
      ` IssueInstant="${toSamlInstant(new Date())}">` +
      `<saml:Issuer>${ISSUER}</saml:Issuer>` +
      `<samlp:Extensions>${signedGood}</samlp:Extensions>` +
      `<samlp:Status><samlp:StatusCode Value="${STATUS_SUCCESS}"/></samlp:Status>` +
      `${evil}</samlp:Response>`

    // A naive (WSSE-style) verifier says "valid" for this exact document.
    expect(naiveVerifierAccepts(wrapped)).toBe(true)

    const res = verifySaml(wrapped, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('signed-element-scope')
    expect(res.reason).toMatch(/XML Signature Wrapping/)
    expect(res.reason).toContain('_good')

    // …and the explicit "I require _evil to be signed" form is rejected too.
    const strict = verifySaml(wrapped, rsaCert, { requireSignedId: '_evil' })
    expect(strict.valid).toBe(false)
    expect(strict.reason).toMatch(/XML Signature Wrapping/)
  })

  it('(a2) signed assertion demoted to SECOND child, evil assertion promoted to active', () => {
    const signedGood = signedAssertion('RSA-SHA256', goodAssertion({ id: '_good' }))
    const evil = goodAssertion({ id: '_evil', nameId: 'attacker@evil.example' })
    const wrapped = wrapInResponse(evil + signedGood)
    expect(naiveVerifierAccepts(wrapped)).toBe(true)

    const res = verifySaml(wrapped, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('signed-element-scope')
    expect(res.reason).toMatch(/neither the document root nor the active Assertion/)
  })

  it('(b) evil assertion carrying a DUPLICATE ID', () => {
    const signedGood = signedAssertion('RSA-SHA256', goodAssertion({ id: '_good' }))
    const evilDuplicate = goodAssertion({ id: '_good', nameId: 'attacker@evil.example' })
    const doc = wrapInResponse(evilDuplicate + signedGood)

    const res = verifySaml(doc, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('unique-ids')
    expect(res.reason).toMatch(/duplicate ID "_good" \(2 elements\)/)
    expect(res.reason).toMatch(/XML Signature Wrapping/)
  })

  it('(c) a SECOND ds:Signature added to the document', () => {
    const signed = signedAssertion()
    const twoSignatures = signed.replace(
      '</saml:Assertion>',
      `${signatureBlock(signed)}</saml:Assertion>`,
    )
    // A first-match-regex verifier happily validates the first Signature.
    expect(naiveVerifierAccepts(twoSignatures)).toBe(true)

    const res = verifySaml(twoSignatures, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('single-signature')
    expect(res.reason).toMatch(/2 ds:Signature elements/)
  })

  it('(d) the signed element is referenced by URI but a SIBLING with the same ID is injected', () => {
    const signedGood = signedAssertion('RSA-SHA256', goodAssertion({ id: '_good' }))
    // Same ID, no signature of its own — the classic "sibling shadow".
    const sibling = goodAssertion({ id: '_good', nameId: 'attacker@evil.example' })
    const doc = wrapInResponse(signedGood + sibling)

    const res = verifySaml(doc, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('unique-ids')
    expect(res.reason).toContain('_good')
  })

  it('(e) DETACHED signature: the ds:Signature is hoisted out of the element it references', () => {
    const signedGood = signedAssertion('RSA-SHA256', goodAssertion({ id: '_good' }))
    const block = signatureBlock(signedGood)
    const strippedAssertion = signedGood.replace(block, '')
    const doc = wrapInResponse(strippedAssertion + block)
    expect(naiveVerifierAccepts(doc)).toBe(true)

    const res = verifySaml(doc, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('reference-target')
    expect(res.reason).toMatch(/must cover its own enclosing element/)
  })

  it('(f) the enveloped-signature transform is stripped from the Reference', () => {
    const signed = signedAssertion().replace(`<ds:Transform Algorithm="${ENVELOPED}"/>`, '')
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('transforms')
    expect(res.reason).toMatch(/missing the enveloped-signature transform/)
  })

  it('(g) a malicious XSLT transform is injected into the Reference', () => {
    const signed = signedAssertion().replace(
      `<ds:Transform Algorithm="${ENVELOPED}"/>`,
      `<ds:Transform Algorithm="${ENVELOPED}"/><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xslt-19991116"/>`,
    )
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('transforms')
    expect(res.reason).toMatch(/REC-xslt-19991116/)
  })

  it('(h) a #WithComments canonicalization is rejected (comment-insertion attack)', () => {
    const signed = signedAssertion().replace(
      `<ds:CanonicalizationMethod Algorithm="${EXC_C14N}"/>`,
      `<ds:CanonicalizationMethod Algorithm="${EXC_C14N}WithComments"/>`,
    )
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('canonicalization-method')
    expect(res.reason).toMatch(/WithComments/)
  })

  it('(i) a SECOND Reference smuggled into SignedInfo', () => {
    const signed = signedAssertion()
    const reference = signed.match(/<ds:Reference[\s\S]*?<\/ds:Reference>/)
    expect(reference).not.toBeNull()
    const twoRefs = signed.replace(
      '</ds:SignedInfo>',
      `${(reference as RegExpMatchArray)[0].replace('URI="#_a1"', 'URI="#_other"')}</ds:SignedInfo>`,
    )
    const res = verifySaml(twoRefs, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('single-reference')
    expect(res.reason).toMatch(/2 Reference elements/)
  })

  it('(j) an empty Reference URI (whole-document reference) is rejected', () => {
    const signed = signedAssertion().replace('URI="#_a1"', 'URI=""')
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('reference-uri')
    expect(res.reason).toMatch(/same-document "#ID" reference/)
  })

  it('(k) a Reference URI pointing at a non-existent ID is rejected', () => {
    const signed = signedAssertion().replace('URI="#_a1"', 'URI="#_nope"')
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('reference-uri')
    expect(res.reason).toMatch(/resolves to 0 elements/)
  })

  it('requireSignedId pins exactly which element the caller trusts', () => {
    const signed = signedAssertion()
    expect(verifySaml(signed, rsaCert, { requireSignedId: '_a1' }).valid).toBe(true)
    const wrong = verifySaml(signed, rsaCert, { requireSignedId: '_a2' })
    expect(wrong.valid).toBe(false)
    expect(failedCheck(wrong)).toBe('required-signed-id')
  })

  it('requireAssertionSigned rejects a Response-only signature', () => {
    const response = buildResponse({
      id: '_r1',
      issuer: ISSUER,
      assertion: { id: '_a1', issuer: ISSUER, subject: { nameId: 'alice@corp.example' } },
    }).xml
    const signed = signSaml(response, {
      privateKeyPem: rsaKey,
      certPem: rsaCert,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'response',
    })

    const strict = verifySaml(signed, rsaCert, { requireAssertionSigned: true })
    expect(strict.valid).toBe(false)
    expect(failedCheck(strict)).toBe('assertion-signed')
    expect(strict.reason).toMatch(/"_a1" is not among the signed references/)

    // Without the flag the Response signature is legitimately valid.
    expect(verifySaml(signed, rsaCert, { requireAssertionSigned: false }).valid).toBe(true)
  })

  it('(l) an UNSIGNED sibling assertion next to the signed one is rejected', () => {
    // The scope check proves the signature covers the ACTIVE assertion, but it
    // said nothing about siblings: a Response carrying the signed assertion
    // PLUS an unsigned one came back valid, and any consumer that iterates
    // assertions instead of reading only the first would have trusted
    // attacker-authored content.
    const signedGood = signedAssertion('RSA-SHA256', goodAssertion({ id: '_good' }))
    const evil = goodAssertion({ id: '_evil2', nameId: 'attacker@evil.example' })
    const doc =
      `<samlp:Response xmlns:samlp="${SAMLP_NS}" xmlns:saml="${SAML_NS}" ID="_r9" Version="2.0"` +
      ` IssueInstant="${toSamlInstant(new Date())}">` +
      `<saml:Issuer>${ISSUER}</saml:Issuer>` +
      `<samlp:Status><samlp:StatusCode Value="${STATUS_SUCCESS}"/></samlp:Status>` +
      `${signedGood}${evil}</samlp:Response>`

    const res = verifySaml(doc, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('single-assertion')
    expect(res.reason).toMatch(/XML Signature Wrapping/)
  })

  it('a Response with exactly ONE signed assertion still verifies', () => {
    const signedGood = signedAssertion('RSA-SHA256', goodAssertion({ id: '_solo' }))
    const doc =
      `<samlp:Response xmlns:samlp="${SAMLP_NS}" xmlns:saml="${SAML_NS}" ID="_r10" Version="2.0"` +
      ` IssueInstant="${toSamlInstant(new Date())}">` +
      `<saml:Issuer>${ISSUER}</saml:Issuer>` +
      `<samlp:Status><samlp:StatusCode Value="${STATUS_SUCCESS}"/></samlp:Status>` +
      `${signedGood}</samlp:Response>`

    const res = verifySaml(doc, rsaCert, { validateConditions: false })
    expect(res.valid).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════
// E-4 — SignatureMethod allowlist
// ════════════════════════════════════════════════════════════

describe('SECURITY: SignatureMethod allowlist (E-4)', () => {
  function hmacSignedDocument(): string {
    const hmac = new SignedXml({
      privateKey: rsaCert, // the PUBLIC cert abused as an HMAC secret
      publicCert: rsaCert,
      signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#hmac-sha1',
      canonicalizationAlgorithm: EXC_C14N,
    })
    hmac.enableHMAC()
    hmac.addReference({
      xpath: "//*[@ID='_a1']",
      uri: '#_a1',
      transforms: [ENVELOPED, EXC_C14N],
      digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    })
    hmac.computeSignature(goodAssertion(), {
      location: { reference: "//*[local-name(.)='Issuer']", action: 'after' },
      prefix: 'ds',
    })
    return hmac.getSignedXml()
  }

  it('an HMAC key-confusion document IS cryptographically "valid" to bare xml-crypto…', () => {
    const doc = hmacSignedDocument()
    const naive = new SignedXml({ publicCert: rsaCert })
    naive.enableHMAC()
    naive.loadSignature(signatureBlock(doc))
    // This is precisely the attack the allowlist exists to stop.
    expect(naive.checkSignature(doc)).toBe(true)
  })

  it('…and verifySaml rejects it on the algorithm allowlist, BEFORE any signature check', () => {
    const res = verifySaml(hmacSignedDocument(), rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('signature-method')
    expect(res.reason).toMatch(/Disallowed signature algorithm/)
    expect(res.reason).toMatch(/hmac-sha1/)
    // The crypto check never ran.
    expect(res.checks.some((c) => c.name === 'signature-value')).toBe(false)
  })

  it('rejects an unknown/garbage SignatureMethod', () => {
    const signed = signedAssertion().replace(
      SIGN_ALGO_URI['RSA-SHA256'],
      'http://evil.example/algo#magic',
    )
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('signature-method')
  })
})

// ════════════════════════════════════════════════════════════
// E-5 — DOCTYPE / XXE
// ════════════════════════════════════════════════════════════

describe('SECURITY: DOCTYPE / XXE rejection (E-5)', () => {
  const XXE =
    `<?xml version="1.0"?>` +
    `<!DOCTYPE samlp:Response [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>` +
    `<samlp:Response xmlns:samlp="${SAMLP_NS}" xmlns:saml="${SAML_NS}" ID="_r1" Version="2.0" IssueInstant="2026-01-01T00:00:00Z">` +
    `<saml:Issuer>&xxe;</saml:Issuer></samlp:Response>`

  it('verifySaml rejects a DOCTYPE payload before parsing, and never expands the entity', () => {
    const res = verifySaml(XXE, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('doctype')
    expect(res.reason).toMatch(/DOCTYPE\/DTD/)
    expect(res.reason).toMatch(/rejected before parsing/)
    expect(JSON.stringify(res)).not.toMatch(/root:x:/)
  })

  it('a billion-laughs payload is rejected promptly (bounded time, no expansion)', () => {
    const entities = Array.from({ length: 9 }, (_, i) =>
      i === 0
        ? `<!ENTITY lol "lol">`
        : `<!ENTITY lol${i} "&${i === 1 ? 'lol' : `lol${i - 1}`};&${i === 1 ? 'lol' : `lol${i - 1}`};&${i === 1 ? 'lol' : `lol${i - 1}`};">`,
    ).join('')
    const bomb =
      `<!DOCTYPE lolz [${entities}]>` +
      `<saml:Assertion xmlns:saml="${SAML_NS}" ID="_a1">&lol8;</saml:Assertion>`

    const started = Date.now()
    const res = verifySaml(bomb, rsaCert)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('doctype')
  })

  it('signSaml and the binding encoders refuse DOCTYPE input', () => {
    expect(() =>
      signSaml(XXE, { privateKeyPem: rsaKey, certPem: rsaCert, algorithm: 'RSA-SHA256' }),
    ).toThrow(/DOCTYPE\/DTD/)
    expect(() => encodeRedirect(XXE)).toThrow(/DOCTYPE\/DTD/)
    expect(() => encodePost(XXE)).toThrow(/DOCTYPE\/DTD/)
    expect(() => assertNoDoctype(XXE)).toThrow(/DOCTYPE\/DTD/)
  })

  it('the DOCTYPE guard also applies to DECODED Redirect/POST payloads', () => {
    // An attacker crafts the wire form directly, bypassing our encoders.
    const smuggledPost = Buffer.from(XXE, 'utf8').toString('base64')
    expect(() => decodePost(smuggledPost)).toThrow(/Decoded SAML POST payload/)

    const smuggledRedirect = zlib.deflateRawSync(Buffer.from(XXE, 'utf8')).toString('base64')
    expect(() => decodeRedirect(smuggledRedirect)).toThrow(/Decoded SAML Redirect payload/)
  })
})

// ════════════════════════════════════════════════════════════
// Conditions — temporal + audience
// ════════════════════════════════════════════════════════════

describe('verify — Conditions and Audience', () => {
  function signedAt(now: string): string {
    return signedAssertion('RSA-SHA256', goodAssertion({ now }))
  }

  it('rejects an EXPIRED assertion and says why', () => {
    const signed = signedAt('2020-01-01T00:00:00Z')
    const res = verifySaml(signed, rsaCert, { now: '2020-01-01T01:00:00Z' })
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('conditions-not-on-or-after')
    expect(res.reason).toMatch(/expired/)
    expect(res.reason).toContain('2020-01-01T00:05:00Z')
    // The signature itself was fine — only the temporal check failed.
    expect(res.checks.find((c) => c.name === 'signature-value')?.ok).toBe(true)
  })

  it('rejects a NOT-YET-VALID assertion and says why', () => {
    const signed = signedAt('2030-01-01T00:00:00Z')
    const res = verifySaml(signed, rsaCert, { now: '2029-12-31T00:00:00Z' })
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('conditions-not-before')
    expect(res.reason).toMatch(/not yet valid/)
  })

  it('honours a configurable clock skew at both ends', () => {
    const signed = signedAt('2026-01-01T00:00:00Z')
    // 30s past NotOnOrAfter → fails with the default 60s skew? No: skew widens
    // the window, so 30s past still passes; 10 minutes past does not.
    expect(verifySaml(signed, rsaCert, { now: '2026-01-01T00:05:30Z' }).valid).toBe(true)
    expect(verifySaml(signed, rsaCert, { now: '2026-01-01T00:15:00Z' }).valid).toBe(false)
    // A generous skew rescues the late one.
    expect(
      verifySaml(signed, rsaCert, { now: '2026-01-01T00:15:00Z', clockSkewSeconds: 1200 }).valid,
    ).toBe(true)
    // Zero skew tightens it again.
    expect(
      verifySaml(signed, rsaCert, { now: '2026-01-01T00:05:30Z', clockSkewSeconds: 0 }).valid,
    ).toBe(false)
  })

  it('validateConditions:false skips the temporal checks (replay-inspection mode)', () => {
    const signed = signedAt('2020-01-01T00:00:00Z')
    const res = verifySaml(signed, rsaCert, {
      now: '2026-01-01T00:00:00Z',
      validateConditions: false,
    })
    expect(res.valid).toBe(true)
    expect(res.conditions?.notOnOrAfter).toBe('2020-01-01T00:05:00Z')
  })

  it('rejects a WRONG audience and accepts the right one', () => {
    const signed = signedAssertion()
    const wrong = verifySaml(signed, rsaCert, { expectedAudience: 'https://other.example' })
    expect(wrong.valid).toBe(false)
    expect(failedCheck(wrong)).toBe('audience')
    expect(wrong.reason).toMatch(/Audience mismatch/)
    expect(verifySaml(signed, rsaCert, { expectedAudience: SP }).valid).toBe(true)
  })

  it('rejects a mismatched InResponseTo', () => {
    const assertion = buildAssertion({
      id: '_a1',
      issuer: ISSUER,
      subject: { nameId: 'alice@corp.example', inResponseTo: '_req1' },
    }).xml
    const signed = signedAssertion('RSA-SHA256', assertion)
    expect(verifySaml(signed, rsaCert, { expectedInResponseTo: '_req1' }).valid).toBe(true)
    const wrong = verifySaml(signed, rsaCert, { expectedInResponseTo: '_reqX' })
    expect(wrong.valid).toBe(false)
    expect(failedCheck(wrong)).toBe('in-response-to')
  })
})

// ════════════════════════════════════════════════════════════
// Bindings
// ════════════════════════════════════════════════════════════

describe('bindings — HTTP-Redirect and HTTP-POST', () => {
  const request = buildAuthnRequest({ id: '_req1', issuer: SP, destination: `${ISSUER}/sso` }).xml

  it('Redirect encode → decode round-trips byte-identically (raw DEFLATE + base64)', () => {
    const encoded = encodeRedirect(request)
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(decodeRedirect(encoded)).toBe(request)
    // raw DEFLATE has no zlib header
    expect(Buffer.from(encoded, 'base64')[0]).not.toBe(0x78)
  })

  it('Redirect URL-parameter form round-trips through percent-encoding', () => {
    const param = encodeRedirectUrlParam(request)
    expect(param).not.toContain('+')
    expect(decodeRedirect(param)).toBe(request)
  })

  it('POST binding is base64 ONLY and is distinct from Redirect', () => {
    const post = encodePost(request)
    expect(decodePost(post)).toBe(request)
    expect(Buffer.from(post, 'base64').toString('utf8')).toBe(request)
    expect(post).not.toBe(encodeRedirect(request))
    // A POST payload fed to the Redirect decoder must fail loudly, not emit garbage.
    expect(() => decodeRedirect(post)).toThrow(/not a valid raw-DEFLATE stream/)
  })

  it('malformed base64 fails cleanly', () => {
    expect(() => decodeRedirect('@@@ not base64 @@@')).toThrow(/not valid base64/)
    expect(() => decodePost('')).toThrow(/is empty/)
  })

  it('SECURITY: a DEFLATE decompression bomb is stopped by the inflated-size cap', () => {
    const bomb = zlib.deflateRawSync(Buffer.alloc(50 * 1024 * 1024)).toString('base64')
    expect(bomb.length).toBeLessThan(200_000)
    expect(() => decodeRedirect(bomb)).toThrow(/too large|decompression bomb/)
    expect(() => decodeRedirect(bomb, { maxInflatedBytes: 1024 })).toThrow(
      /exceeds the 1024 byte limit/,
    )
  })

  it('a truncated DEFLATE stream fails instead of emitting a partial document', () => {
    const encoded = encodeRedirect(request)
    const truncated = encoded.slice(0, Math.floor(encoded.length / 2))
    expect(() => decodeRedirect(truncated)).toThrow(/raw-DEFLATE/)
  })

  it('sign → Redirect encode → decode → verify survives the transport encoding', () => {
    const signed = signSaml(request, {
      privateKeyPem: rsaKey,
      certPem: rsaCert,
      algorithm: 'RSA-SHA256',
    })
    const back = decodeRedirect(encodeRedirect(signed))
    expect(back).toBe(signed)
    expect(verifySaml(back, rsaCert).valid).toBe(true)
  })

  it('sign → POST encode → decode → verify survives the transport encoding', () => {
    const signed = signedAssertion()
    const back = decodePost(encodePost(signed))
    expect(back).toBe(signed)
    expect(verifySaml(back, rsaCert).valid).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════
// NO-LEAK
// ════════════════════════════════════════════════════════════

describe('NO-LEAK: engine output never carries private key material', () => {
  it('signed XML contains the certificate but never the private key', () => {
    const signed = signedAssertion()
    expect(signed).toContain('<X509Certificate>')
    expect(signed).not.toContain('PRIVATE KEY')
    expect(signed).not.toContain(rsaKey.trim())
  })

  it('verify results never echo key material or a keySource password', () => {
    const res = verifySaml(signedAssertion(), rsaCert)
    const serialised = JSON.stringify(res)
    expect(serialised).not.toContain('PRIVATE KEY')
    expect(serialised).not.toContain(rsaKey.trim())
  })
})

// ════════════════════════════════════════════════════════════
// Weak-algorithm refusal (found by the adversarial crypto lens)
// ════════════════════════════════════════════════════════════

/**
 * Sign with explicitly-chosen SignatureMethod / DigestMethod URIs, bypassing the
 * engine's own algorithm maps — the only way to build the documents an attacker
 * (or a legacy IdP) would actually send.
 */
function signedWithRawAlgorithms(signatureAlgorithm: string, digestAlgorithm: string): string {
  const signer = new SignedXml({
    privateKey: rsaKey,
    publicCert: rsaCert,
    signatureAlgorithm,
    canonicalizationAlgorithm: EXC_C14N,
  })
  signer.addReference({
    xpath: "//*[@ID='_raw']",
    uri: '#_raw',
    transforms: [ENVELOPED, EXC_C14N],
    digestAlgorithm,
  })
  signer.computeSignature(goodAssertion({ id: '_raw' }), {
    location: { reference: "//*[local-name(.)='Issuer']", action: 'after' },
    prefix: 'ds',
  })
  return signer.getSignedXml()
}

describe('SECURITY: SHA-1 is refused on both halves of the pair', () => {
  it('signSaml will not produce a SHA-1 signature at all', () => {
    expect(() =>
      signSaml(goodAssertion({ id: '_sha1' }), {
        // The type no longer admits it; a JS caller (or old saved config) still
        // can, and must be refused rather than quietly downgraded.
        algorithm: 'RSA-SHA1' as unknown as SamlSignAlgorithm,
        certPem: rsaCert,
        privateKeyPem: rsaKey,
        signatureTarget: 'assertion',
      }),
    ).toThrow(/unsupported algorithm/i)
  })

  it('verifySaml rejects a SHA-1 SIGNATURE method', () => {
    const doc = signedWithRawAlgorithms(
      'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
      'http://www.w3.org/2001/04/xmlenc#sha256',
    )
    const res = verifySaml(doc, rsaCert, { validateConditions: false })
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('signature-method')
  })

  it('verifySaml rejects a SHA-1 DIGEST even under a strong signature', () => {
    // The dangerous asymmetry the lens found: only the signature URI was
    // inspected, so a collision-prone digest rode along under RS256.
    const doc = signedWithRawAlgorithms(
      'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      'http://www.w3.org/2000/09/xmldsig#sha1',
    )
    const res = verifySaml(doc, rsaCert, { validateConditions: false })
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('digest-method')
  })
})

// ════════════════════════════════════════════════════════════
// Temporal validation must FAIL CLOSED (adversarial crypto lens)
// ════════════════════════════════════════════════════════════

describe('SECURITY: no validity window means REJECT, not "valid"', () => {
  /** An assertion whose <Conditions> block has been stripped entirely. */
  function assertionWithoutConditions(): string {
    const xml = goodAssertion({ id: '_nocond' })
    return xml.replace(/<saml:Conditions[\s\S]*?<\/saml:Conditions>/, '')
  }

  it('rejects a signed assertion that carries no Conditions at all', () => {
    const signed = signSaml(assertionWithoutConditions(), {
      privateKeyPem: rsaKey,
      certPem: rsaCert,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
    })
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('conditions-present')
  })

  it('still lets a caller inspect such a document deliberately', () => {
    const signed = signSaml(assertionWithoutConditions(), {
      privateKeyPem: rsaKey,
      certPem: rsaCert,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
    })
    expect(verifySaml(signed, rsaCert, { validateConditions: false }).valid).toBe(true)
  })

  it('rejects an EXPIRED bearer confirmation even when Conditions is fresh', () => {
    // The Web SSO profile makes this window mandatory, and it is a DIFFERENT
    // window from Conditions — a stolen assertion whose confirmation closed
    // yesterday used to pass on a fresh Conditions alone.
    const fresh = buildAssertion({
      id: '_bearer',
      issuer: ISSUER,
      subject: {
        nameId: 'alice@corp.example',
        recipient: `${SP}/acs`,
        // Confirmation window already closed (Conditions stays fresh).
        confirmationNotOnOrAfterSeconds: -3600,
      },
      audience: SP,
    }).xml
    const signed = signSaml(fresh, {
      privateKeyPem: rsaKey,
      certPem: rsaCert,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
    })
    const res = verifySaml(signed, rsaCert)
    expect(res.valid).toBe(false)
    expect(failedCheck(res)).toBe('subject-confirmation-expiry')
  })
})
