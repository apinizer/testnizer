/**
 * A Send waiting for a withheld credential does not go out once the user has moved
 * to another tab, since the store would read that tab's configuration. The user who
 * pressed Send is told it did not happen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const info = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { info, warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
const reload = vi.hoisted(() => ({ release: () => {}, gate: Promise.resolve() }))
vi.mock('../../src/renderer/lib/withheld-credentials', () => ({
  ensureWithheldCredentialsLoaded: async () => {
    await reload.gate
    return { ok: true }
  },
}))

const { reloadedOnSameTab } = await import('../../src/renderer/lib/withheld-before-send')
const { useGrpcStore } = await import('../../src/renderer/stores/grpc.store')
const { useTabsStore } = await import('../../src/renderer/stores/tabs.store')
const { setLocale } = await import('../../src/renderer/lib/i18n')
const { switchActiveTab } = await import('../../src/renderer/lib/activate-tab')
import type { Tab } from '../../src/renderer/types'

const tab = (id: string): Tab =>
  ({ id, name: id, protocol: 'grpc', isDirty: false, isLoading: false }) as Tab

function holdReload(): void {
  reload.gate = new Promise((r) => {
    reload.release = r
  })
}

beforeEach(() => {
  window.localStorage.clear()
  info.mockReset()
  setLocale('en')
  reload.gate = Promise.resolve()
  useTabsStore.setState({ tabs: [tab('a'), tab('b')], activeTabId: 'a' })
})

describe('the tab changes during the credential reload', () => {
  it('reloadedOnSameTab says no and shows one info toast', async () => {
    holdReload()
    let current = 'a'
    const pending = reloadedOnSameTab(() => ({ _currentTabId: current }))
    current = 'b'
    reload.release()
    await expect(pending).resolves.toBe(false)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      'The request was not sent because you switched tabs. Send it again from that tab.',
    )
  })

  it('the same tab goes ahead, with no toast', async () => {
    await expect(reloadedOnSameTab(() => ({ _currentTabId: 'a' }))).resolves.toBe(true)
    expect(info).not.toHaveBeenCalled()
  })

  it('in Turkish', async () => {
    setLocale('tr')
    holdReload()
    let current = 'a'
    const pending = reloadedOnSameTab(() => ({ _currentTabId: current }))
    current = 'b'
    reload.release()
    await pending
    expect(info).toHaveBeenCalledWith(
      'Sekme değiştiği için istek gönderilmedi. O sekmeden yeniden gönderin.',
    )
  })

  it('a gRPC Send: nothing goes out, and the toast says so', async () => {
    const execute = vi.fn()
    ;(window as unknown as { api: unknown }).api = { grpc: { execute } }
    switchActiveTab('a')
    useGrpcStore.setState({
      address: 'x.test:1',
      selectedService: 'S',
      selectedMethod: 'M',
      services: [
        { name: 'S', methods: [{ name: 'M', type: 'unary', requestType: '', responseType: '' }] },
      ],
      protoPath: '/p.proto',
      withheldCredentials: ['metadata[0].value'],
    })
    holdReload()
    const send = useGrpcStore.getState().execute()
    switchActiveTab('b')
    reload.release()
    await send
    expect(execute).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledTimes(1)
  })
})
