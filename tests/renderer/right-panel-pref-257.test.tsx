/**
 * Issue #257 (item: Variables panel open by default) + issue #251 (auto
 * collapse is NOT a preference).
 *
 * CONTRACT — `src/renderer/stores/ui.store.ts`:
 *
 *   rightPanelCollapsed: boolean         the USER'S preference. Initial state
 *                                        is `true` (a user with no saved
 *                                        preference starts collapsed — no
 *                                        open-then-close flash).
 *   rightPanelNarrowCollapsed: boolean   transient auto-collapse (#251);
 *                                        initial false; NEVER persisted.
 *   setRightPanelNarrowCollapsed(v)      sets only that flag, never calls
 *                                        settings.set.
 *   selectRightPanelCollapsed(s)         exported selector: the EFFECTIVE value
 *                                        = rightPanelCollapsed ||
 *                                        rightPanelNarrowCollapsed. RightPanel
 *                                        and EdgeResizeHandle read this.
 *   persisted key                        `ui.rightPanelCollapsed` (boolean).
 *   hydrateFromSettings                  boolean -> that value; missing or
 *                                        non-boolean -> true (collapsed).
 *   setRightPanelCollapsed(v)            sets + persists v.
 *   toggleRightPanel()                   flips the EFFECTIVE state: if the
 *                                        panel looks collapsed (pref or auto)
 *                                        it opens (pref=false, narrow=false);
 *                                        otherwise it collapses (pref=true).
 *                                        Persists the preference.
 *   setRightPanelTab(tab)                (rail click) opens: pref=false AND
 *                                        narrow=false ("the user wins over the
 *                                        auto collapse"); persists false.
 *
 * `RightPanel.tsx` (testids): open panel root `right-panel`; collapsed rail
 * `right-panel-rail` with buttons `right-panel-rail-variables` and
 * `right-panel-rail-code`; the open panel's collapse chevron
 * `right-panel-collapse` (the e2e specs drive these). It renders the rail whenever the EFFECTIVE value is
 * true. `EdgeResizeHandle target="right"` renders nothing in that case.
 * RunnerTab shares the preference through setRightPanelCollapsed (unchanged).
 *
 * Existing tests that set `rightPanelCollapsed: false` explicitly
 * (codegen-*.test.tsx, code-gen-secret-vars.test.tsx) keep working.
 * Red now: initial state is false, no persistence, no narrow flag/selector.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/runner/RunnerVariables', () => ({
  default: () => <div data-testid="stub-variables" />,
}))
vi.mock('../../src/renderer/components/layout/GenerateCodePane', () => ({
  default: () => <div data-testid="stub-code" />,
}))

import { useUIStore, selectRightPanelCollapsed } from '../../src/renderer/stores/ui.store'
import RightPanel from '../../src/renderer/components/layout/RightPanel'
import EdgeResizeHandle from '../../src/renderer/components/layout/EdgeResizeHandle'

type SettingsSet = (key: string, value: unknown) => Promise<{ success: boolean }>
let stored: Record<string, unknown>
let setSpy: ReturnType<typeof vi.fn<SettingsSet>>

function installSettingsBridge(): void {
  setSpy = vi.fn<SettingsSet>(async (key, value) => {
    stored[key] = value
    return { success: true }
  })
  const get = vi.fn(async (key: string) => ({ success: true, data: stored[key] }))
  ;(window as unknown as { api: unknown }).api = { settings: { get, set: setSpy } }
}

const INITIAL_COLLAPSED = useUIStore.getInitialState().rightPanelCollapsed

beforeEach(() => {
  stored = {}
  installSettingsBridge()
  useUIStore.setState({
    rightPanelCollapsed: false,
    rightPanelNarrowCollapsed: false,
    rightPanelTab: 'variables',
    rightPanelWidth: 300,
  })
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

const prefCalls = (): unknown[][] =>
  setSpy.mock.calls.filter((c) => c[0] === 'ui.rightPanelCollapsed')

describe('right panel: persisted user preference (issue #257)', () => {
  it('a user with no saved preference starts collapsed', () => {
    expect(INITIAL_COLLAPSED).toBe(true)
  })

  it('hydrate: nothing saved -> collapsed', async () => {
    useUIStore.setState({ rightPanelCollapsed: false })
    await useUIStore.getState().hydrateFromSettings()
    expect(useUIStore.getState().rightPanelCollapsed).toBe(true)
  })

  it('hydrate: a non-boolean value -> collapsed', async () => {
    useUIStore.setState({ rightPanelCollapsed: false })
    stored['ui.rightPanelCollapsed'] = 'yes'
    await useUIStore.getState().hydrateFromSettings()
    expect(useUIStore.getState().rightPanelCollapsed).toBe(true)
  })

  it('hydrate: a saved false (user opened it) -> open', async () => {
    useUIStore.setState({ rightPanelCollapsed: true })
    stored['ui.rightPanelCollapsed'] = false
    await useUIStore.getState().hydrateFromSettings()
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
  })

  it('hydrate: a saved true -> collapsed', async () => {
    useUIStore.setState({ rightPanelCollapsed: false })
    stored['ui.rightPanelCollapsed'] = true
    await useUIStore.getState().hydrateFromSettings()
    expect(useUIStore.getState().rightPanelCollapsed).toBe(true)
  })

  it('setRightPanelCollapsed persists (RunnerTab buttons go through it)', () => {
    useUIStore.getState().setRightPanelCollapsed(true)
    expect(setSpy).toHaveBeenLastCalledWith('ui.rightPanelCollapsed', true)
    useUIStore.getState().setRightPanelCollapsed(false)
    expect(setSpy).toHaveBeenLastCalledWith('ui.rightPanelCollapsed', false)
  })

  it('toggleRightPanel persists the new preference', () => {
    useUIStore.getState().toggleRightPanel()
    expect(useUIStore.getState().rightPanelCollapsed).toBe(true)
    expect(setSpy).toHaveBeenLastCalledWith('ui.rightPanelCollapsed', true)
    useUIStore.getState().toggleRightPanel()
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
    expect(setSpy).toHaveBeenLastCalledWith('ui.rightPanelCollapsed', false)
  })

  it('setRightPanelTab (rail icon) opens the panel and persists that', () => {
    useUIStore.setState({ rightPanelCollapsed: true })
    useUIStore.getState().setRightPanelTab('code')
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
    expect(useUIStore.getState().rightPanelTab).toBe('code')
    expect(setSpy).toHaveBeenLastCalledWith('ui.rightPanelCollapsed', false)
  })
})

describe('right panel: auto collapse is not a preference (issue #251)', () => {
  it('setRightPanelNarrowCollapsed never persists and leaves the preference alone', () => {
    useUIStore.getState().setRightPanelNarrowCollapsed(true)
    expect(useUIStore.getState().rightPanelNarrowCollapsed).toBe(true)
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
    useUIStore.getState().setRightPanelNarrowCollapsed(false)
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('selectRightPanelCollapsed is preference OR auto', () => {
    const sel = (pref: boolean, auto: boolean): boolean =>
      selectRightPanelCollapsed({ rightPanelCollapsed: pref, rightPanelNarrowCollapsed: auto })
    expect(sel(false, false)).toBe(false)
    expect(sel(true, false)).toBe(true)
    expect(sel(false, true)).toBe(true)
    expect(sel(true, true)).toBe(true)
  })

  it('a rail click while auto-collapsed opens the panel (the user wins) and persists false', () => {
    useUIStore.setState({ rightPanelCollapsed: false, rightPanelNarrowCollapsed: true })
    useUIStore.getState().setRightPanelTab('variables')
    expect(useUIStore.getState().rightPanelNarrowCollapsed).toBe(false)
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
    expect(selectRightPanelCollapsed(useUIStore.getState())).toBe(false)
    expect(prefCalls()).toEqual([['ui.rightPanelCollapsed', false]])
  })

  it('toggleRightPanel acts on what the user SEES: auto-collapsed -> opens', () => {
    useUIStore.setState({ rightPanelCollapsed: false, rightPanelNarrowCollapsed: true })
    useUIStore.getState().toggleRightPanel()
    expect(useUIStore.getState().rightPanelNarrowCollapsed).toBe(false)
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
    expect(selectRightPanelCollapsed(useUIStore.getState())).toBe(false)
  })
})

describe('RightPanel / EdgeResizeHandle render the effective state', () => {
  it('open: panel visible, no rail, drag handle present', () => {
    render(
      <>
        <EdgeResizeHandle target="right" />
        <RightPanel />
      </>,
    )
    expect(screen.getByTestId('right-panel')).toBeTruthy()
    expect(screen.queryByTestId('right-panel-rail')).toBeNull()
    expect(screen.getByTestId('stub-variables')).toBeTruthy()
    expect(document.querySelector('[role="separator"]')).not.toBeNull()
  })

  it('preference collapsed -> rail only', () => {
    useUIStore.setState({ rightPanelCollapsed: true })
    render(<RightPanel />)
    expect(screen.getByTestId('right-panel-rail')).toBeTruthy()
    expect(screen.queryByTestId('right-panel')).toBeNull()
  })

  it('auto-collapsed (preference open) -> rail only, handle hidden', () => {
    useUIStore.setState({ rightPanelCollapsed: false, rightPanelNarrowCollapsed: true })
    const { container } = render(
      <>
        <EdgeResizeHandle target="right" />
        <RightPanel />
      </>,
    )
    expect(screen.getByTestId('right-panel-rail')).toBeTruthy()
    expect(screen.queryByTestId('right-panel')).toBeNull()
    expect(container.querySelector('[role="separator"]')).toBeNull()
  })

  it('clicking a rail icon while auto-collapsed opens the real panel', () => {
    useUIStore.setState({ rightPanelCollapsed: false, rightPanelNarrowCollapsed: true })
    render(<RightPanel />)
    fireEvent.click(screen.getByTestId('right-panel-rail-variables'))
    expect(screen.getByTestId('right-panel')).toBeTruthy()
    expect(screen.queryByTestId('right-panel-rail')).toBeNull()
  })

  it('the collapse chevron persists the preference', () => {
    render(<RightPanel />)
    act(() => {
      fireEvent.click(screen.getByTestId('right-panel-collapse'))
    })
    expect(useUIStore.getState().rightPanelCollapsed).toBe(true)
    expect(setSpy).toHaveBeenLastCalledWith('ui.rightPanelCollapsed', true)
  })
})
