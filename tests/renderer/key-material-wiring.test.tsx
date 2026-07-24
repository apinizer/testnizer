/**
 * Faz C renderer wiring (#60) — the "Use from keystore / Security" option on the
 * two remaining surfaces, each pinned as ADDITIVE:
 *
 *  - standalone WS-Security tool, Sign tab (`wsse-tool.store`) — the pasted
 *    Certificate/Private Key PEM textareas stay the default path and the config
 *    sent to `wsse:apply` is byte-for-byte the pre-#60 shape until a source is
 *    picked;
 *  - mTLS Client Certificate screen (`CertificatesPane`) — the CRT/KEY/PFX file
 *    pickers are untouched, 'file' stays the default selection, and picking a
 *    keystore alias persists source/keystore_id/keystore_alias on the row.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
;(globalThis as unknown as { React: typeof React }).React = React

// Monaco does heavy DOM work that adds nothing to these checks.
vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import WsSecurityTool from '../../src/renderer/components/tools/WsSecurityTool'
import { useWsseToolStore } from '../../src/renderer/stores/wsse-tool.store'
import {
  CertificatesPane,
  type ProjectSettings,
} from '../../src/renderer/components/modals/project-settings-panes'
import { defaultSignConfig } from '../../src/renderer/lib/tools/wsse'

const CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIPASTED\n-----END CERTIFICATE-----'
const KEY_PEM = '-----BEGIN PRIVATE KEY-----\nMIIPASTEDKEY\n-----END PRIVATE KEY-----'

const LIB = {
  id: 'lib-1',
  name: 'Prod Keystore',
  type: 'PKCS12',
  alias_count: 1,
  size_bytes: 2048,
  created_at: 1,
  updated_at: 1,
  remembered: true, // remembered → no store-password prompt
}

const CLIENT_ROW = {
  id: 'cert-1',
  project_id: 'p-1',
  kind: 'client' as const,
  host: 'api.example.com',
  crt_path: '/certs/client.crt',
  key_path: '/certs/client.key',
  pfx_path: null,
  passphrase: null,
  enabled: 1,
  created_at: 1,
  source: 'file' as const,
  keystore_id: null,
  keystore_alias: null,
}

const wsseApply = vi.fn(async () => ({ success: true, data: '<signed/>' }))
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
const certificateList = vi.fn(async () => ({ success: true, data: [CLIENT_ROW] }))
const certificateUpdate = vi.fn(async () => ({ success: true, data: CLIENT_ROW }))
const certificatePickFile = vi.fn(async () => ({ success: false, error: 'Cancelled' }))

function installBridge(): void {
  const g = globalThis as unknown as { window: { api: Record<string, unknown> } }
  if (!g.window) g.window = { api: {} }
  g.window.api = {
    ...(g.window.api ?? {}),
    wsse: { apply: wsseApply, verify: vi.fn(), decrypt: vi.fn() },
    keystore: { libraryList, libraryOpen, aliasDetail, closeSession },
    certificate: {
      list: certificateList,
      update: certificateUpdate,
      add: vi.fn(),
      delete: vi.fn(),
      pickFile: certificatePickFile,
    },
  }
}

const SETTINGS = {
  auth: { type: 'none' },
  preScript: '',
  testScript: '',
  requestTimeout: 30000,
  maxResponseSizeMb: 50,
  trimRequest: true,
  autoSave: true,
  alwaysOpenNewTab: false,
  askOnClose: true,
  sendNoCache: false,
  sendPostmanToken: false,
  retainHeaders: false,
  sslVerification: true,
  followRedirects: true,
  workingDirectory: '',
  proxy: { mode: 'system' },
  autoCheckUpdates: true,
  autoDownloadUpdates: false,
} as ProjectSettings

/** keystore → alias → confirm (the store password is remembered here). */
async function selectAlias(): Promise<void> {
  fireEvent.click(await screen.findByText('Prod Keystore'))
  fireEvent.click(await screen.findByText('client1'))
  fireEvent.click(screen.getByText('Use this key'))
}

beforeEach(() => {
  vi.clearAllMocks()
  installBridge()
  useWsseToolStore.setState({ mode: 'sign', sign: defaultSignConfig(), input: '<x/>' })
})

afterEach(() => cleanup())

describe('WS-Security tool Sign tab — pasted PEM stays the default', () => {
  it('sends the byte-for-byte pre-#60 inline config when the picker is untouched', async () => {
    const { container } = render(<WsSecurityTool />)
    const areas = Array.from(container.querySelectorAll('textarea')) as HTMLTextAreaElement[]
    fireEvent.change(areas[0], { target: { value: CERT_PEM } })
    fireEvent.change(areas[1], { target: { value: KEY_PEM } })

    const runBtn = screen
      .getAllByRole('button', { name: 'Sign' })
      .find((b) => b.className.includes('px-3'))
    fireEvent.click(runBtn as HTMLElement)

    await waitFor(() => expect(wsseApply).toHaveBeenCalledTimes(1))
    const payload = wsseApply.mock.calls[0][0] as { config: { sign: Record<string, unknown> } }
    expect(payload.config.sign).toEqual({
      privateKeyPem: KEY_PEM,
      certPem: CERT_PEM,
      algorithm: 'RSA-SHA256',
      references: ['Body'],
      keyInfoStrategy: 'BinarySecurityToken',
    })
    expect(Object.keys(payload.config.sign)).not.toContain('keySource')
    expect(libraryList).not.toHaveBeenCalled()
  })

  it('adds keySource without touching the pasted PEM textareas', async () => {
    const { container } = render(<WsSecurityTool />)
    const areas = Array.from(container.querySelectorAll('textarea')) as HTMLTextAreaElement[]
    fireEvent.change(areas[0], { target: { value: CERT_PEM } })
    fireEvent.change(areas[1], { target: { value: KEY_PEM } })

    fireEvent.click(screen.getByText('Use from keystore / Security'))
    await selectAlias()

    await waitFor(() => expect(useWsseToolStore.getState().sign.keySource).toBeDefined())
    const sign = useWsseToolStore.getState().sign
    expect(sign.keySource).toEqual({ kind: 'keystore', keystoreId: 'lib-1', alias: 'client1' })
    expect(sign.certPem).toBe(CERT_PEM)
    expect(sign.privateKeyPem).toBe(KEY_PEM)
    const after = Array.from(container.querySelectorAll('textarea')) as HTMLTextAreaElement[]
    expect(after.map((a) => a.value)).toEqual([CERT_PEM, KEY_PEM])
  })
})

describe('mTLS Client Certificate screen — keystore is an ADDED choice', () => {
  it('keeps the CRT/KEY/PFX pickers and defaults the source to file', async () => {
    render(<CertificatesPane projectId="p-1" settings={SETTINGS} onChange={vi.fn()} />)

    // The existing file pickers are untouched and still show their paths.
    expect(await screen.findByText('/certs/client.crt')).toBeInTheDocument()
    expect(screen.getByText('/certs/client.key')).toBeInTheDocument()
    expect(screen.getByText('PFX file')).toBeInTheDocument()
    // Default selection is 'file' → the keystore picker is not shown.
    expect(screen.queryByText('Use from keystore / Security')).toBeNull()
    expect(certificateUpdate).not.toHaveBeenCalled()
  })

  it('writes NOTHING on the source pill alone — the row is never left half-linked', async () => {
    render(<CertificatesPane projectId="p-1" settings={SETTINGS} onChange={vi.fn()} />)

    fireEvent.click(await screen.findByText('Keystore / Security')) // the source pill

    // The picker is revealed…
    expect(await screen.findByText('Use from keystore / Security')).toBeInTheDocument()
    // …but the row still says source='file'. Persisting 'keystore' here would
    // make every Send AND every Runner iteration fail loud until an alias is
    // chosen (there is no alias yet to resolve).
    await waitFor(() => expect(libraryList).not.toHaveBeenCalled())
    expect(certificateUpdate).not.toHaveBeenCalled()
  })

  it('persists source + keystore_id + keystore_alias in ONE update when an alias is picked', async () => {
    render(<CertificatesPane projectId="p-1" settings={SETTINGS} onChange={vi.fn()} />)

    fireEvent.click(await screen.findByText('Keystore / Security'))
    fireEvent.click(await screen.findByText('Use from keystore / Security'))
    await selectAlias()

    await waitFor(() =>
      expect(certificateUpdate).toHaveBeenCalledWith({
        id: 'cert-1',
        source: 'keystore',
        keystoreId: 'lib-1',
        keystoreAlias: 'client1',
      }),
    )
    // ONE atomic write — the source and the link it needs land together.
    expect(certificateUpdate).toHaveBeenCalledTimes(1)
    // Still no key bytes anywhere in the renderer payloads.
    expect(JSON.stringify(certificateUpdate.mock.calls)).not.toContain('BEGIN')
  })

  it('R11: an entry password goes to its OWN column, never onto the PFX passphrase', async () => {
    render(<CertificatesPane projectId="p-1" settings={SETTINGS} onChange={vi.fn()} />)

    fireEvent.click(await screen.findByText('Keystore / Security'))
    fireEvent.click(await screen.findByText('Use from keystore / Security'))
    fireEvent.click(await screen.findByText('Prod Keystore'))
    fireEvent.click(await screen.findByText('client1'))
    fireEvent.change(screen.getByLabelText('Key (entry) password'), {
      target: { value: 'entry-pw' },
    })
    fireEvent.click(screen.getByText('Use this key'))

    await waitFor(() => expect(certificateUpdate).toHaveBeenCalled())
    const patch = certificateUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(patch.keystoreKeyPassword).toBe('entry-pw')
    expect(patch).not.toHaveProperty('passphrase')
  })
})
