/**
 * Faz C renderer — KeyMaterialPicker (#60) as an ADDED, non-default option.
 *
 * Pins the three invariants the wiring must not break:
 *  1. the picker emits an OPAQUE MaterialSource (ids/aliases + write-only
 *     passwords) — never certificate/key bytes, and never reads a password back;
 *  2. picking a keystore source does NOT wipe or replace the pasted-PEM fields;
 *  3. with the picker untouched, the config a consumer produces is byte-for-byte
 *     the pre-#60 inline shape (no `keySource` key at all).
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// Vitest's esbuild transform uses the classic JSX runtime → React must be global.
;(globalThis as unknown as { React: typeof React }).React = React

import KeyMaterialPicker from '../../src/renderer/components/shared/KeyMaterialPicker'
import SoapSecuritySection from '../../src/renderer/components/protocols/SoapSecuritySection'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import type { MaterialSource } from '../../src/renderer/types'

const CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIPASTED\n-----END CERTIFICATE-----'
const KEY_PEM = '-----BEGIN PRIVATE KEY-----\nMIIPASTEDKEY\n-----END PRIVATE KEY-----'

const LIB = {
  id: 'lib-1',
  name: 'Prod Keystore',
  type: 'PKCS12',
  alias_count: 2,
  size_bytes: 2048,
  created_at: 1,
  updated_at: 1,
  remembered: false, // remember-password OFF → the store pw must be typed (R11)
}

const ALIASES = [
  { alias: 'client1', entryType: 'KEY', hasPrivateKey: true },
  { alias: 'trustedca', entryType: 'CERTIFICATE', hasPrivateKey: false },
]

const libraryList = vi.fn(async () => ({ success: true, data: [LIB] }))
const libraryOpen = vi.fn(async () => ({
  success: true,
  data: { sessionId: 'sess-1', meta: { type: 'PKCS12', aliasCount: 2, aliases: ALIASES } },
}))
const aliasDetail = vi.fn(async () => ({
  success: true,
  // PUBLIC metadata only — never key material.
  data: {
    alias: 'client1',
    entryType: 'KEY',
    hasPrivateKey: true,
    chain: [{ subjectDN: 'CN=client1' }],
  },
}))
const closeSession = vi.fn(async () => ({ success: true, data: true }))

function installBridge(): void {
  const keystore = { libraryList, libraryOpen, aliasDetail, closeSession }
  const g = globalThis as unknown as { window: { api: Record<string, unknown> } }
  if (!g.window) g.window = { api: {} }
  g.window.api = { ...(g.window.api ?? {}), keystore }
}

/** Drive the picker: keystore → store password → open → alias → key password. */
async function selectAlias(): Promise<void> {
  fireEvent.click(await screen.findByText('Prod Keystore'))
  fireEvent.change(screen.getByLabelText('Store password'), { target: { value: 'storepw' } })
  fireEvent.click(screen.getByText('Open keystore'))
  fireEvent.click(await screen.findByText('client1'))
  fireEvent.change(screen.getByLabelText('Key (entry) password'), { target: { value: 'keypw' } })
  fireEvent.click(screen.getByText('Use this key'))
}

beforeEach(() => {
  libraryList.mockClear()
  libraryOpen.mockClear()
  aliasDetail.mockClear()
  closeSession.mockClear()
  installBridge()
})

afterEach(() => cleanup())

describe('KeyMaterialPicker — opaque MaterialSource', () => {
  it('emits ids/alias + write-only passwords and NO key bytes', async () => {
    const onSelect = vi.fn()
    render(<KeyMaterialPicker open onClose={() => {}} onSelect={onSelect} filter="privateKey" />)

    await selectAlias()

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    const { source, label } = onSelect.mock.calls[0][0] as { source: MaterialSource; label: string }
    expect(source).toEqual({
      kind: 'keystore',
      keystoreId: 'lib-1',
      alias: 'client1',
      keyPassword: 'keypw',
      storePassword: 'storepw',
    })
    expect(label).toBe("keystore 'Prod Keystore' › client1")
    // No certificate/key material may ever appear in a renderer-held source.
    const serialized = JSON.stringify(source)
    expect(serialized).not.toContain('BEGIN')
    expect(serialized).not.toContain('PRIVATE KEY')
    expect(Object.keys(source)).not.toContain('certPem')
    expect(Object.keys(source)).not.toContain('keyPem')
    // The remember-off store password is what libraryOpen received (main-side only).
    expect(libraryOpen).toHaveBeenCalledWith({ id: 'lib-1', password: 'storepw' })
  })

  it('filters out public-only aliases when the consumer needs a private key', async () => {
    render(<KeyMaterialPicker open onClose={() => {}} onSelect={vi.fn()} filter="privateKey" />)
    fireEvent.click(await screen.findByText('Prod Keystore'))
    fireEvent.change(screen.getByLabelText('Store password'), { target: { value: 'storepw' } })
    fireEvent.click(screen.getByText('Open keystore'))
    await screen.findByText('client1')
    expect(screen.queryByText('trustedca')).toBeNull()
  })

  it('never reads a password back out of an existing value (write-only)', async () => {
    const stored: MaterialSource = {
      kind: 'keystore',
      keystoreId: 'lib-1',
      alias: 'client1',
      keyPassword: 'super-secret',
      storePassword: 'super-secret',
    }
    render(
      <KeyMaterialPicker
        open
        onClose={() => {}}
        onSelect={vi.fn()}
        value={stored}
        filter="privateKey"
      />,
    )
    fireEvent.click(await screen.findByText('Prod Keystore'))
    const pw = screen.getByLabelText('Store password') as HTMLInputElement
    expect(pw.value).toBe('')
    expect(screen.queryByDisplayValue('super-secret')).toBeNull()
  })
})

describe('SOAP Sign — keystore option is ADDITIVE', () => {
  beforeEach(() => {
    useSoapStore.setState({
      wsSecurity: {
        enabled: true,
        modes: ['sign'],
        sign: {
          privateKeyPem: KEY_PEM,
          certPem: CERT_PEM,
          algorithm: 'RSA-SHA256',
          references: ['Body'],
          keyInfoStrategy: 'BinarySecurityToken',
        },
      },
    })
  })

  it('picking a keystore source does NOT wipe the pasted PEM fields', async () => {
    const { container } = render(<SoapSecuritySection />)

    fireEvent.click(screen.getByText('Use from keystore / Security'))
    await selectAlias()

    await waitFor(() => expect(useSoapStore.getState().wsSecurity.sign?.keySource).toBeDefined())
    const sign = useSoapStore.getState().wsSecurity.sign
    expect(sign?.keySource).toEqual({
      kind: 'keystore',
      keystoreId: 'lib-1',
      alias: 'client1',
      keyPassword: 'keypw',
      storePassword: 'storepw',
    })
    // The default path is untouched — both textareas keep their pasted PEM.
    expect(sign?.certPem).toBe(CERT_PEM)
    expect(sign?.privateKeyPem).toBe(KEY_PEM)
    const areas = Array.from(container.querySelectorAll('textarea')) as HTMLTextAreaElement[]
    expect(areas.map((a) => a.value)).toEqual([CERT_PEM, KEY_PEM])
  })

  it('clearing the source restores the byte-for-byte pre-#60 config', async () => {
    render(<SoapSecuritySection />)
    fireEvent.click(screen.getByText('Use from keystore / Security'))
    await selectAlias()
    await waitFor(() => expect(useSoapStore.getState().wsSecurity.sign?.keySource).toBeDefined())

    fireEvent.click(screen.getByText('Use pasted PEM'))

    const sign = useSoapStore.getState().wsSecurity.sign
    expect(Object.keys(sign ?? {})).not.toContain('keySource')
    expect(sign).toEqual({
      privateKeyPem: KEY_PEM,
      certPem: CERT_PEM,
      algorithm: 'RSA-SHA256',
      references: ['Body'],
      keyInfoStrategy: 'BinarySecurityToken',
    })
  })

  it('the DEFAULT path (picker untouched) still produces the old inline config', () => {
    useSoapStore.setState({
      wsSecurity: { enabled: true, modes: ['sign'] },
    })
    render(<SoapSecuritySection />)

    const [certArea, keyArea] = screen.getAllByPlaceholderText(/-----BEGIN/)
    fireEvent.change(certArea, { target: { value: CERT_PEM } })
    fireEvent.change(keyArea, { target: { value: KEY_PEM } })

    expect(useSoapStore.getState().wsSecurity.sign).toEqual({
      privateKeyPem: KEY_PEM,
      certPem: CERT_PEM,
      algorithm: 'RSA-SHA256',
      references: ['Body'],
      keyInfoStrategy: 'BinarySecurityToken',
    })
    expect(libraryOpen).not.toHaveBeenCalled()
  })
})
