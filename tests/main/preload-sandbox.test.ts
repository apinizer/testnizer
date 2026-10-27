/**
 * Issue #294 — the window runs with `sandbox: true`.
 *
 * A sandboxed preload can `require` only electron's renderer modules plus
 * `events`, `timers` and `url`; anything else throws at load and the renderer
 * opens with no `window.api` at all. Two guards here:
 *
 *  1. The preload's runtime imports stay `electron` + `@electron-toolkit/preload`
 *     (the latter only `require`s electron), and electron-vite bundles them into
 *     one file (`externalizeDeps: false`). The e2e spec
 *     `tests/e2e/ui/50-renderer-sandbox.spec.ts` checks the BUILT file.
 *  2. What the preload exposes on `window.api` / `window.electron` did not change
 *     with the sandbox switch: the snapshot was taken from the preload as it was
 *     before issue #294, so a member that silently disappears (or a new
 *     unreviewed one) shows up as a diff.
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

// The real toolkit build, evaluated with the mocked `electron` above: vitest
// would otherwise load the external CJS package natively, against the real
// electron binary path instead of the mock.
vi.mock('@electron-toolkit/preload', async () => {
  const electron = await import('electron')
  const nodeFs = await import('node:fs')
  const nodePath = await import('node:path')
  const src = nodeFs.readFileSync(
    nodePath.resolve(__dirname, '../../node_modules/@electron-toolkit/preload/dist/index.cjs'),
    'utf8',
  )
  const mod: { exports: Record<string, unknown> } = { exports: {} }
  new Function('require', 'module', 'exports', src)(
    (id: string) => {
      if (id !== 'electron') throw new Error(`unexpected require(${id})`)
      return electron
    },
    mod,
    mod.exports,
  )
  return mod.exports
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
  beforeAll(async () => {
    const proc = process as NodeJS.Process & { contextIsolated?: boolean }
    proc.contextIsolated = true
    await import('../../src/preload/index')
  })

  it('exposes exactly `api` and `electron`', () => {
    expect(Object.keys(exposed).sort()).toEqual(['api', 'electron'])
  })

  it('window.api surface is unchanged', () => {
    expect(surface(exposed.api, '', [])).toMatchSnapshot()
  })

  it('window.electron surface is unchanged', () => {
    expect(surface(exposed.electron, '', [])).toMatchSnapshot()
  })

  it('the preload source imports nothing a sandboxed preload cannot load once bundled', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/preload/index.ts'), 'utf8')
    const runtimeImports = [...src.matchAll(/^import\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/gm)]
      .map((m) => m[1])
      .sort()
    expect(runtimeImports).toEqual(['@electron-toolkit/preload', 'electron'])
    expect(src).not.toMatch(/\brequire\(/)
  })

  it('@electron-toolkit/preload only requires electron (safe to inline)', () => {
    const dist = fs.readFileSync(
      path.join(ROOT, 'node_modules/@electron-toolkit/preload/dist/index.cjs'),
      'utf8',
    )
    const requires = [...dist.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
    expect([...new Set(requires)]).toEqual(['electron'])
  })

  it('electron-vite bundles the preload dependencies (externalizeDeps: false)', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'electron.vite.config.ts'), 'utf8')
    const preloadBlock = cfg.slice(cfg.indexOf('preload: {'), cfg.indexOf('renderer: {'))
    expect(preloadBlock).toMatch(/externalizeDeps:\s*false/)
  })
})
