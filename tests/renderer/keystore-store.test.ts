/**
 * Keystore Studio renderer store (Faz B1). Verifies the sessionId state model:
 * the store holds a sessionId + safe public meta and NEVER retains key material,
 * store passwords, or keystore bytes. Passwords are forwarded to the IPC layer
 * only. Library (Model B) is metadata-only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useKeystoreStore } from '../../src/renderer/stores/keystore.store'
import type { KeystoreMeta, KeystoreAliasDetail } from '../../src/renderer/types'

const META: KeystoreMeta = {
  type: 'PKCS12',
  aliasCount: 1,
  aliases: [
    {
      alias: 'test-client',
      entryType: 'KEY',
      hasPrivateKey: true,
      subjectDN: 'CN=test-client, O=Testnizer Tests',
      issuerDN: 'CN=Testnizer Test CA',
      notBefore: '2024-01-01T00:00:00.000Z',
      notAfter: '2999-01-01T00:00:00.000Z',
      keyAlgorithm: 'RSA',
      chainLength: 2,
    },
  ],
}

const DETAIL: KeystoreAliasDetail = {
  alias: 'test-client',
  entryType: 'KEY',
  hasPrivateKey: true,
  chain: [
    {
      subjectDN: 'CN=test-client, O=Testnizer Tests',
      issuerDN: 'CN=Testnizer Test CA',
      serialNumber: '1440ae30e9d843a5fb3f994c81f8defa697bfcea',
      version: 3,
      sigAlgName: 'SHA256withRSA',
      notBefore: '2024-01-01T00:00:00.000Z',
      notAfter: '2999-01-01T00:00:00.000Z',
      publicKeyAlgorithm: 'RSA',
      keySize: 2048,
      sha1Fingerprint: 'B5:5E:66:78',
      sha256Fingerprint: 'EE:4E:BA:BD',
      subjectAlternativeNames: [],
      pem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    },
  ],
}

interface Mocks {
  pickFile: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  createNew: ReturnType<typeof vi.fn>
  aliasDetail: ReturnType<typeof vi.fn>
  generateKeyPair: ReturnType<typeof vi.fn>
  generateSecretKey: ReturnType<typeof vi.fn>
  importPkcs12: ReturnType<typeof vi.fn>
  importKeyMaterial: ReturnType<typeof vi.fn>
  importPem: ReturnType<typeof vi.fn>
  importTrustedCert: ReturnType<typeof vi.fn>
  closeSession: ReturnType<typeof vi.fn>
  librarySave: ReturnType<typeof vi.fn>
  libraryList: ReturnType<typeof vi.fn>
  libraryOpen: ReturnType<typeof vi.fn>
  libraryDelete: ReturnType<typeof vi.fn>
}

// A generated key-pair grows the alias set; the response carries the SAME
// sessionId (generate mutates the current session) plus refreshed public meta.
const META_AFTER_GEN: KeystoreMeta = {
  type: 'PKCS12',
  aliasCount: 2,
  aliases: [
    ...META.aliases,
    {
      alias: 'srv',
      entryType: 'KEY',
      hasPrivateKey: true,
      subjectDN: 'CN=srv',
      issuerDN: 'CN=srv',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2027-01-01T00:00:00.000Z',
      keyAlgorithm: 'RSA',
      chainLength: 1,
    },
  ],
}

const META_AFTER_SECRET: KeystoreMeta = {
  type: 'PKCS12',
  aliasCount: 2,
  aliases: [
    ...META.aliases,
    { alias: 'aes', entryType: 'KEY', hasPrivateKey: false, chainLength: 0 },
  ],
}

// An imported entry grows the alias set; the response carries the SAME sessionId
// (import mutates the current session) plus refreshed public meta.
const META_AFTER_IMPORT: KeystoreMeta = {
  type: 'PKCS12',
  aliasCount: 2,
  aliases: [
    ...META.aliases,
    {
      alias: 'imported',
      entryType: 'KEY',
      hasPrivateKey: true,
      subjectDN: 'CN=imported',
      issuerDN: 'CN=imported',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2027-01-01T00:00:00.000Z',
      keyAlgorithm: 'RSA',
      chainLength: 1,
    },
  ],
}

const META_AFTER_TRUSTED: KeystoreMeta = {
  type: 'PKCS12',
  aliasCount: 2,
  aliases: [
    ...META.aliases,
    {
      alias: 'ca-trust',
      entryType: 'CERTIFICATE',
      hasPrivateKey: false,
      subjectDN: 'CN=Test CA',
      issuerDN: 'CN=Test CA',
      chainLength: 1,
    },
  ],
}

const LIB_ROW = {
  id: 'lib1',
  name: 'My keystore',
  type: 'PKCS12' as const,
  alias_count: 1,
  size_bytes: 2048,
  created_at: 1,
  updated_at: 1,
  remembered: false,
}

function installApi(overrides: Partial<Mocks> = {}): Mocks {
  const mocks: Mocks = {
    pickFile: vi.fn(async () => ({
      success: true,
      data: { path: '/tmp/client.p12', fileName: 'client.p12', type: 'PKCS12' },
    })),
    open: vi.fn(async () => ({ success: true, data: { sessionId: 'sess-1', meta: META } })),
    createNew: vi.fn(async () => ({
      success: true,
      data: { sessionId: 'sess-new', meta: { type: 'JKS', aliasCount: 0, aliases: [] } },
    })),
    aliasDetail: vi.fn(async () => ({ success: true, data: DETAIL })),
    generateKeyPair: vi.fn(async () => ({
      success: true,
      data: { sessionId: 'sess-1', meta: META_AFTER_GEN },
    })),
    generateSecretKey: vi.fn(async () => ({
      success: true,
      data: { sessionId: 'sess-1', meta: META_AFTER_SECRET },
    })),
    importPkcs12: vi.fn(async () => ({
      success: true,
      data: { sessionId: 'sess-1', meta: META_AFTER_IMPORT },
    })),
    importKeyMaterial: vi.fn(async () => ({
      success: true,
      data: { sessionId: 'sess-1', meta: META_AFTER_IMPORT },
    })),
    importPem: vi.fn(async () => ({
      success: true,
      data: { sessionId: 'sess-1', meta: META_AFTER_IMPORT },
    })),
    importTrustedCert: vi.fn(async () => ({
      success: true,
      data: { sessionId: 'sess-1', meta: META_AFTER_TRUSTED },
    })),
    closeSession: vi.fn(async () => ({ success: true, data: { closed: true } })),
    librarySave: vi.fn(async () => ({ success: true, data: LIB_ROW })),
    libraryList: vi.fn(async () => ({ success: true, data: [LIB_ROW] })),
    libraryOpen: vi.fn(async () => ({
      success: true,
      data: { sessionId: 'sess-lib', meta: META },
    })),
    libraryDelete: vi.fn(async () => ({ success: true, data: { deleted: true } })),
    ...overrides,
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window = { api: { keystore: mocks } }
  return mocks
}

function reset(): void {
  useKeystoreStore.setState({
    sessionId: null,
    meta: null,
    fileName: null,
    libraryId: null,
    library: [],
    selectedAlias: null,
    aliasDetail: null,
    loading: false,
    error: null,
  })
}

describe('keystore.store', () => {
  beforeEach(reset)

  it('opens a picked file: stores sessionId + safe meta, forwards password/type', async () => {
    const m = installApi()
    const ok = await useKeystoreStore
      .getState()
      .openFile({
        path: '/tmp/client.p12',
        fileName: 'client.p12',
        password: 'topsecret',
        type: 'PKCS12',
      })
    expect(ok).toBe(true)
    expect(m.open).toHaveBeenCalledWith({
      path: '/tmp/client.p12',
      password: 'topsecret',
      type: 'PKCS12',
    })
    const st = useKeystoreStore.getState()
    expect(st.sessionId).toBe('sess-1')
    expect(st.fileName).toBe('client.p12')
    expect(st.meta?.aliases[0].alias).toBe('test-client')
  })

  it('never retains the store password or any key material in state', async () => {
    installApi()
    await useKeystoreStore
      .getState()
      .openFile({
        path: '/tmp/client.p12',
        fileName: 'client.p12',
        password: 'topsecret',
        type: 'PKCS12',
      })
    await useKeystoreStore.getState().loadAliasDetail('test-client')
    // Serialize the full store state; no secret / private material may appear.
    const {
      pickFile,
      openFile,
      createNew,
      generateKeyPair,
      generateSecretKey,
      openFromLibrary,
      saveToLibrary,
      deleteFromLibrary,
      closeSession,
      loadLibrary,
      loadAliasDetail,
      clearAliasDetail,
      clearError,
      ...data
    } = useKeystoreStore.getState()
    void pickFile
    void openFile
    void createNew
    void openFromLibrary
    void saveToLibrary
    void deleteFromLibrary
    void closeSession
    void loadLibrary
    void loadAliasDetail
    void clearAliasDetail
    void clearError
    void generateKeyPair
    void generateSecretKey
    const json = JSON.stringify(data)
    expect(json).not.toContain('topsecret')
    expect(json).not.toContain('PRIVATE KEY')
    expect(json).not.toMatch(/bytes|blob|passphrase|storePassword/i)
  })

  it('pickFile treats a Cancelled dialog as a no-op (no error surfaced)', async () => {
    installApi({ pickFile: vi.fn(async () => ({ success: false, error: 'Cancelled' })) })
    const result = await useKeystoreStore.getState().pickFile()
    expect(result).toBeNull()
    expect(useKeystoreStore.getState().error).toBeNull()
  })

  it('createNew opens an empty session', async () => {
    const m = installApi()
    const ok = await useKeystoreStore.getState().createNew({ type: 'JKS', password: '' })
    expect(ok).toBe(true)
    expect(m.createNew).toHaveBeenCalledWith({ type: 'JKS', password: '' })
    expect(useKeystoreStore.getState().meta?.aliasCount).toBe(0)
  })

  it('generateKeyPair injects the current sessionId, forwards opts, refreshes meta', async () => {
    const m = installApi()
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META })
    const ok = await useKeystoreStore.getState().generateKeyPair({
      alias: 'srv',
      keyAlgorithm: 'RSA',
      keySize: 2048,
      basicConstraintsCa: false,
      entryPassword: 'entrypw',
    })
    expect(ok).toBe(true)
    // entryPassword is DROPPED by the store: Faz B2 protects generated entries
    // with the store password (a per-entry password has no parse-side decrypt
    // yet → silent data loss on reopen). Per-entry passwords land in Faz B4.
    // The IPC payload must therefore NOT carry entryPassword.
    expect(m.generateKeyPair).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      alias: 'srv',
      keyAlgorithm: 'RSA',
      keySize: 2048,
      basicConstraintsCa: false,
    })
    expect(m.generateKeyPair.mock.calls[0][0]).not.toHaveProperty('entryPassword')
    // Meta refreshed so the new alias shows up in AliasTable; session unchanged.
    const st = useKeystoreStore.getState()
    expect(st.sessionId).toBe('sess-1')
    expect(st.meta?.aliasCount).toBe(2)
    expect(st.meta?.aliases.some((a) => a.alias === 'srv')).toBe(true)
  })

  it('generateKeyPair no-ops (soft fail) when there is no open session', async () => {
    const m = installApi()
    // no sessionId set
    const ok = await useKeystoreStore.getState().generateKeyPair({ alias: 'srv' })
    expect(ok).toBe(false)
    expect(m.generateKeyPair).not.toHaveBeenCalled()
  })

  it('generateKeyPair never lets entryPassword or key material into state', async () => {
    installApi()
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META })
    await useKeystoreStore
      .getState()
      .generateKeyPair({ alias: 'srv', keyAlgorithm: 'RSA', entryPassword: 'topsecret-entry' })
    const {
      pickFile,
      openFile,
      createNew,
      generateKeyPair,
      generateSecretKey,
      openFromLibrary,
      saveToLibrary,
      deleteFromLibrary,
      closeSession,
      loadLibrary,
      loadAliasDetail,
      clearAliasDetail,
      clearError,
      ...data
    } = useKeystoreStore.getState()
    void pickFile
    void openFile
    void createNew
    void openFromLibrary
    void saveToLibrary
    void deleteFromLibrary
    void closeSession
    void loadLibrary
    void loadAliasDetail
    void clearAliasDetail
    void clearError
    void generateKeyPair
    void generateSecretKey
    const json = JSON.stringify(data)
    expect(json).not.toContain('topsecret-entry')
    expect(json).not.toContain('PRIVATE KEY')
  })

  it('generateSecretKey injects sessionId, forwards AES opts, refreshes meta', async () => {
    const m = installApi()
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META })
    const ok = await useKeystoreStore
      .getState()
      .generateSecretKey({ alias: 'aes', keyAlgorithm: 'AES', keySize: 256, entryPassword: 'x' })
    expect(ok).toBe(true)
    // entryPassword DROPPED (see generateKeyPair) — Faz B2 protects the secret
    // entry with the store password; per-entry passwords land in Faz B4.
    expect(m.generateSecretKey).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      alias: 'aes',
      keyAlgorithm: 'AES',
      keySize: 256,
    })
    expect(m.generateSecretKey.mock.calls[0][0]).not.toHaveProperty('entryPassword')
    const st = useKeystoreStore.getState()
    expect(st.meta?.aliasCount).toBe(2)
    expect(st.meta?.aliases.some((a) => a.alias === 'aes' && a.hasPrivateKey === false)).toBe(true)
  })

  it('generateSecretKey surfaces the PKCS12-only engine error on a JKS session', async () => {
    // The UI gates the menu item, but the store must still surface the engine
    // guard verbatim (§8) if a JKS session ever reaches here.
    installApi({
      generateSecretKey: vi.fn(async () => ({
        success: false,
        error: 'Secret keys can only be stored in a PKCS12 keystore',
      })),
    })
    useKeystoreStore.setState({
      sessionId: 'sess-jks',
      meta: { type: 'JKS', aliasCount: 0, aliases: [] },
    })
    const ok = await useKeystoreStore.getState().generateSecretKey({ alias: 'skjks', keySize: 256 })
    expect(ok).toBe(false)
    expect(useKeystoreStore.getState().error).toContain('PKCS12')
  })

  it('importPkcs12 injects the current sessionId, forwards source fields, refreshes meta', async () => {
    const m = installApi()
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META })
    const ok = await useKeystoreStore.getState().importPkcs12({
      sourcePath: '/tmp/source.p12',
      sourcePassword: 'srcpw',
      sourceAlias: 'test-client',
      alias: 'imported',
    })
    expect(ok).toBe(true)
    expect(m.importPkcs12).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      sourcePath: '/tmp/source.p12',
      sourcePassword: 'srcpw',
      sourceAlias: 'test-client',
      alias: 'imported',
    })
    const st = useKeystoreStore.getState()
    expect(st.sessionId).toBe('sess-1')
    expect(st.meta?.aliasCount).toBe(2)
    expect(st.meta?.aliases.some((a) => a.alias === 'imported')).toBe(true)
  })

  it('importPkcs12 no-ops (soft fail) when there is no open session', async () => {
    const m = installApi()
    const ok = await useKeystoreStore.getState().importPkcs12({ sourcePath: '/tmp/source.p12' })
    expect(ok).toBe(false)
    expect(m.importPkcs12).not.toHaveBeenCalled()
    // FIX 7: the missing-session branch surfaces an error (not a silent false).
    expect(useKeystoreStore.getState().error).toBeTruthy()
  })

  it('importKeyMaterial forwards the key + cert PEM and refreshes meta', async () => {
    const m = installApi()
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META })
    const ok = await useKeystoreStore.getState().importKeyMaterial({
      alias: 'imported',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----',
      certificatePem: '-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----',
    })
    expect(ok).toBe(true)
    expect(m.importKeyMaterial).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      alias: 'imported',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----',
      certificatePem: '-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----',
    })
    expect(useKeystoreStore.getState().meta?.aliasCount).toBe(2)
  })

  it('importKeyMaterial surfaces the key-cert mismatch engine error (§8) verbatim', async () => {
    installApi({
      importKeyMaterial: vi.fn(async () => ({
        success: false,
        error: 'Private key does not match the provided certificate',
      })),
    })
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META })
    const ok = await useKeystoreStore
      .getState()
      .importKeyMaterial({ alias: 'bad', privateKeyPem: 'x', certificatePem: 'y' })
    expect(ok).toBe(false)
    expect(useKeystoreStore.getState().error).toBe(
      'Private key does not match the provided certificate',
    )
    // A rejected pair must NOT mutate the alias set.
    expect(useKeystoreStore.getState().meta?.aliasCount).toBe(1)
  })

  it('importPem forwards the pasted PEM blob and refreshes meta', async () => {
    const m = installApi()
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META })
    const ok = await useKeystoreStore
      .getState()
      .importPem({ alias: 'imported', pemContent: '-----BEGIN CERTIFICATE-----\nCCC\n-----END CERTIFICATE-----' })
    expect(ok).toBe(true)
    expect(m.importPem).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      alias: 'imported',
      pemContent: '-----BEGIN CERTIFICATE-----\nCCC\n-----END CERTIFICATE-----',
    })
    expect(useKeystoreStore.getState().meta?.aliasCount).toBe(2)
  })

  it('importTrustedCert forwards the certificate content and refreshes meta', async () => {
    const m = installApi()
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META })
    const ok = await useKeystoreStore
      .getState()
      .importTrustedCert({ alias: 'ca-trust', certificateContent: 'MIIB...base64der' })
    expect(ok).toBe(true)
    expect(m.importTrustedCert).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      alias: 'ca-trust',
      certificateContent: 'MIIB...base64der',
    })
    const st = useKeystoreStore.getState()
    expect(st.meta?.aliases.some((a) => a.alias === 'ca-trust' && a.hasPrivateKey === false)).toBe(
      true,
    )
  })

  it('import actions never let source passwords or key material into state', async () => {
    installApi()
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META })
    await useKeystoreStore
      .getState()
      .importPkcs12({ sourcePath: '/tmp/s.p12', sourcePassword: 'srcsecret' })
    await useKeystoreStore.getState().importKeyMaterial({
      alias: 'k',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nSECRETKEY\n-----END PRIVATE KEY-----',
      certificatePem: '-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----',
    })
    const {
      pickFile,
      openFile,
      createNew,
      generateKeyPair,
      generateSecretKey,
      importPkcs12,
      importKeyMaterial,
      importPem,
      importTrustedCert,
      openFromLibrary,
      saveToLibrary,
      deleteFromLibrary,
      closeSession,
      loadLibrary,
      loadAliasDetail,
      clearAliasDetail,
      clearError,
      ...data
    } = useKeystoreStore.getState()
    void pickFile
    void openFile
    void createNew
    void generateKeyPair
    void generateSecretKey
    void importPkcs12
    void importKeyMaterial
    void importPem
    void importTrustedCert
    void openFromLibrary
    void saveToLibrary
    void deleteFromLibrary
    void closeSession
    void loadLibrary
    void loadAliasDetail
    void clearAliasDetail
    void clearError
    const json = JSON.stringify(data)
    expect(json).not.toContain('srcsecret')
    expect(json).not.toContain('SECRETKEY')
    expect(json).not.toContain('PRIVATE KEY')
  })

  it('openFromLibrary forwards the re-entered password (remember=OFF default)', async () => {
    const m = installApi()
    const ok = await useKeystoreStore
      .getState()
      .openFromLibrary({ id: 'lib1', name: 'My keystore', password: 'reentered' })
    expect(ok).toBe(true)
    expect(m.libraryOpen).toHaveBeenCalledWith({ id: 'lib1', password: 'reentered' })
    expect(useKeystoreStore.getState().libraryId).toBe('lib1')
  })

  it('non-remembered entry: opening WITHOUT a password fails, WITH the prompt password succeeds', async () => {
    // Mirror the main handler: a NULL store_password requires the caller to
    // supply the password (empty ⇒ parse failure). This exercises the prompt
    // path that KeystoreTool drives for a non-remembered library entry.
    const m = installApi({
      libraryOpen: vi.fn(async (p: { id: string; password?: string }) =>
        p.password
          ? { success: true, data: { sessionId: 'sess-lib', meta: META } }
          : { success: false, error: 'Password is wrong or the file is corrupt.' },
      ),
    })

    // No password (the dead-code case before the fix) ⇒ open fails, stays empty.
    const noPw = await useKeystoreStore
      .getState()
      .openFromLibrary({ id: 'lib1', name: 'My keystore' })
    expect(noPw).toBe(false)
    expect(m.libraryOpen).toHaveBeenCalledWith({ id: 'lib1', password: undefined })
    expect(useKeystoreStore.getState().sessionId).toBeNull()

    // Entered password via the prompt ⇒ open succeeds.
    const withPw = await useKeystoreStore
      .getState()
      .openFromLibrary({ id: 'lib1', name: 'My keystore', password: 'reentered' })
    expect(withPw).toBe(true)
    expect(m.libraryOpen).toHaveBeenCalledWith({ id: 'lib1', password: 'reentered' })
    expect(useKeystoreStore.getState().sessionId).toBe('sess-lib')
    expect(useKeystoreStore.getState().libraryId).toBe('lib1')
  })

  it('saveToLibrary defaults rememberPassword OFF and reloads the library', async () => {
    const m = installApi()
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META })
    const ok = await useKeystoreStore.getState().saveToLibrary({ name: 'My keystore' })
    expect(ok).toBe(true)
    expect(m.librarySave).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      name: 'My keystore',
      rememberPassword: undefined,
      id: undefined,
    })
    expect(m.libraryList).toHaveBeenCalled()
    expect(useKeystoreStore.getState().library).toHaveLength(1)
  })

  it('deleteFromLibrary removes the row from state', async () => {
    installApi()
    useKeystoreStore.setState({ library: [LIB_ROW] })
    await useKeystoreStore.getState().deleteFromLibrary('lib1')
    expect(useKeystoreStore.getState().library).toHaveLength(0)
  })

  it('loadAliasDetail loads the public certificate chain', async () => {
    const m = installApi()
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META })
    const detail = await useKeystoreStore.getState().loadAliasDetail('test-client')
    expect(m.aliasDetail).toHaveBeenCalledWith({ sessionId: 'sess-1', alias: 'test-client' })
    expect(detail?.chain[0].serialNumber).toBe('1440ae30e9d843a5fb3f994c81f8defa697bfcea')
    expect(useKeystoreStore.getState().selectedAlias).toBe('test-client')
  })

  it('closeSession disposes the main session and resets to empty state', async () => {
    const m = installApi()
    useKeystoreStore.setState({ sessionId: 'sess-1', meta: META, fileName: 'client.p12' })
    await useKeystoreStore.getState().closeSession()
    expect(m.closeSession).toHaveBeenCalledWith('sess-1')
    const st = useKeystoreStore.getState()
    expect(st.sessionId).toBeNull()
    expect(st.meta).toBeNull()
    expect(st.fileName).toBeNull()
  })

  it('degrades gracefully when the preload bridge is missing (no hard crash)', async () => {
    // Dev HMR reload: the renderer refreshed but the running app still has an
    // older preload, so window.api.keystore is undefined. Actions must no-op /
    // fail softly instead of throwing "Cannot read properties of undefined".
    ;(globalThis as unknown as { window: { api: unknown } }).window = { api: {} }
    useKeystoreStore.setState({ library: [LIB_ROW] })

    // loadLibrary: silent no-op → empties the list, surfaces no error, no throw.
    await useKeystoreStore.getState().loadLibrary()
    expect(useKeystoreStore.getState().library).toEqual([])
    expect(useKeystoreStore.getState().error).toBeNull()

    // Action paths degrade to a soft failure rather than crashing.
    const opened = await useKeystoreStore
      .getState()
      .openFile({ path: '/x', fileName: 'x.p12', password: '' })
    expect(opened).toBe(false)
    const picked = await useKeystoreStore.getState().pickFile()
    expect(picked).toBeNull()
    expect(useKeystoreStore.getState().sessionId).toBeNull()
  })

  it('surfaces an engine error (wrong password / corrupt) without throwing', async () => {
    installApi({
      open: vi.fn(async () => ({
        success: false,
        error: 'Password is wrong or the file is corrupt.',
      })),
    })
    const ok = await useKeystoreStore
      .getState()
      .openFile({ path: '/tmp/bad.p12', fileName: 'bad.p12', password: 'x' })
    expect(ok).toBe(false)
    expect(useKeystoreStore.getState().error).toContain('corrupt')
    expect(useKeystoreStore.getState().sessionId).toBeNull()
  })
})
