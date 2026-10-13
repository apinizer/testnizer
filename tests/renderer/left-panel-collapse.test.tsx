/**
 * Issue #202 — the left APIs panel gets a visible collapse control, a way back
 * from the icon sidebar, and its collapsed state survives a restart through
 * the `ui.leftPanelCollapsed` setting (persisted + hydrated like the width).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import LeftPanelCollapseButton from '../../src/renderer/components/layout/LeftPanelCollapseButton'
import IconSidebar from '../../src/renderer/components/layout/IconSidebar'
import { isLeftPanelCollapsible } from '../../src/renderer/lib/sidebar-pages'

type SettingsGet = (key: string) => Promise<{ success: boolean; data?: unknown }>
type SettingsSet = (key: string, value: unknown) => Promise<{ success: boolean }>

let stored: Record<string, unknown>
let setSpy: ReturnType<typeof vi.fn<SettingsSet>>

function installSettingsBridge(): void {
  setSpy = vi.fn<SettingsSet>(async (key, value) => {
    stored[key] = value
    return { success: true }
  })
  const get = vi.fn<SettingsGet>(async (key) => ({ success: true, data: stored[key] }))
  ;(window as unknown as { api: unknown }).api = { settings: { get, set: setSpy } }
}

beforeEach(() => {
  stored = {}
  installSettingsBridge()
  setLocale('en')
  useUIStore.setState({ isLeftPanelCollapsed: false, activeSidebarPage: 'apis' })
})

afterEach(() => {
  cleanup()
  useUIStore.setState({ isLeftPanelCollapsed: false, activeSidebarPage: 'apis' })
  delete (window as unknown as { api?: unknown }).api
})

describe('ui.store — leftPanelCollapsed persistence (issue #202)', () => {
  it('toggleLeftPanel persists the new value', () => {
    useUIStore.getState().toggleLeftPanel()
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(true)
    expect(setSpy).toHaveBeenLastCalledWith('ui.leftPanelCollapsed', true)

    useUIStore.getState().toggleLeftPanel()
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(false)
    expect(setSpy).toHaveBeenLastCalledWith('ui.leftPanelCollapsed', false)
  })

  it('setLeftPanelCollapsed persists the value', () => {
    useUIStore.getState().setLeftPanelCollapsed(true)
    expect(setSpy).toHaveBeenLastCalledWith('ui.leftPanelCollapsed', true)
  })

  it('hydrateFromSettings restores a collapsed panel', async () => {
    stored['ui.leftPanelCollapsed'] = true
    await useUIStore.getState().hydrateFromSettings()
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(true)
  })

  it('hydrateFromSettings restores an expanded panel', async () => {
    useUIStore.setState({ isLeftPanelCollapsed: true })
    stored['ui.leftPanelCollapsed'] = false
    await useUIStore.getState().hydrateFromSettings()
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(false)
  })

  it('hydrateFromSettings ignores a missing or non-boolean value', async () => {
    await useUIStore.getState().hydrateFromSettings()
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(false)
    stored['ui.leftPanelCollapsed'] = 'yes'
    await useUIStore.getState().hydrateFromSettings()
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(false)
  })

  it('a persisted width still hydrates alongside the flag', async () => {
    stored['ui.leftPanelWidth'] = 360
    stored['ui.leftPanelCollapsed'] = true
    await useUIStore.getState().hydrateFromSettings()
    expect(useUIStore.getState().leftPanelWidth).toBe(360)
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(true)
  })
})

describe('left panel collapse controls (issue #202)', () => {
  function Shell() {
    return (
      <>
        <IconSidebar />
        <LeftPanelCollapseButton />
      </>
    )
  }

  it('the header button collapses the panel and the tooltip names the shortcut', () => {
    render(<Shell />)
    const btn = screen.getByTestId('left-panel-collapse')
    expect(btn.getAttribute('title')).toMatch(/^Collapse sidebar \((Cmd|Ctrl)\+B\)$/)
    expect(screen.queryByTestId('left-panel-expand')).toBeNull()

    fireEvent.click(btn)
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(true)
    expect(setSpy).toHaveBeenLastCalledWith('ui.leftPanelCollapsed', true)
  })

  it('the expand button in the icon sidebar re-opens the panel', () => {
    render(<Shell />)
    fireEvent.click(screen.getByTestId('left-panel-collapse'))
    const expand = screen.getByTestId('left-panel-expand')
    expect(expand.getAttribute('title')).toMatch(/^Expand sidebar \((Cmd|Ctrl)\+B\)$/)

    fireEvent.click(expand)
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(false)
    expect(screen.queryByTestId('left-panel-expand')).toBeNull()
  })

  it('clicking the active page icon while collapsed expands the panel', () => {
    render(<Shell />)
    act(() => useUIStore.getState().setLeftPanelCollapsed(true))
    fireEvent.click(screen.getByTestId('nav-apis'))
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(false)
    expect(useUIStore.getState().activeSidebarPage).toBe('apis')
  })

  it('clicking another page icon while collapsed expands it on that page', () => {
    render(<Shell />)
    act(() => useUIStore.getState().setLeftPanelCollapsed(true))
    fireEvent.click(screen.getByTestId('nav-tools'))
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(false)
    expect(useUIStore.getState().activeSidebarPage).toBe('tools')
  })

  it('clicking the active page icon while expanded does not collapse it', () => {
    render(<Shell />)
    fireEvent.click(screen.getByTestId('nav-apis'))
    expect(useUIStore.getState().isLeftPanelCollapsed).toBe(false)
  })

  it('History and Tests keep their panel: no collapse or expand control there', () => {
    expect(isLeftPanelCollapsible('history')).toBe(false)
    expect(isLeftPanelCollapsible('tests')).toBe(false)
    for (const page of ['apis', 'tools', 'security', 'mocks'] as const) {
      expect(isLeftPanelCollapsible(page)).toBe(true)
    }

    useUIStore.setState({ activeSidebarPage: 'history', isLeftPanelCollapsed: true })
    render(<Shell />)
    expect(screen.queryByTestId('left-panel-collapse')).toBeNull()
    expect(screen.queryByTestId('left-panel-expand')).toBeNull()
  })
})
