/**
 * Issue #294 — the window runs with `sandbox: true`.
 *
 * A sandboxed preload can `require` only electron's renderer modules plus
 * `events`, `timers` and `url`; anything else throws at load and the renderer
 * opens with no `window.api` at all. Two guards here:
 *
 *  1. The preload's only runtime import is `electron`, and electron-vite bundles
 *     the preload into one file (`externalizeDeps: false`). The e2e spec
 *     `tests/e2e/ui/50-renderer-sandbox.spec.ts` checks the BUILT file.
 *  2. What the preload exposes on `window.api` is snapshotted (taken from the
 *     preload as it was before issue #294), so a member that silently
 *     disappears — or a new, unreviewed one — shows up as a diff.
 *  3. `window.electron` is platform + versions only: no generic `ipcRenderer`
 *     and no `process.env` (it used to be @electron-toolkit/preload's
 *     `electronAPI`, which exposed both).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const exposed: Record<string, unknown> = {}

vi.mock('electron', () => {
  const ipcRenderer = {
    invoke: vi.fn(),
    send: vi.fn(),
    sendSync: vi.fn(),
    sendToHost: vi.fn(),
    postMessage: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
  }
  return {
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => {
        exposed[key] = value
      },
    },
    ipcRenderer,
    webFrame: { insertCSS: vi.fn(), setZoomFactor: vi.fn(), setZoomLevel: vi.fn() },
    webUtils: { getPathForFile: vi.fn() },
  }
})

/** Every key path of an exposed object; functions are leaves. */
function surface(value: unknown, prefix: string, out: string[]): string[] {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const desc = Object.getOwnPropertyDescriptor(value, key)
      // Getters (electronAPI.process.*) are leaves: reading them would walk the
      // whole of process.env / process.versions into the snapshot.
      if (desc && desc.get) {
        out.push(`${prefix}${key} (getter)`)
        continue
      }
      surface((value as Record<string, unknown>)[key], `${prefix}${key}.`, out)
    }
    return out
  }
  out.push(`${prefix.slice(0, -1)} (${typeof value})`)
  return out
}

const ROOT = path.resolve(__dirname, '../..')

describe('preload under the renderer sandbox (issue #294)', () => {
  const CANARY = `env-canary-${Math.random().toString(36).slice(2)}`

  beforeAll(async () => {
    const proc = process as NodeJS.Process & { contextIsolated?: boolean }
    proc.contextIsolated = true
    process.env.TESTNIZER_PRELOAD_CANARY = CANARY
    await import('../../src/preload/index')
  })

  it('exposes exactly `api` and `electron`', () => {
    expect(Object.keys(exposed).sort()).toEqual(['api', 'electron'])
  })

  it('window.api surface is unchanged', () => {
    expect(surface(exposed.api, '', [])).toMatchSnapshot()
  })

  it('window.electron is platform + versions only — no ipcRenderer, no env', () => {
    const electron = exposed.electron as {
      process: { platform: unknown; versions: Record<string, unknown> }
    } & Record<string, unknown>
    expect(Object.keys(electron)).toEqual(['process'])
    expect(Object.keys(electron.process).sort()).toEqual(['platform', 'versions'])
    expect(electron.process.platform).toBe(process.platform)
    expect(electron.process.versions.node).toBe(process.versions.node)
    for (const v of Object.values(electron.process.versions)) expect(typeof v).toBe('string')
    expect(electron.ipcRenderer).toBeUndefined()
    // Plain data only: nothing callable, no getters, and no environment value.
    expect(surface(electron, '', []).every((p) => !p.endsWith('(function)'))).toBe(true)
    expect(JSON.stringify(electron)).not.toContain(CANARY)
  })

  it('the preload source imports nothing a sandboxed preload cannot load once bundled', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/preload/index.ts'), 'utf8')
    const runtimeImports = [...src.matchAll(/^import\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/gm)]
      .map((m) => m[1])
      .sort()
    expect(runtimeImports).toEqual(['electron'])
    expect(src).not.toMatch(/\brequire\(/)
  })

  it('electron-vite bundles the preload dependencies (externalizeDeps: false)', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'electron.vite.config.ts'), 'utf8')
    const preloadBlock = cfg.slice(cfg.indexOf('preload: {'), cfg.indexOf('renderer: {'))
    expect(preloadBlock).toMatch(/externalizeDeps:\s*false/)
  })
})
