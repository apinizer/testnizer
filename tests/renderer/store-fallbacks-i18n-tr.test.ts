/**
 * Turkish UI sweep — the stores' own fallback texts follow the UI language.
 *
 * About 60 store messages were English literals (`res.error || 'Failed to …'`,
 * `errorMessage: 'URL is required'`, "Mock MCP bridge unavailable" …) and
 * reached the screen as-is in a Turkish UI. They now go through `t()`, read
 * when the failure happens (never a module-scope constant, which would freeze
 * the import-time locale). English stays byte-identical.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useBranchStore } from '../../src/renderer/stores/branch.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useAuthStore } from '../../src/renderer/stores/auth.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'

const setLang = (l: 'en' | 'tr'): void => {
  useUIStore.setState({ locale: l })
  setLocale(l)
}

afterEach(() => {
  setLang('en')
  ;(window as unknown as { api: unknown }).api = undefined
})

describe('store fallbacks in Turkish', () => {
  it('gRPC: an empty proto URL / server address', async () => {
    setLang('tr')
    useGrpcStore.setState({ protoUrl: '  ', address: '' })
    await useGrpcStore.getState().loadProtoFromUrl()
    expect(useGrpcStore.getState().errorMessage).toBe('URL gerekli')
    await useGrpcStore.getState().loadFromReflection()
    expect(useGrpcStore.getState().errorMessage).toBe('Sunucu adresi gerekli')
  })

  it('branch: resolving without a pending conflict', async () => {
    setLang('tr')
    useBranchStore.setState({ pendingConflict: null })
    const res = await useBranchStore.getState().resolveConflict('p.json', 'ours')
    expect(res.error).toBe('Devam eden bir çakışma yok')
  })

  it('auth: changing the password while logged out', async () => {
    setLang('tr')
    useAuthStore.setState({ user: null })
    const res = await useAuthStore.getState().changePassword('a', 'b')
    expect(res.error).toBe('Oturum açılmamış')
  })

  it('Mock MCP: the bridge message is worded when it happens, not at import', async () => {
    ;(window as unknown as { api: unknown }).api = {}
    setLang('tr')
    expect(await useMockMcpStore.getState().deleteServer('x')).toBe(
      'Mock MCP köprüsü kullanılamıyor',
    )
    setLang('en')
    expect(await useMockMcpStore.getState().deleteServer('x')).toBe('Mock MCP bridge unavailable')
  })
})

describe('store fallbacks stay byte-identical in English', () => {
  it('gRPC and branch', async () => {
    setLang('en')
    useGrpcStore.setState({ protoUrl: '' })
    await useGrpcStore.getState().loadProtoFromUrl()
    expect(useGrpcStore.getState().errorMessage).toBe('URL is required')
    const res = await useBranchStore.getState().resolveConflict('p.json', 'ours')
    expect(res.error).toBe('No conflict in progress')
  })
})
