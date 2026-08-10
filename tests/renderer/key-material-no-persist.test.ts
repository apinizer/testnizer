/**
 * Faz C (#60) — the write-only half of NO-LEAK, pinned at the two renderer
 * persistence boundaries.
 *
 * `KeyMaterialPicker` captures a keystore STORE password (remember-off) and a
 * per-alias KEY password. Both are WRITE-ONLY: they may ride one send payload
 * to main, and must never be written to disk or read back into renderer state.
 * The renderer has exactly two boundaries that could betray that:
 *
 *   1. `localStorage['testnizer-soap']` — the tabbed SOAP persist, and
 *   2. `endpoints.metadata` — via `snapshotProtocol()` on Ctrl+S / "Save As".
 *
 * Both are covered here, together with the counter-assertion that the
 * passwords DO survive in memory (stripping them from the store itself would
 * break Send in the very session the user typed them in) and the additive
 * invariant that a config without a `keySource` is persisted unchanged.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { snapshotProtocol } from '../../src/renderer/lib/save-active-request'
import { stripWsSecuritySecrets } from '../../src/renderer/lib/key-material'
import type { Tab, WsSecurityConfig } from '../../src/renderer/types'

const STORE_PW = 'SUPER-STORE-PW'
const KEY_PW = 'SUPER-KEY-PW'

const signWithKeystore: WsSecurityConfig = {
  enabled: true,
  modes: ['sign'],
  sign: {
    privateKeyPem: '',
    certPem: '',
    algorithm: 'RSA-SHA256',
    references: ['Body'],
    keyInfoStrategy: 'BinarySecurityToken',
    keySource: {
      kind: 'keystore',
      keystoreId: 'lib-1',
      alias: 'client1',
      storePassword: STORE_PW,
      keyPassword: KEY_PW,
    },
  },
}

const PASTED_CERT = '-----BEGIN CERTIFICATE-----\nPASTED\n-----END CERTIFICATE-----'
const PASTED_KEY = '-----BEGIN PRIVATE KEY-----\nPASTED\n-----END PRIVATE KEY-----'

const signWithPastedPem: WsSecurityConfig = {
  enabled: true,
  modes: ['sign'],
  sign: {
    privateKeyPem: PASTED_KEY,
    certPem: PASTED_CERT,
    algorithm: 'RSA-SHA256',
    references: ['Body'],
    keyInfoStrategy: 'BinarySecurityToken',
  },
}

function soapTab(): Tab {
  return { id: 'tab-1', name: 'SOAP', protocol: 'soap', isDirty: false, isLoading: false }
}

function rawPersisted(): string {
  return window.localStorage.getItem('testnizer-soap') ?? ''
}

describe('#60 write-only key material never reaches a persistence boundary', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useSoapStore.setState({ _currentTabId: 'tab-1', _tabStates: new Map() })
  })

  it('keeps the store/key passwords OUT of localStorage', () => {
    useSoapStore.getState().setWsSecurity(signWithKeystore)

    const raw = rawPersisted()
    expect(raw).not.toContain(STORE_PW)
    expect(raw).not.toContain(KEY_PW)
    expect(raw).not.toContain('storePassword')
    expect(raw).not.toContain('keyPassword')
    // The opaque half of the source still persists — reopening the tab must
    // still show WHICH alias was chosen, just not its passwords.
    expect(raw).toContain('lib-1')
    expect(raw).toContain('client1')
  })

  it('still keeps them in memory, so Send works in the session they were typed in', () => {
    useSoapStore.getState().setWsSecurity(signWithKeystore)

    const live = useSoapStore.getState().wsSecurity.sign?.keySource
    expect(live).toMatchObject({ storePassword: STORE_PW, keyPassword: KEY_PW })
  })

  it('keeps them in memory across a tab switch (the cache is sanitised only on the way out)', () => {
    useSoapStore.getState().setWsSecurity(signWithKeystore)
    useSoapStore.getState().switchToTab('tab-2')
    useSoapStore.getState().switchToTab('tab-1')

    expect(useSoapStore.getState().wsSecurity.sign?.keySource).toMatchObject({
      storePassword: STORE_PW,
      keyPassword: KEY_PW,
    })
    // ...while the cached tab states written to disk stay clean.
    const raw = rawPersisted()
    expect(raw).not.toContain(STORE_PW)
    expect(raw).not.toContain(KEY_PW)
  })

  it('keeps them out of the endpoints.metadata snapshot (Ctrl+S / Save As)', () => {
    useSoapStore.getState().setWsSecurity(signWithKeystore)
    useTabsStore.setState({ tabs: [soapTab()], activeTabId: 'tab-1' })

    const snap = snapshotProtocol(soapTab())
    const serialised = JSON.stringify(snap.protocolMeta)

    expect(serialised).not.toContain(STORE_PW)
    expect(serialised).not.toContain(KEY_PW)
    const soapMeta = snap.protocolMeta.soap as { wsSecurity: WsSecurityConfig }
    expect(soapMeta.wsSecurity.sign?.keySource).toEqual({
      kind: 'keystore',
      keystoreId: 'lib-1',
      alias: 'client1',
    })
  })

  it('ADDITIVE: a pasted-PEM config is persisted byte-for-byte, same object identity', () => {
    // Nothing to strip ⇒ the very same object flows through, so no pre-#60
    // config can be altered by the sanitiser.
    expect(stripWsSecuritySecrets(signWithPastedPem)).toBe(signWithPastedPem)

    useSoapStore.getState().setWsSecurity(signWithPastedPem)
    useTabsStore.setState({ tabs: [soapTab()], activeTabId: 'tab-1' })

    const raw = rawPersisted()
    expect(raw).toContain('PASTED')
    const soapMeta = snapshotProtocol(soapTab()).protocolMeta.soap as {
      wsSecurity: WsSecurityConfig
    }
    expect(soapMeta.wsSecurity.sign?.privateKeyPem).toBe(PASTED_KEY)
    expect(soapMeta.wsSecurity.sign?.certPem).toBe(PASTED_CERT)
    expect(soapMeta.wsSecurity.sign).not.toHaveProperty('keySource')
  })
})
