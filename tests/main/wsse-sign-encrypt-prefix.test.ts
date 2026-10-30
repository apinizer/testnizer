/**
 * WS-Security engine — peer-review findings on issue #298 / issue #299.
 *
 *  (3) Sign-then-encrypt: the Body was signed over its exact bytes, then its
 *      content was TRIMMED before encryption, so after the recipient decrypts
 *      the Body no longer holds the signed text nodes and the signature fails.
 *  (6) Envelope prefix collision: Security borrowed the Envelope's prefix for
 *      `mustUnderstand` but also declared `xmlns:wsse` / `xmlns:wsu` on itself.
 *      An Envelope that uses `wsse:` or `wsu:` as its SOAP prefix got that
 *      prefix rebound, so `mustUnderstand` landed in the WS-Security namespace.
 *      The Body's `wsu:Id` had the same flaw: on `<wsu:Body>` it rebound the
 *      Body element's own prefix.
 *
 * Every assertion is namespace-aware (`getAttributeNS`, `namespaceURI`).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DOMParser, type Document, type Element } from '@xmldom/xmldom'
import {
  applyWsSecurity,
  decryptEnvelope,
  verifySignature,
  WSSE_NS,
  WSU_NS,
  type WsSecurityConfig,
} from '../../src/main/protocols/wsse.engine'

const SOAP11 = 'http://schemas.xmlsoap.org/soap/envelope/'
const SOAP12 = 'http://www.w3.org/2003/05/soap-envelope'
const CERTS = path.resolve(__dirname, '../fixtures/certs')

let certPem: string
let keyPem: string

beforeAll(() => {
  certPem = readFileSync(path.join(CERTS, 'server.crt'), 'utf8')
  keyPem = readFileSync(path.join(CERTS, 'server.key'), 'utf8')
})

function parseStrict(xml: string): Document {
  return new DOMParser({
    onError: (level: string, msg: string) => {
      throw new Error(`XML ${level}: ${msg}`)
    },
  }).parseFromString(xml, 'text/xml') as unknown as Document
}

/** Indented, SoapUI-style — the Body content is surrounded by whitespace text nodes. */
const INDENTED = `<soapenv:Envelope xmlns:soapenv="${SOAP11}" xmlns:tem="http://tempuri.org/">
   <soapenv:Header/>
   <soapenv:Body>
      <tem:Add>
         <tem:intA>1</tem:intA>
         <tem:intB>2</tem:intB>
      </tem:Add>
   </soapenv:Body>
</soapenv:Envelope>`

function signEncrypt(signFirst?: boolean): WsSecurityConfig {
  return {
    enabled: true,
    modes: ['timestamp', 'sign', 'encrypt'],
    timestamp: { ttlSeconds: 300 },
    sign: {
      privateKeyPem: keyPem,
      certPem,
      algorithm: 'RSA-SHA256',
      references: ['Body', 'Timestamp'],
      keyInfoStrategy: 'BinarySecurityToken',
    },
    encrypt: {
      recipientCertPem: certPem,
      algorithm: 'AES-256-CBC',
      keyWrap: 'RSA-OAEP',
    },
    ...(signFirst === undefined ? {} : { signFirst }),
  }
}

describe('(3) sign + encrypt keep the signed Body bytes', () => {
  it('sign-then-encrypt (default order): decrypting restores a Body whose signature verifies', async () => {
    const wire = await applyWsSecurity(INDENTED, signEncrypt())
    expect(wire).toContain('EncryptedData')
    expect(wire).not.toContain('<tem:intA>')
    const decrypted = await decryptEnvelope(wire, keyPem)
    expect(decrypted).toContain('<tem:intA>1</tem:intA>')
    const v = verifySignature(decrypted, certPem)
    expect(v.reason).toBeUndefined()
    expect(v.valid).toBe(true)
  })

  it('sign-then-encrypt: the decrypted Body content is byte-identical to the signed one', async () => {
    const wire = await applyWsSecurity(INDENTED, signEncrypt())
    const decrypted = await decryptEnvelope(wire, keyPem)
    const content = (xml: string): string => {
      const open = xml.search(/<soapenv:Body[\s>]/)
      const start = xml.indexOf('>', open) + 1
      return xml.slice(start, xml.indexOf('</soapenv:Body>'))
    }
    const original = content(INDENTED)
    expect(content(decrypted)).toBe(original)
  })

  it('encrypt-then-sign (signFirst: false): the wire envelope verifies; decrypt restores the content', async () => {
    const wire = await applyWsSecurity(INDENTED, signEncrypt(false))
    expect(wire).toContain('EncryptedData')
    expect(verifySignature(wire, certPem).valid).toBe(true)
    const decrypted = await decryptEnvelope(wire, keyPem)
    expect(decrypted).toContain('<tem:intA>1</tem:intA>')
    parseStrict(decrypted)
  })
})

// ─── (6) prefix collisions ──────────────────────────────────────

function envelopeWithPrefix(prefix: string, ns = SOAP11): string {
  return `<${prefix}:Envelope xmlns:${prefix}="${ns}" xmlns:tem="http://tempuri.org/">
  <${prefix}:Header/>
  <${prefix}:Body>
    <tem:Ping>1</tem:Ping>
  </${prefix}:Body>
</${prefix}:Envelope>`
}

function securityOf(doc: Document): Element {
  const sec = doc.getElementsByTagNameNS(WSSE_NS, 'Security')
  expect(sec.length).toBe(1)
  return sec[0] as unknown as Element
}

function bodyOf(doc: Document, envNs: string): Element {
  const bodies = doc.getElementsByTagNameNS(envNs, 'Body')
  expect(bodies.length).toBe(1)
  return bodies[0] as unknown as Element
}

const UT: WsSecurityConfig['usernameToken'] = {
  username: 'alice',
  password: 'secret-pw-1',
  passwordType: 'PasswordText',
  nonce: false,
  created: false,
}

describe('(6) the Envelope prefix never collides with wsse / wsu', () => {
  for (const prefix of ['wsse', 'wsu']) {
    for (const ns of [SOAP11, SOAP12]) {
      it(`<${prefix}:Envelope> (${ns === SOAP11 ? '1.1' : '1.2'}): mustUnderstand is in the SOAP namespace`, async () => {
        const out = await applyWsSecurity(envelopeWithPrefix(prefix, ns), {
          enabled: true,
          modes: ['username-token', 'timestamp'],
          usernameToken: UT,
          timestamp: { ttlSeconds: 300 },
        })
        const doc = parseStrict(out)
        expect(doc.documentElement?.namespaceURI).toBe(ns)
        const sec = securityOf(doc)
        expect(sec.getAttributeNS(ns, 'mustUnderstand')).toBe('1')
        expect(sec.hasAttributeNS(WSSE_NS, 'mustUnderstand')).toBe(false)
        expect(sec.hasAttributeNS(WSU_NS, 'mustUnderstand')).toBe(false)
        // The header's own tokens are still in their namespaces.
        expect(doc.getElementsByTagNameNS(WSSE_NS, 'UsernameToken').length).toBe(1)
        expect(doc.getElementsByTagNameNS(WSU_NS, 'Timestamp').length).toBe(1)
        expect(sec.parentNode?.namespaceURI).toBe(ns)
      })
    }
  }

  it('<wsu:Envelope> + Sign: the Body stays a SOAP Body, gets a WSU Id, and the signature verifies', async () => {
    const out = await applyWsSecurity(envelopeWithPrefix('wsu'), {
      enabled: true,
      modes: ['timestamp', 'sign'],
      timestamp: { ttlSeconds: 300 },
      sign: {
        privateKeyPem: keyPem,
        certPem,
        algorithm: 'RSA-SHA256',
        references: ['Body', 'Timestamp'],
        keyInfoStrategy: 'BinarySecurityToken',
      },
    })
    const doc = parseStrict(out)
    const body = bodyOf(doc, SOAP11)
    expect(body.getAttributeNS(WSU_NS, 'Id')).toMatch(/^Body-/)
    expect(securityOf(doc).getAttributeNS(SOAP11, 'mustUnderstand')).toBe('1')
    expect(verifySignature(out, certPem).valid).toBe(true)
  })

  it('a default-namespace Envelope still gets a namespace-qualified mustUnderstand', async () => {
    const xml = `<Envelope xmlns="${SOAP11}"><Header/><Body><Ping xmlns="urn:x">1</Ping></Body></Envelope>`
    const out = await applyWsSecurity(xml, {
      enabled: true,
      modes: ['username-token'],
      usernameToken: UT,
    })
    const doc = parseStrict(out)
    expect(securityOf(doc).getAttributeNS(SOAP11, 'mustUnderstand')).toBe('1')
  })

  it('a regular soapenv: Envelope keeps borrowing its own prefix (unchanged)', async () => {
    const out = await applyWsSecurity(envelopeWithPrefix('soapenv'), {
      enabled: true,
      modes: ['username-token'],
      usernameToken: UT,
    })
    expect(out).toMatch(/<wsse:Security [^>]*soapenv:mustUnderstand="1"/)
    expect(securityOf(parseStrict(out)).getAttributeNS(SOAP11, 'mustUnderstand')).toBe('1')
  })
})
