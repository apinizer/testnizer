/**
 * Issue #254 — two Settings dialogs, each says what it owns.
 *
 * DECIDED DESIGN (contract; implemented by a later agent, these tests are
 * written first and are RED on the current tree):
 *
 *  1. Both dialogs stay. The titles state the scope (EN / TR):
 *       project dialog  testid `project-settings-title`
 *                       "Project settings — <project name>" / "Proje ayarları — <ad>"
 *       app dialog      testid `app-settings-title`
 *                       "App settings (all projects)" / "Uygulama ayarları (tüm projeler)"
 *     (the Radix dialog's accessible name equals the same text).
 *
 *  2. A field that exists in both is labelled with its REAL scope, verified
 *     from the code (see the report for the evidence):
 *     - theme / language / font family / font size are GLOBAL (`ui.store`,
 *       `ui.*` keys). They leave the project dialog: its `themes` tab keeps
 *       its id but renders only a link row `project-appearance-link`
 *       ("Appearance is app-wide → Open App settings"). The app dialog gains
 *       the controls the project dialog alone had: font family
 *       (`app-font-family`, free text + presets). Accent colour is
 *       project-scoped (`setActiveProject` applies `icon_color`; the Overview
 *       pane has its own picker) so it stays in Overview — issue #37 path.
 *       The app dialog states `app-setting-scope-appearance`
 *       ("Applies to the whole app").
 *     - timeout / SSL verification / follow redirects are OVERRIDES of the
 *       app value. Project dialog, per field f in {timeout, ssl, redirects}:
 *         `project-setting-scope-<f>`  carries `data-scope="app"` when the
 *             project has no value of its own ("Follows the app setting
 *             (<value>)" — value is `45000 ms` for the timeout, on/off for
 *             the booleans) and `data-scope="project"` when it has one
 *             ("Overrides the app setting");
 *         `project-setting-reset-<f>`  "Use app setting" button, rendered ONLY
 *             when `data-scope="project"`. Clicking it is a draft edit; on
 *             Save the payload carries `<key>: null` (the explicit delete
 *             marker, see tests/main/handlers/settings-use-app-setting-254
 *             .test.ts — omission means "leave alone", so null is required).
 *         The SSL pair also appears in the Certificates pane under the same
 *         testids. The timeout input has testid `project-timeout-input`;
 *         while unset it is empty with the app value as its placeholder.
 *       App dialog: `app-setting-override-note-<f>` ("Projects can override
 *       this in Project settings") next to timeout, SSL and a NEW follow
 *       redirects checkbox `app-follow-redirects` (the project dialog says
 *       "follows the app setting" for redirects, so the app dialog must be
 *       able to set it; written through `setAll({followRedirects})`).
 *     - PROXY (ORCHESTRATOR DECISION, flipped from "remove the app proxy"):
 *       the app dialog's proxy was read by nothing; it is now WIRED as a real
 *       fallback — project proxy (when the project configures one: "No proxy"
 *       or a custom proxy with a host) → app proxy → none, one shared
 *       resolver (`resolveProxy`, src/shared/request-settings.ts) for Send
 *       (`networkPayload`) and Run (`inheritedNetworkFor`). A stored
 *       `{mode:'system'}` (the old project dialog default, frozen into every
 *       project on its first Save) is NOT an override. The proxy gets the
 *       same treatment as timeout / SSL: `project-setting-scope-proxy`
 *       (app|project) + `project-setting-reset-proxy` (saves `proxy: null`);
 *       the app dialog keeps its proxy controls (+ username / password) and
 *       `app-setting-override-note-proxy`. Send / Run legs:
 *       tests/renderer/proxy-app-fallback-254.test.ts,
 *       tests/main/handlers/runner-app-proxy-254.test.ts.
 *
 *  3. "Use app setting" for requestTimeout / sslVerification /
 *     followRedirects; and the project dialog no longer writes
 *     `requestTimeout: 30000` on the first Save (same fix #287 made for SSL).
 *
 * The existing #287 test (ssl-inherit-ui-287.test.tsx) keeps its copy
 * `/follows the app Settings \(off\)/i` — keep `general.inheritsAppValue`'s
 * text; new assertions here use testids, not copy.
 *
 * Cross-links + the unsaved-changes guard: settings-cross-link-254.test.tsx.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import ProjectDetailModal from '../../src/renderer/components/modals/ProjectDetailModal'
import SettingsModal from '../../src/renderer/components/modals/SettingsModal'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { t as translate } from '../../src/renderer/lib/i18n'

const PID = 'p-254'
const PROJECT = {
  id: PID,
  workspace_id: 'w1',
  name: 'orders-api',
  display_name: 'Orders API',
  type: 'http' as const,
  save_mode: 'local' as const,
  sort_order: 0,
  created_at: 1,
  updated_at: 1,
}
const PKEY = `project.${PID}.settings`

type Obj = Record<string, unknown>
const ok = (data: unknown) => ({ success: true, data })

interface Cfg {
  /** `project.<id>.settings` as `settings:get` returns it. */
  project?: Obj
  /** App Settings store (what `settings:getAll` / `settings:get(<top-level key>)` return). */
  app?: Obj
}

function installApi(cfg: Cfg = {}) {
  const app: Obj = {
    defaultTimeout: 45000,
    sslVerification: false,
    followRedirects: false,
    proxy: { mode: 'system' },
    autoUpdate: true,
    ...cfg.app,
  }
  const project: Obj = { ...(cfg.project ?? {}) }
  const set = vi.fn(async () => ok(true))
  const setAll = vi.fn(async () => ok(app))
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    settings: {
      // Answers both the per-key and the getAll route so the test does not
      // dictate which one the implementation uses for the inherited values.
      get: vi.fn(async (key: string) => {
        if (key === PKEY) return ok(project)
        if (key in app) return ok(app[key])
        return ok(undefined)
      }),
      getAll: vi.fn(async () => ok(app)),
      set,
      setAll,
    },
    certificate: { list: vi.fn(async () => ok([])) },
    folder: { list: vi.fn(async () => ok([])) },
  }
  return { set, setAll }
}

const updateProject = vi.fn(async () => true)

function openProject(cfg: Cfg = {}) {
  const api = installApi(cfg)
  useWorkspaceStore.setState({
    projects: [PROJECT],
    activeProjectId: PID,
    updateProject,
    renameProject: vi.fn(async () => true),
  } as never)
  useUIStore.setState({ showProjectDetailModal: true, showSettingsModal: false })
  render(React.createElement(ProjectDetailModal))
  return api
}

function openApp(cfg: Cfg = {}) {
  const api = installApi(cfg)
  useWorkspaceStore.setState({
    projects: [PROJECT],
    activeProjectId: PID,
  } as never)
  useUIStore.setState({ showProjectDetailModal: false, showSettingsModal: true })
  render(React.createElement(SettingsModal))
  return api
}

const savedProjectSettings = (set: ReturnType<typeof vi.fn>): Obj => {
  const call = set.mock.calls.find((c) => c[0] === PKEY)
  expect(call).toBeTruthy()
  return call![1] as Obj
}

async function goTo(tab: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(`project-detail-tab-${tab}`))
}

async function save(): Promise<void> {
  fireEvent.click(
    await screen.findByRole('button', { name: /Save Changes|Değişiklikleri Kaydet/i }),
  )
}

beforeEach(() => {
  updateProject.mockClear()
  const ui = useUIStore.getState()
  ui.setLocale('en')
  ui.setTheme('light')
  ui.setFontSize(13)
  useUIStore.setState({ showProjectDetailModal: false, showSettingsModal: false })
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

// ─── titles ────────────────────────────────────────────────────────────────

describe('titles say the scope (EN / TR)', () => {
  it('project dialog: "Project settings — <name>"', async () => {
    openProject()
    const title = await screen.findByTestId('project-settings-title')
    expect(title.textContent).toBe('Project settings — Orders API')
    expect(screen.getByRole('dialog', { name: 'Project settings — Orders API' })).toBeTruthy()
  })

  it('app dialog: "App settings (all projects)"', async () => {
    openApp()
    const title = await screen.findByTestId('app-settings-title')
    expect(title.textContent).toBe('App settings (all projects)')
    expect(screen.getByRole('dialog', { name: 'App settings (all projects)' })).toBeTruthy()
  })

  it('Turkish titles', async () => {
    useUIStore.getState().setLocale('tr')
    openProject()
    expect((await screen.findByTestId('project-settings-title')).textContent).toBe(
      'Proje ayarları — Orders API',
    )
    cleanup()
    openApp()
    expect((await screen.findByTestId('app-settings-title')).textContent).toBe(
      'Uygulama ayarları (tüm projeler)',
    )
  })
})

// ─── project dialog: follows / overrides + Use app setting ─────────────────

const FIELDS = [
  { f: 'timeout', own: { requestTimeout: 5000 }, appValue: /45000/ },
  { f: 'ssl', own: { sslVerification: true }, appValue: /off|kapalı/i },
  { f: 'redirects', own: { followRedirects: true }, appValue: /off|kapalı/i },
] as const

describe('project dialog — each overridable field says follows / overrides', () => {
  for (const { f, own, appValue } of FIELDS) {
    it(`${f}: unset -> data-scope="app" with the app value, no reset button`, async () => {
      openProject()
      await goTo('general')
      const note = await screen.findByTestId(`project-setting-scope-${f}`)
      await waitFor(() => expect(note).toHaveAttribute('data-scope', 'app'))
      expect(note.textContent).toMatch(appValue)
      expect(screen.queryByTestId(`project-setting-reset-${f}`)).toBeNull()
    })

    it(`${f}: set -> data-scope="project" ("Overrides the app setting") and a Use app setting button`, async () => {
      openProject({ project: { ...own } })
      await goTo('general')
      const note = await screen.findByTestId(`project-setting-scope-${f}`)
      await waitFor(() => expect(note).toHaveAttribute('data-scope', 'project'))
      expect(note.textContent).toMatch(/overrides the app setting/i)
      expect(screen.getByTestId(`project-setting-reset-${f}`)).toBeTruthy()
    })
  }

  it('the notes are translated (Turkish text differs from English and mentions the app)', async () => {
    openProject({ project: { requestTimeout: 5000 } })
    await goTo('general')
    const en = (await screen.findByTestId('project-setting-scope-timeout')).textContent
    cleanup()
    useUIStore.getState().setLocale('tr')
    openProject({ project: { requestTimeout: 5000 } })
    await goTo('general')
    const tr = (await screen.findByTestId('project-setting-scope-timeout')).textContent
    expect(tr).not.toBe(en)
    expect(tr).toMatch(/uygulama/i)
    expect((await screen.findByTestId('project-setting-reset-timeout')).textContent).not.toMatch(
      /Use app setting/i,
    )
  })

  it('timeout input: empty with the app value as placeholder while unset; typing makes it the project’s own', async () => {
    const { set } = openProject()
    await goTo('general')
    const input = (await screen.findByTestId('project-timeout-input')) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('45000')

    fireEvent.change(input, { target: { value: '1234' } })
    expect(screen.getByTestId('project-setting-scope-timeout')).toHaveAttribute(
      'data-scope',
      'project',
    )
    await save()
    await waitFor(() => expect(set).toHaveBeenCalled())
    expect(savedProjectSettings(set).requestTimeout).toBe(1234)
  })

  it('SSL and redirects toggles: flipping makes the value the project’s own', async () => {
    const { set } = openProject()
    await goTo('general')
    const ssl = await screen.findByRole('checkbox', { name: /SSL certificate verification/i })
    fireEvent.click(ssl)
    expect(screen.getByTestId('project-setting-scope-ssl')).toHaveAttribute('data-scope', 'project')
    await save()
    await waitFor(() => expect(set).toHaveBeenCalled())
    // the app value was off, flipped -> on
    expect(savedProjectSettings(set).sslVerification).toBe(true)
  })

  it('Certificates pane shows the SSL scope + reset under the same testids', async () => {
    openProject({ project: { sslVerification: true } })
    await goTo('certificates')
    const note = await screen.findByTestId('project-setting-scope-ssl')
    await waitFor(() => expect(note).toHaveAttribute('data-scope', 'project'))
    expect(screen.getByTestId('project-setting-reset-ssl')).toBeTruthy()
  })
})

describe('"Use app setting" — the saved payload carries the delete marker (null)', () => {
  // What every project saved before #287 / #254 holds.
  const LEGACY = { requestTimeout: 30000, sslVerification: true, followRedirects: true }

  it('resetting all three: after Save each key is exactly null, other settings untouched', async () => {
    const { set } = openProject({ project: { ...LEGACY, workingDirectory: '/w' } })
    await goTo('general')
    for (const f of ['timeout', 'ssl', 'redirects']) {
      fireEvent.click(await screen.findByTestId(`project-setting-reset-${f}`))
      expect(screen.getByTestId(`project-setting-scope-${f}`)).toHaveAttribute('data-scope', 'app')
      expect(screen.queryByTestId(`project-setting-reset-${f}`)).toBeNull()
    }
    await save()
    await waitFor(() => expect(set).toHaveBeenCalled())
    const payload = savedProjectSettings(set)
    expect(payload.requestTimeout).toBeNull()
    expect(payload.sslVerification).toBeNull()
    expect(payload.followRedirects).toBeNull()
    expect(payload.workingDirectory).toBe('/w')
  })

  it('resetting only SSL leaves the other two values as they were', async () => {
    const { set } = openProject({ project: { ...LEGACY } })
    await goTo('general')
    fireEvent.click(await screen.findByTestId('project-setting-reset-ssl'))
    await save()
    await waitFor(() => expect(set).toHaveBeenCalled())
    const payload = savedProjectSettings(set)
    expect(payload.sslVerification).toBeNull()
    expect(payload.requestTimeout).toBe(30000)
    expect(payload.followRedirects).toBe(true)
  })

  it('reset from the Certificates pane works the same way', async () => {
    const { set } = openProject({ project: { sslVerification: true } })
    await goTo('certificates')
    fireEvent.click(await screen.findByTestId('project-setting-reset-ssl'))
    await save()
    await waitFor(() => expect(set).toHaveBeenCalled())
    expect(savedProjectSettings(set).sslVerification).toBeNull()
  })

  it('a reset is not applied until Save (closing without saving writes nothing)', async () => {
    const { set } = openProject({ project: { ...LEGACY } })
    await goTo('general')
    fireEvent.click(await screen.findByTestId('project-setting-reset-timeout'))
    fireEvent.click(screen.getAllByRole('button', { name: /^Close$/i })[0])
    expect(set.mock.calls.filter((c) => c[0] === PKEY)).toHaveLength(0)
  })
})

describe('first Save no longer freezes a timeout into the project', () => {
  it('RED today (writes 30000): an untouched Save carries no requestTimeout / ssl / redirects key', async () => {
    const { set } = openProject()
    await save()
    await waitFor(() => expect(set).toHaveBeenCalled())
    const payload = savedProjectSettings(set)
    expect(payload).not.toHaveProperty('requestTimeout')
    expect(payload).not.toHaveProperty('sslVerification')
    expect(payload).not.toHaveProperty('followRedirects')
  })

  it('a stored project timeout survives an untouched Save', async () => {
    const { set } = openProject({ project: { requestTimeout: 7000 } })
    await save()
    await waitFor(() => expect(set).toHaveBeenCalled())
    expect(savedProjectSettings(set).requestTimeout).toBe(7000)
  })
})

// ─── project dialog: appearance + accent ───────────────────────────────────

describe('project dialog — appearance is app-wide', () => {
  it('the themes tab has no theme / language / font controls, only the link row', async () => {
    openProject()
    await goTo('themes')
    expect(await screen.findByTestId('project-appearance-link')).toBeTruthy()
    expect(document.querySelector('option[value="tr"]')).toBeNull() // language select
    expect(document.querySelector('input[type="range"]')).toBeNull() // font size slider
    expect(screen.queryByText(/^Font family$/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Dark$/ })).toBeNull()
  })

  it('the link row opens App settings (clean dialog: no prompt)', async () => {
    openProject()
    await goTo('themes')
    fireEvent.click(await screen.findByTestId('project-appearance-link'))
    await waitFor(() => expect(useUIStore.getState().showSettingsModal).toBe(true))
    expect(useUIStore.getState().showProjectDetailModal).toBe(false)
    expect(screen.queryByTestId('settings-switch-unsaved-dialog')).toBeNull()
  })

  it('PIN (green today, issue #37): the Overview colour picker still saves icon_color', async () => {
    openProject()
    const swatch = (await screen.findAllByRole('button')).find(
      (b) => (b as HTMLElement).style.background === 'rgb(232, 93, 74)', // #e85d4a
    )
    expect(swatch).toBeTruthy()
    fireEvent.click(swatch!)
    await save()
    await waitFor(() => expect(updateProject).toHaveBeenCalled())
    expect(updateProject).toHaveBeenCalledWith(
      PID,
      expect.objectContaining({ icon_color: '#e85d4a' }),
    )
  })
})

// ─── project dialog: proxy ─────────────────────────────────────────────────

describe('project dialog — proxy follows the app proxy unless the project sets one', () => {
  const APP_CUSTOM = { mode: 'custom', host: 'p.example', port: 3128 }

  it('no project proxy -> data-scope="app" naming the app proxy, no reset', async () => {
    openProject({ app: { proxy: APP_CUSTOM } })
    await goTo('proxy')
    const note = await screen.findByTestId('project-setting-scope-proxy')
    expect(note).toHaveAttribute('data-scope', 'app')
    await waitFor(() => expect(note.textContent).toMatch(/p\.example:3128/))
    expect(screen.queryByTestId('project-setting-reset-proxy')).toBeNull()
  })

  it('the frozen legacy {mode:"system"} is not an override (follows the app)', async () => {
    openProject({ project: { proxy: { mode: 'system' } }, app: { proxy: APP_CUSTOM } })
    await goTo('proxy')
    expect(await screen.findByTestId('project-setting-scope-proxy')).toHaveAttribute(
      'data-scope',
      'app',
    )
    expect(screen.queryByTestId('project-setting-reset-proxy')).toBeNull()
  })

  it('a project custom proxy overrides; "Use app setting" saves proxy: null', async () => {
    const { set } = openProject({
      project: { proxy: { mode: 'custom', host: 'own.proxy', port: 8888 }, workingDirectory: '/w' },
    })
    await goTo('proxy')
    const note = await screen.findByTestId('project-setting-scope-proxy')
    await waitFor(() => expect(note).toHaveAttribute('data-scope', 'project'))
    expect(note.textContent).toMatch(/overrides the app setting/i)
    fireEvent.click(screen.getByTestId('project-setting-reset-proxy'))
    expect(screen.getByTestId('project-setting-scope-proxy')).toHaveAttribute('data-scope', 'app')
    await save()
    await waitFor(() => expect(set).toHaveBeenCalled())
    const payload = savedProjectSettings(set)
    expect(payload.proxy).toBeNull()
    expect(payload.workingDirectory).toBe('/w')
  })

  it('"No proxy" in the project is an override too', async () => {
    openProject({ project: { proxy: { mode: 'none' } } })
    await goTo('proxy')
    const note = await screen.findByTestId('project-setting-scope-proxy')
    await waitFor(() => expect(note).toHaveAttribute('data-scope', 'project'))
  })

  it('an untouched Save carries no proxy key (no default is frozen in)', async () => {
    const { set } = openProject()
    await save()
    await waitFor(() => expect(set).toHaveBeenCalled())
    expect(savedProjectSettings(set)).not.toHaveProperty('proxy')
  })
})

// ─── app dialog ────────────────────────────────────────────────────────────

describe('app dialog — what it owns and what projects may override', () => {
  it('timeout, SSL and follow redirects each say "Projects can override this in Project settings"', async () => {
    openApp()
    for (const f of ['timeout', 'ssl', 'redirects']) {
      const note = await screen.findByTestId(`app-setting-override-note-${f}`)
      expect(note.textContent).toMatch(/projects can override this in project settings/i)
    }
  })

  it('the override notes are translated', async () => {
    openApp()
    const en = (await screen.findByTestId('app-setting-override-note-timeout')).textContent
    cleanup()
    useUIStore.getState().setLocale('tr')
    openApp()
    const tr = (await screen.findByTestId('app-setting-override-note-timeout')).textContent
    expect(tr).not.toBe(en)
    expect(tr).toMatch(/proje/i)
  })

  it('theme / language / font say they apply to the whole app', async () => {
    openApp()
    expect((await screen.findByTestId('app-setting-scope-appearance')).textContent).toMatch(
      /whole app/i,
    )
  })

  it('follow redirects: loaded from the app store, written through setAll', async () => {
    const { setAll } = openApp({ app: { followRedirects: false } })
    const box = (await screen.findByTestId('app-follow-redirects')) as HTMLInputElement
    await waitFor(() => expect(box.checked).toBe(false))
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: translate('settings.save') }))
    await waitFor(() => expect(setAll).toHaveBeenCalled())
    expect((setAll.mock.calls[0] as unknown[])[0]).toMatchObject({ followRedirects: true })
  })

  it('follow redirects defaults to on when the store has no value', async () => {
    installApi()
    // a store that never saved the key (getAll without it)
    ;(window as unknown as { api: { settings: { getAll: unknown } } }).api.settings.getAll = vi.fn(
      async () => ok({ defaultTimeout: 30000 }),
    )
    useWorkspaceStore.setState({ projects: [PROJECT], activeProjectId: PID } as never)
    useUIStore.setState({ showSettingsModal: true })
    render(React.createElement(SettingsModal))
    const box = (await screen.findByTestId('app-follow-redirects')) as HTMLInputElement
    expect(box.checked).toBe(true)
  })

  it('font family lives here now: free text, saved to the UI store', async () => {
    openApp()
    const input = (await screen.findByTestId('app-font-family')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Roboto, sans-serif' } })
    fireEvent.click(screen.getByRole('button', { name: translate('settings.save') }))
    await waitFor(() => expect(useUIStore.getState().fontFamily).toBe('Roboto, sans-serif'))
  })
})

describe('app dialog — proxy is a real fallback (orchestrator decision)', () => {
  it('proxy controls are present, with the override note', async () => {
    openApp()
    const dialog = await screen.findByTestId('settings-modal')
    expect(within(dialog).getByTestId('app-setting-override-note-proxy').textContent).toMatch(
      /projects can override this in project settings/i,
    )
    fireEvent.change(within(dialog).getByLabelText(translate('settings.proxy')), {
      target: { value: 'custom' },
    })
    expect(within(dialog).getByLabelText(/^Host$/i)).toBeTruthy()
    expect(within(dialog).getByLabelText(/^Port$/i)).toBeTruthy()
  })

  it('loads the stored app proxy (credentials included) into the form', async () => {
    openApp({
      app: {
        proxy: {
          mode: 'custom',
          host: 'p.example',
          port: 3128,
          auth: { username: 'u', password: 'pw' },
        },
      },
    })
    const dialog = await screen.findByTestId('settings-modal')
    await waitFor(() =>
      expect((within(dialog).getByLabelText(/^Host$/i) as HTMLInputElement).value).toBe(
        'p.example',
      ),
    )
    expect((within(dialog).getByLabelText(/^Port$/i) as HTMLInputElement).value).toBe('3128')
    expect((screen.getByTestId('app-proxy-username') as HTMLInputElement).value).toBe('u')
    expect((screen.getByTestId('app-proxy-password') as HTMLInputElement).value).toBe('pw')
  })

  it('Save writes the proxy (with credentials) through setAll', async () => {
    const { setAll } = openApp()
    const dialog = await screen.findByTestId('settings-modal')
    fireEvent.change(within(dialog).getByLabelText(translate('settings.proxy')), {
      target: { value: 'custom' },
    })
    fireEvent.change(within(dialog).getByLabelText(/^Host$/i), { target: { value: '127.0.0.1' } })
    fireEvent.change(within(dialog).getByLabelText(/^Port$/i), { target: { value: '8080' } })
    fireEvent.change(screen.getByTestId('app-proxy-username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByTestId('app-proxy-password'), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: translate('settings.save') }))
    await waitFor(() => expect(setAll).toHaveBeenCalled())
    expect(setAll.mock.calls[0][0]).toMatchObject({
      proxy: {
        mode: 'custom',
        host: '127.0.0.1',
        port: 8080,
        auth: { username: 'alice', password: 's3cret' },
      },
    })
  })
})

describe('app dialog — the rest still saves through setAll', () => {
  it('timeout / SSL still save through setAll (the rest of the dialog is intact)', async () => {
    const { setAll } = openApp()
    const dialog = await screen.findByTestId('settings-modal')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /SSL certificate verification/i }))
    fireEvent.click(screen.getByRole('button', { name: translate('settings.save') }))
    await waitFor(() => expect(setAll).toHaveBeenCalled())
    expect(setAll.mock.calls[0][0]).toMatchObject({
      defaultTimeout: 45000,
      sslVerification: true,
    })
  })
})

// ─── updates: the live toggles are the project ones ────────────────────────

describe('updates — the control the updater reads is the project one; the dead app box is gone', () => {
  it('app dialog: no "Auto Update" checkbox, a note pointing at Project settings, Save writes no autoUpdate', async () => {
    const { setAll } = openApp()
    const dialog = await screen.findByTestId('settings-modal')
    expect(
      within(dialog).queryByRole('checkbox', { name: translate('settings.autoUpdate') }),
    ).toBeNull()
    expect(within(dialog).getByTestId('app-update-per-project-note')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: translate('settings.save') }))
    await waitFor(() => expect(setAll).toHaveBeenCalled())
    expect(setAll.mock.calls[0][0]).not.toHaveProperty('autoUpdate')
  })

  it('project dialog: the Update pane states its real scope and its toggles still save', async () => {
    const { set } = openProject()
    await goTo('update')
    expect(await screen.findByTestId('project-setting-scope-update')).toHaveAttribute(
      'data-scope',
      'project',
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /Automatically check for updates/i }))
    await save()
    await waitFor(() => expect(set).toHaveBeenCalled())
    expect(savedProjectSettings(set).autoCheckUpdates).toBe(false)
  })
})
