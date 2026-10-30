/**
 * Issue #287 — persistence leg: "Settings → Certificates → SSL certificate
 * verification off" survives Save Changes and a reopen.
 *
 * The pane's Save writes the whole `project.<id>.settings` object through
 * `settings:set`; `sslVerification` + `tls` are SHARED keys, so `writeSetting`
 * splits them into `projects.shared_settings` and the machine-local rest
 * (proxy, working directory, …) into electron-store; `settings:get` merges the
 * two back. The App Settings toggle writes the top-level `sslVerification`
 * key through `settings:setAll`.
 *
 * Verified by the orchestrator/author while writing this: this leg already
 * round-trips (green before the fix) — the lost/ignored toggle of #287 is the
 * resolver leg (Send/Run shadowing), covered by the other #287 test files. This
 * file pins the leg so a later change to the split cannot regress it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const stores = vi.hoisted(() => [] as Array<{ store: Record<string, unknown> }>)
class FakeStore {
  store: Record<string, unknown>
  constructor(opts: { defaults?: Record<string, unknown> }) {
    this.store = { ...(opts.defaults ?? {}) }
    stores.push(this)
  }
  get(key: string): unknown {
    return this.store[key]
  }
  set(key: string, value: unknown): void {
    this.store[key] = value
  }
  clear(): void {
    this.store = {}
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerSettingsHandlers } = await import('../../../src/main/ipc/settings.handler')

let projectId: string
let key: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  key = `project.${projectId}.settings`
  registerSettingsHandlers()
})

/** Shaped like ProjectDetailModal's DEFAULT_SETTINGS after the user flips the toggle. */
function paneSave(sslVerification: boolean) {
  return {
    requestTimeout: 30000,
    sslVerification,
    followRedirects: true,
    workingDirectory: '/tmp/work',
    proxy: { mode: 'system' },
    tls: { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3', cipherPreset: 'intermediate' },
  }
}

interface Got {
  success: boolean
  data?: Record<string, unknown> & { tls?: Record<string, unknown> }
}
const get = async (k: string): Promise<Got> => (await harness.invoke('settings:get', k)) as Got

function sharedColumn(): Record<string, unknown> | null {
  const row = testDb
    .prepare('SELECT shared_settings FROM projects WHERE id = ?')
    .get(projectId) as {
    shared_settings: string | null
  }
  return row.shared_settings ? (JSON.parse(row.shared_settings) as Record<string, unknown>) : null
}

describe('issue #287 — project Certificates pane save -> reopen', () => {
  it('settings:get returns sslVerification false with the tls options intact', async () => {
    const set = (await harness.invoke('settings:set', key, paneSave(false))) as { success: boolean }
    expect(set.success).toBe(true)

    const got = await get(key)
    expect(got.success).toBe(true)
    expect(got.data?.sslVerification).toBe(false)
    expect(got.data?.tls).toEqual({
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.3',
      cipherPreset: 'intermediate',
    })
    // local part still merged back
    expect(got.data?.workingDirectory).toBe('/tmp/work')
    expect(got.data?.proxy).toEqual({ mode: 'system' })
  })

  it('the shared column carries sslVerification:false + tls; the local store has no sslVerification', async () => {
    await harness.invoke('settings:set', key, paneSave(false))

    expect(sharedColumn()).toMatchObject({
      sslVerification: false,
      tls: { cipherPreset: 'intermediate' },
    })
    // electron-store holds only the machine-local remainder
    const local = stores[stores.length - 1].store[key] as Record<string, unknown>
    expect(local).toMatchObject({ workingDirectory: '/tmp/work', proxy: { mode: 'system' } })
    expect(local).not.toHaveProperty('sslVerification')
    expect(local).not.toHaveProperty('tls')
  })

  it('toggling back on persists true (off -> on -> reopen)', async () => {
    await harness.invoke('settings:set', key, paneSave(false))
    await harness.invoke('settings:set', key, paneSave(true))
    expect((await get(key)).data?.sslVerification).toBe(true)
    expect(sharedColumn()?.sslVerification).toBe(true)
  })

  it('a later save that omits the key keeps the earlier shared value (writeSharedProjectSettings merge)', async () => {
    await harness.invoke('settings:set', key, paneSave(false))
    await harness.invoke('settings:set', key, { workingDirectory: '/other' })
    expect((await get(key)).data?.sslVerification).toBe(false)
  })
})

describe('issue #287 — App Settings SSL toggle (top-level sslVerification)', () => {
  it('settings:setAll({sslVerification:false}) -> getAll + get return false', async () => {
    const res = (await harness.invoke('settings:setAll', { sslVerification: false })) as Got
    expect(res.success).toBe(true)
    expect(res.data?.sslVerification).toBe(false)

    const all = (await harness.invoke('settings:getAll')) as Got
    expect(all.data?.sslVerification).toBe(false)
    expect((await get('sslVerification')).data).toBe(false)
  })
})
