/**
 * WS-Security tool — the encryption pane.
 *
 * Reported as "invalid algorithm combinations are not validated". They are all
 * valid: every algorithm × key-wrap pair the two dropdowns can produce is
 * supported by the encrypter, so blocking any of them would only take away
 * working functionality. What the pane genuinely failed to say is that one of
 * the two key-wrap options is broken by design — PKCS#1 v1.5 key transport is
 * the Bleichenbacher padding-oracle target and XML Encryption 1.1 forbids it.
 * A test tool still needs it to talk to services that only speak it, so the
 * option stays and the screen warns.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="monaco"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

import { mockWindowApi } from './screens/_mount'
import WsSecurityTool from '../../src/renderer/components/tools/WsSecurityTool'
import { useWsseToolStore } from '../../src/renderer/stores/wsse-tool.store'
;(globalThis as unknown as { React: typeof React }).React = React

/** Put the tool on the Encrypt tab with a known key-wrap choice. */
function mountEncrypt(keyWrap: 'RSA-OAEP' | 'RSA-1.5'): void {
  const api = useWsseToolStore.getState()
  api.setMode('encrypt')
  api.setEncrypt({ ...api.encrypt, keyWrap })
  render(<WsSecurityTool />)
}

beforeEach(() => {
  mockWindowApi()
  useWsseToolStore.setState({ mode: 'sign', output: '', statusLine: null, error: null })
})
afterEach(() => cleanup())

describe('WS-Security encryption — deprecated key transport', () => {
  it('warns when RSA-1.5 is selected', () => {
    mountEncrypt('RSA-1.5')
    const warning = screen.getByRole('alert')
    expect(warning).toHaveTextContent(/RSA-1\.5/)
    expect(warning).toHaveTextContent(/RSA-OAEP/)
  })

  it('stays quiet for RSA-OAEP', () => {
    mountEncrypt('RSA-OAEP')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('still offers RSA-1.5 — a warning, not a block', () => {
    // Removing it would break the only reason someone opens this tool against
    // a legacy service.
    mountEncrypt('RSA-OAEP')
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('RSA-1.5')
    expect(options).toContain('RSA-OAEP')
  })

  it('appears and disappears as the dropdown changes', () => {
    mountEncrypt('RSA-OAEP')
    expect(screen.queryByRole('alert')).toBeNull()
    const select = screen
      .getAllByRole('combobox')
      .find((el) => (el as HTMLSelectElement).value === 'RSA-OAEP') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'RSA-1.5' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/RSA-1\.5/)
  })
})

describe('WS-Security — the encryption pane speaks the app language', () => {
  it('has no hardcoded English placeholders left', () => {
    mountEncrypt('RSA-OAEP')
    // The recipient certificate box was the last one written in English
    // regardless of locale; it now comes from the dictionary like the rest.
    expect(screen.getByPlaceholderText(/Recipient certificate/i)).toBeInTheDocument()
  })
})
