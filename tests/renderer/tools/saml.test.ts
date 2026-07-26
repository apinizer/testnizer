/**
 * Pure SAML tool logic (#65) — the form→payload mapping, in the node `|tools|`
 * project (no DOM, no bridge).
 *
 * `buildKeyInput` is where the ADDITIVE invariant actually lives: the inline
 * arm is what a UI with an untouched picker produces, and picking a source must
 * neither read nor destroy the pasted PEM state.
 */
import { describe, it, expect } from 'vitest'
import {
  buildKeyInput,
  buildRequestFromForm,
  classifyFailure,
  emptyBuildForm,
  emptySignForm,
  emptyVerifyForm,
  firstFailedCheck,
  isWrappingFailure,
  verifyOptionsFromForm,
} from '../../../src/renderer/lib/tools/saml'
import type { SamlVerifyResult } from '../../../src/renderer/types'

const CERT = '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----'
const KEY = '-----BEGIN PRIVATE KEY-----\nBBB\n-----END PRIVATE KEY-----'

function report(checks: { name: string; ok: boolean; detail?: string }[]): SamlVerifyResult {
  return {
    valid: checks.every((c) => c.ok),
    signedReferences: [],
    signedContent: [],
    checks,
  }
}

describe('buildKeyInput — the additive arm', () => {
  it('produces the inline arm and nothing else when no source is picked', () => {
    const form = { ...emptySignForm(), certPem: CERT, privateKeyPem: KEY }
    const key = buildKeyInput(form)
    expect(key).toEqual({ inline: { certPem: CERT, privateKeyPem: KEY } })
    expect(JSON.stringify(key)).not.toContain('source')
  })

  it('omits an empty passphrase (the payload stays the minimal inline shape)', () => {
    const key = buildKeyInput({ ...emptySignForm(), certPem: CERT, privateKeyPem: KEY })
    expect('passphrase' in (key as { inline: object }).inline).toBe(false)
  })

  it('carries a non-empty passphrase through', () => {
    const key = buildKeyInput({
      ...emptySignForm(),
      certPem: CERT,
      privateKeyPem: KEY,
      passphrase: 's3cret',
    })
    expect(key).toEqual({ inline: { certPem: CERT, privateKeyPem: KEY, passphrase: 's3cret' } })
  })

  it('swaps to the single source arm WITHOUT reading the pasted PEM', () => {
    const form = {
      ...emptySignForm(),
      certPem: CERT,
      privateKeyPem: KEY,
      keySource: { kind: 'keystore' as const, keystoreId: 'k1', alias: 'a1' },
    }
    const key = buildKeyInput(form)
    expect(key).toEqual({ source: { kind: 'keystore', keystoreId: 'k1', alias: 'a1' } })
    expect(JSON.stringify(key)).not.toContain('BBB')
    // The form state is untouched — clearing the source restores the default.
    expect(form.certPem).toBe(CERT)
    expect(form.privateKeyPem).toBe(KEY)
    expect(buildKeyInput({ ...form, keySource: null })).toEqual({
      inline: { certPem: CERT, privateKeyPem: KEY },
    })
  })

  it('a verify form yields a certificate-only inline arm (no private half)', () => {
    const form = emptyVerifyForm()
    const key = buildKeyInput({ certPem: CERT, keySource: form.keySource })
    expect(key).toEqual({ inline: { certPem: CERT } })
  })
})

describe('buildRequestFromForm', () => {
  it('maps the assertion form and drops empty optional fields', () => {
    const form = { ...emptyBuildForm(), kind: 'assertion' as const, inResponseTo: '' }
    const req = buildRequestFromForm(form)
    expect(req.kind).toBe('assertion')
    if (req.kind !== 'assertion') throw new Error('wrong kind')
    expect(req.config.subject.inResponseTo).toBeUndefined()
    expect(req.config.audience).toBe('https://sp.example.com/metadata')
    expect(req.config.attributes).toEqual([{ name: 'email', values: ['alice@example.com'] }])
  })

  it('an AuthnRequest carries no subject/assertion fields at all', () => {
    const req = buildRequestFromForm({ ...emptyBuildForm(), kind: 'authnRequest' })
    if (req.kind !== 'authnRequest') throw new Error('wrong kind')
    expect(Object.keys(req.config).sort()).toEqual([
      'assertionConsumerServiceURL',
      'destination',
      'issuer',
      'nameIdFormat',
    ])
  })

  it('a Response embeds the editor XML verbatim only when asked', () => {
    const editor = '<saml:Assertion ID="_signed"/>'
    const inline = buildRequestFromForm({ ...emptyBuildForm(), kind: 'response' }, editor)
    if (inline.kind !== 'response') throw new Error('wrong kind')
    expect(inline.config.assertionXml).toBeUndefined()
    expect(inline.config.assertion).toBeTruthy()

    const embedded = buildRequestFromForm(
      { ...emptyBuildForm(), kind: 'response', embedEditorAssertion: true },
      editor,
    )
    if (embedded.kind !== 'response') throw new Error('wrong kind')
    expect(embedded.config.assertionXml).toBe(editor)
    expect(embedded.config.assertion).toBeUndefined()
  })

  it('verify options pass a zero clock skew through (0 is not "unset")', () => {
    const opts = verifyOptionsFromForm({ ...emptyVerifyForm(), clockSkewSeconds: 0 })
    expect(opts.clockSkewSeconds).toBe(0)
    expect(opts.expectedAudience).toBeUndefined()
  })
})

describe('classifyFailure — a rejection is never generic', () => {
  it.each([
    ['unique-ids', 'xsw'],
    ['single-signature', 'xsw'],
    ['single-reference', 'xsw'],
    ['reference-uri', 'xsw'],
    ['reference-target', 'xsw'],
    ['signed-element-scope', 'xsw'],
    ['required-signed-id', 'xsw'],
    ['assertion-signed', 'xsw'],
    ['transforms', 'xsw'],
    ['signature-method', 'algorithm'],
    ['canonicalization-method', 'algorithm'],
    ['doctype', 'doctype'],
    ['trust-anchor', 'trust'],
    ['signature-value', 'signature'],
    ['signature-present', 'signature'],
    ['conditions-not-on-or-after', 'expired'],
    ['audience', 'audience'],
    ['well-formed', 'malformed'],
  ])('maps the %s check to the %s category', (check, category) => {
    const res = report([
      { name: 'trust-anchor', ok: check !== 'trust-anchor' },
      { name: check, ok: false },
    ])
    // The FIRST failing check is the reason it stopped.
    expect(classifyFailure(res).category).toBe(check === 'trust-anchor' ? 'trust' : category)
  })

  it('flags every wrapping variant as an XSW failure', () => {
    const res = report([
      { name: 'signature-value', ok: true },
      { name: 'signed-element-scope', ok: false, detail: 'signed _a1, trusting _evil' },
    ])
    expect(isWrappingFailure(res)).toBe(true)
    expect(firstFailedCheck(res)).toEqual({
      name: 'signed-element-scope',
      detail: 'signed _a1, trusting _evil',
    })
  })

  it('a fully passing report is not a failure', () => {
    const res = report([{ name: 'trust-anchor', ok: true }])
    expect(res.valid).toBe(true)
    expect(isWrappingFailure(res)).toBe(false)
    expect(firstFailedCheck(res)).toBeUndefined()
  })
})
