/**
 * Tester findings 2 + 3 on the request tab strip (`Workbench.tsx` `EndpointTabBar`).
 *
 * 2 — a 100+ character request name made its tab as wide as the name: the
 *     label span had no width limit, so one tab could push every other tab off
 *     the strip. The label is now capped and ends in "…", with the full name as
 *     a tooltip. The text itself is never shortened: `data-tab-name` and every
 *     `hasText` locator rely on it.
 * 3 — the × was a `<span class="hidden group-hover:inline">`: invisible until
 *     hover and unreachable from the keyboard. It is now a real button with a
 *     name, always shown on the active (clean) tab; a dirty tab keeps its dot
 *     until hover / keyboard focus (VS Code). The tabs themselves are a
 *     `tablist` with a roving tab stop.
 *
 * jsdom has no layout, so the truncation and the visibility rule are asserted
 * on classes here; the real pixel proof is e2e `72-tab-strip-name-close.spec.ts`.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { switchActiveTab } from '../../src/renderer/lib/activate-tab'
import type { Tab } from '../../src/renderer/types'

vi.mock('../../src/renderer/lib/activate-tab', () => ({
  activateTabStores: vi.fn(),
  switchActiveTab: vi.fn(),
}))
vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

const anyApi: unknown = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
)
;(window as unknown as { api: unknown }).api = anyApi

const { EndpointTabBar } = await import('../../src/renderer/components/layout/Workbench')

const LONG_NAME =
  'Get every customer account with their full transaction history for the last fiscal year $& grouped by branch'

function tab(id: string, name: string, dirty = false): Tab {
  return {
    id,
    name,
    protocol: 'http',
    method: 'GET',
    url: '',
    isDirty: dirty,
    isLoading: false,
  } as Tab
}

function tabEl(name: string): HTMLElement {
  const el = screen
    .getAllByTestId('endpoint-tab')
    .find((e) => e.getAttribute('data-tab-name') === name)
  if (!el) throw new Error(`tab ${name} not rendered`)
  return el
}

beforeEach(() => {
  vi.mocked(switchActiveTab).mockClear()
  useTabsStore.setState({
    tabs: [tab('long', LONG_NAME), tab('b', 'Users'), tab('c', 'Orders', true), tab('d', 'Pets')],
    activeTabId: 'long',
  })
})
afterEach(cleanup)

describe('finding 2 — a long tab name is cut off with an ellipsis', () => {
  it('caps the label width, truncates it and keeps the full name as the tooltip', () => {
    render(<EndpointTabBar />)
    const label = within(tabEl(LONG_NAME)).getByTestId('tab-name')
    expect(label.className).toMatch(/\btruncate\b/)
    expect(label.className).toMatch(/\bmax-w-\[\d+px\]/)
    expect(label.getAttribute('title')).toBe(LONG_NAME)
    // The text is not shortened in JS — locators match the full name.
    expect(label.textContent).toBe(LONG_NAME)
  })

  it('still renames on double-click and keeps the label out of the drag-source set', () => {
    render(<EndpointTabBar />)
    const label = within(tabEl(LONG_NAME)).getByTestId('tab-name')
    expect(label.getAttribute('draggable')).toBe('false')
    fireEvent.doubleClick(label)
    expect(within(tabEl(LONG_NAME)).getByDisplayValue(LONG_NAME)).toBeTruthy()
  })
})

describe('finding 3 — the close button is a real, named, keyboard-reachable button', () => {
  it('is a <button type="button"> named "Close tab <name>"', () => {
    render(<EndpointTabBar />)
    const close = within(tabEl(LONG_NAME)).getByTestId('tab-close')
    expect(close.tagName).toBe('BUTTON')
    expect(close.getAttribute('type')).toBe('button')
    // `$&` in the name must come through literally (no replacement pattern).
    expect(close.getAttribute('aria-label')).toBe(`Close tab ${LONG_NAME}`)
  })

  it('is never display:none — always shown on the active tab, hover/focus on the others', () => {
    render(<EndpointTabBar />)
    const active = within(tabEl(LONG_NAME)).getByTestId('tab-close')
    expect(active.className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(active.className).not.toMatch(/(^|\s)opacity-0(\s|$)/)
    expect(active.getAttribute('tabindex')).not.toBe('-1')

    const inactive = within(tabEl('Users')).getByTestId('tab-close')
    expect(inactive.className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(inactive.className).toMatch(/(^|\s)opacity-0(\s|$)/)
    expect(inactive.className).toMatch(/group-hover:opacity-100/)
    expect(inactive.className).toMatch(/focus-visible:opacity-100/)
  })

  it('on a dirty tab the dot holds the slot until hover / focus, and never blocks the ×', () => {
    render(<EndpointTabBar />)
    const dirty = tabEl('Orders')
    const dot = within(dirty).getByTestId('tab-dirty')
    expect(dot.className).toMatch(/pointer-events-none/)
    expect(dot.className).toMatch(/group-hover:opacity-0/)
    const close = within(dirty).getByTestId('tab-close')
    expect(close.className).toMatch(/(^|\s)opacity-0(\s|$)/)
    expect(close.className).toMatch(/group-hover:opacity-100/)
  })

  it('closes a clean background tab without activating it', () => {
    render(<EndpointTabBar />)
    fireEvent.click(within(tabEl('Users')).getByTestId('tab-close'))
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(['long', 'c', 'd'])
    expect(useTabsStore.getState().activeTabId).toBe('long')
    expect(switchActiveTab).not.toHaveBeenCalled()
  })

  it('still asks before closing a dirty tab', async () => {
    render(<EndpointTabBar />)
    fireEvent.click(within(tabEl('Orders')).getByTestId('tab-close'))
    expect(await screen.findByTestId('unsaved-save-btn')).toBeTruthy()
    expect(useTabsStore.getState().tabs.some((t) => t.id === 'c')).toBe(true)
  })
})

describe('finding 3 — the tabs themselves are reachable from the keyboard', () => {
  it('is a tablist with one tab stop (the active tab)', () => {
    render(<EndpointTabBar />)
    const strip = screen.getByTestId('tab-strip')
    expect(strip.getAttribute('role')).toBe('tablist')
    const tabs = within(strip).getAllByRole('tab')
    expect(tabs).toHaveLength(4)
    expect(tabEl(LONG_NAME).getAttribute('aria-selected')).toBe('true')
    expect(tabEl(LONG_NAME).getAttribute('tabindex')).toBe('0')
    expect(tabEl('Users').getAttribute('aria-selected')).toBe('false')
    expect(tabEl('Users').getAttribute('tabindex')).toBe('-1')
  })

  it('arrow keys move focus between tabs, Enter / Space activate', () => {
    render(<EndpointTabBar />)
    tabEl(LONG_NAME).focus()
    fireEvent.keyDown(tabEl(LONG_NAME), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabEl('Users'))
    expect(switchActiveTab).not.toHaveBeenCalled()
    fireEvent.keyDown(tabEl('Users'), { key: 'Enter' })
    expect(switchActiveTab).toHaveBeenCalledWith('b')
    fireEvent.keyDown(tabEl('Users'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tabEl(LONG_NAME))
    fireEvent.keyDown(tabEl(LONG_NAME), { key: 'End' })
    expect(document.activeElement).toBe(tabEl('Pets'))
    fireEvent.keyDown(tabEl('Pets'), { key: ' ' })
    expect(switchActiveTab).toHaveBeenCalledWith('d')
  })

  it('a key pressed on the × or in the rename input does not reach the tab', () => {
    render(<EndpointTabBar />)
    fireEvent.keyDown(within(tabEl('Users')).getByTestId('tab-close'), { key: 'Enter' })
    expect(switchActiveTab).not.toHaveBeenCalled()
    fireEvent.doubleClick(within(tabEl('Users')).getByTestId('tab-name'))
    fireEvent.keyDown(within(tabEl('Users')).getByDisplayValue('Users'), { key: ' ' })
    expect(switchActiveTab).not.toHaveBeenCalled()
  })
})
