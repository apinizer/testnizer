/**
 * Tools → SAML renderer wiring (#65, Faz E).
 *
 * Two things are pinned here, both of them invariants rather than cosmetics:
 *
 *  1. ADDITIVE — the pasted Certificate / Private Key PEM textareas are the
 *     DEFAULT path. With the "Use from keystore / Security" picker untouched
 *     the payload sent to `saml:sign` is EXACTLY the inline shape, and picking
 *     a source neither clears nor reads those textareas (clearing the source
 *     returns to them unchanged).
 *
 *  2. An XSW rejection is UNMISTAKABLE. A validator that renders a wrapped
 *     document as a bare "invalid" is barely better than none: the report must
 *     say the signature does not cover the assertion being trusted, and mark
 *     the exact check that failed.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
;(globalThis as unknown as { React: typeof React }).React = React

// Monaco is replaced by a plain textarea so the XML editor is controllable.
vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({
    value,
    onChange,
    readOnly,
  }: {
    value?: string
    onChange?: (v: string) => void
    readOnly?: boolean
  }) =>
    React.createElement('textarea', {
      'data-monaco': readOnly ? 'output' : 'input',
      value: value ?? '',
      readOnly: !!readOnly,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
    }),
}))

import SamlTool from '../../src/renderer/components/tools/SamlTool'

const CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIPASTED\n-----END CERTIFICATE-----'
const KEY_PEM = '-----BEGIN PRIVATE KEY-----\nMIIPASTEDKEY\n-----END PRIVATE KEY-----'
const XML = '<saml:Assertion ID="_a1"/>'

const LIB = {
  id: 'lib-1',
  name: 'Prod Keystore',
  type: 'PKCS12',
  alias_count: 1,
  size_bytes: 2048,
  created_at: 1,
  updated_at: 1,
  remembered: true,
}

const samlSign = vi.fn(async () => ({ success: true, data: { xml: '<signed/>' } }))
const samlVerify = vi.fn(async () => ({ success: true, data: WRAPPED_RESULT }))
const samlBuild = vi.fn(async () => ({
  success: true,
  data: { xml: XML, id: '_a1', issueInstant: '2026-01-01T00:00:00Z' },
}))
const samlEncode = vi.fn(async () => ({ success: true, data: { value: 'b64' } }))
const samlDecode = vi.fn(async () => ({ success: true, data: { xml: XML } }))

const libraryList = vi.fn(async () => ({ success: true, data: [LIB] }))
const libraryOpen = vi.fn(async () => ({
  success: true,
  data: {
    sessionId: 'sess-1',
    meta: {
      type: 'PKCS12',
      aliasCount: 1,
      aliases: [{ alias: 'client1', entryType: 'KEY', hasPrivateKey: true }],
    },
  },
}))
const aliasDetail = vi.fn(async () => ({ success: true, data: { chain: [] } }))
const closeSession = vi.fn(async () => ({ success: true, data: true }))

/** A verification report for the classic wrapping attack. */
const WRAPPED_RESULT = {
  valid: false,
  reason:
    'The signature covers element "_a1" but the Assertion being trusted is "_evil" — rejected as an XML Signature Wrapping attempt',
  signedReferences: ['_a1'],
  signedContent: [],
  signatureMethod: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  checks: [
    { name: 'trust-anchor', ok: true },
    { name: 'doctype', ok: true },
    { name: 'well-formed', ok: true },
    { name: 'unique-ids', ok: true },
    { name: 'signature-present', ok: true },
    { name: 'single-signature', ok: true },
    { name: 'signature-method', ok: true },
    { name: 'single-reference', ok: true },
    {
      name: 'signed-element-scope',
      ok: false,
      detail: 'The signed element is not the Assertion the caller would trust',
    },
  ],
}

function installBridge(): void {
  const g = globalThis as unknown as { window: { api: Record<string, unknown> } }
  if (!g.window) g.window = { api: {} }
  g.window.api = {
    ...(g.window.api ?? {}),
    saml: {
      build: samlBuild,
      sign: samlSign,
      verify: samlVerify,
      encode: samlEncode,
      decode: samlDecode,
    },
    keystore: { libraryList, libraryOpen, aliasDetail, closeSession },
  }
}

/** The mode tab (px-2.5) vs the primary action button (px-3) share a label. */
function clickMode(label: string): void {
  const btn = screen
    .getAllByRole('button', { name: label })
    .find((b) => b.className.includes('px-2.5'))
  fireEvent.click(btn as HTMLElement)
}
function clickAction(label: string): void {
  const btn = screen
    .getAllByRole('button', { name: label })
    .find((b) => b.className.includes('px-3'))
  fireEvent.click(btn as HTMLElement)
}

async function selectAlias(): Promise<void> {
  fireEvent.click(await screen.findByText('Prod Keystore'))
  fireEvent.click(await screen.findByText('client1'))
  fireEvent.click(screen.getByText('Use this key'))
}

function fillSignForm(container: HTMLElement): void {
  fireEvent.change(container.querySelector('[data-monaco="input"]') as HTMLTextAreaElement, {
    target: { value: XML },
  })
  fireEvent.change(screen.getByPlaceholderText(/Certificate PEM/), { target: { value: CERT_PEM } })
  fireEvent.change(screen.getByPlaceholderText(/Private key PEM/), { target: { value: KEY_PEM } })
}

beforeEach(() => {
  vi.clearAllMocks()
  installBridge()
})

afterEach(() => cleanup())

describe('SAML tool — Sign tab keeps pasted PEM as the default path', () => {
  it('sends the EXACT inline payload when the keystore picker is untouched', async () => {
    const { container } = render(<SamlTool />)
    clickMode('Sign')
    fillSignForm(container)

    clickAction('Sign')

    await waitFor(() => expect(samlSign).toHaveBeenCalledTimes(1))
    const payload = samlSign.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({
      xml: XML,
      algorithm: 'RSA-SHA256',
      signatureTarget: 'assertion',
      key: { inline: { certPem: CERT_PEM, privateKeyPem: KEY_PEM } },
    })
    // No provider was even consulted, and nothing source-shaped is on the wire.
    expect(libraryList).not.toHaveBeenCalled()
    expect(JSON.stringify(payload)).not.toContain('source')
  })

  it('picking a source adds ONE arm and never touches the pasted textareas', async () => {
    const { container } = render(<SamlTool />)
    clickMode('Sign')
    fillSignForm(container)

    fireEvent.click(screen.getByText('Use from keystore / Security'))
    await selectAlias()
    await waitFor(() => expect(screen.queryByText('Use this key')).toBeNull())

    // The default-path inputs survive verbatim.
    expect((screen.getByPlaceholderText(/Certificate PEM/) as HTMLTextAreaElement).value).toBe(
      CERT_PEM,
    )
    expect((screen.getByPlaceholderText(/Private key PEM/) as HTMLTextAreaElement).value).toBe(
      KEY_PEM,
    )

    clickAction('Sign')
    await waitFor(() => expect(samlSign).toHaveBeenCalledTimes(1))
    const payload = samlSign.mock.calls[0][0] as { key: unknown }
    expect(payload.key).toEqual({
      source: { kind: 'keystore', keystoreId: 'lib-1', alias: 'client1' },
    })
    // The pasted PEM is NOT smuggled alongside the source.
    expect(JSON.stringify(payload)).not.toContain('PASTEDKEY')
  })

  it('clearing the source returns to the inline default path, textareas intact', async () => {
    const { container } = render(<SamlTool />)
    clickMode('Sign')
    fillSignForm(container)

    fireEvent.click(screen.getByText('Use from keystore / Security'))
    await selectAlias()
    fireEvent.click(await screen.findByText('Use pasted PEM'))

    clickAction('Sign')
    await waitFor(() => expect(samlSign).toHaveBeenCalledTimes(1))
    const payload = samlSign.mock.calls[0][0] as { key: unknown }
    expect(payload.key).toEqual({ inline: { certPem: CERT_PEM, privateKeyPem: KEY_PEM } })
  })
})

describe('SAML tool — Verify tab', () => {
  it('sends only the trust anchor (never a private key) as the inline arm', async () => {
    const { container } = render(<SamlTool />)
    clickMode('Verify')
    fireEvent.change(container.querySelector('[data-monaco="input"]') as HTMLTextAreaElement, {
      target: { value: XML },
    })
    fireEvent.change(screen.getByPlaceholderText(/Certificate to trust/), {
      target: { value: CERT_PEM },
    })

    clickAction('Verify')
    await waitFor(() => expect(samlVerify).toHaveBeenCalledTimes(1))
    const payload = samlVerify.mock.calls[0][0] as { key: unknown; options: unknown }
    expect(payload.key).toEqual({ inline: { certPem: CERT_PEM } })
    expect(JSON.stringify(payload)).not.toContain('privateKeyPem')
  })

  it('makes an XSW rejection UNMISTAKABLE — never a bare "invalid"', async () => {
    const { container } = render(<SamlTool />)
    clickMode('Verify')
    fireEvent.change(container.querySelector('[data-monaco="input"]') as HTMLTextAreaElement, {
      target: { value: XML },
    })
    fireEvent.change(screen.getByPlaceholderText(/Certificate to trust/), {
      target: { value: CERT_PEM },
    })

    clickAction('Verify')

    // Twice on purpose: the report headline and the footer status line.
    await waitFor(() => expect(screen.getAllByText('REJECTED').length).toBe(2))
    // The specific reason, not a generic failure.
    expect(
      screen.getByText(
        'The signature does not cover the assertion being trusted (XML Signature Wrapping).',
      ),
    ).toBeInTheDocument()
    // …and the per-check breakdown names the guarantee that broke.
    expect(screen.getByText('signed-element-scope')).toBeInTheDocument()
    expect(screen.getAllByText('FAIL').length).toBe(1)
    expect(screen.getAllByText('PASS').length).toBe(8)
  })
})
