/**
 * The tab strip's own keys must leave a modified chord to the global
 * shortcuts (Codex review of the 1.6.0 integration head).
 *
 * The roving-tabindex handler (`Workbench.tsx` `handleTabKeyDown`) activated
 * the FOCUSED tab on Enter without looking at modifiers. The event then
 * bubbled to the window, where Mod+Enter runs the active request — by then
 * the focused tab. So: tab A active, the arrow keys move focus to B, Mod+Enter
 * → B was activated and B's request ran instead of A's.
 *
 * Nothing on the activation path is mocked here: the real `EndpointTabBar`,
 * the real `switchActiveTab` / protocol stores, and the real
 * `useKeyboardShortcuts` listener. Only the request store's `sendRequest` is a
 * spy, recording which tab was active when it ran.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useKeyboardShortcuts } from '../../src/renderer/lib/keyboard-shortcuts'
import type { Tab } from '../../src/renderer/types'

vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

const anyApi: unknown = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
)
;(window as unknown as { api: unknown }).api = anyApi

const { EndpointTabBar } = await import('../../src/renderer/components/layout/Workbench')

function tab(id: string, name: string): Tab {
  return {
    id,
    name,
    protocol: 'http',
    method: 'GET',
    url: `https://${id}.example/items`,
    isDirty: false,
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

/** The tab strip plus the app's global shortcut listener, as AppShell mounts them. */
function Harness(): React.JSX.Element {
  useKeyboardShortcuts()
  return <EndpointTabBar />
}

/** The tab that was active each time a request was sent. */
let sentFrom: Array<string | null>

beforeEach(() => {
  sentFrom = []
  useTabsStore.setState({ tabs: [tab('a', 'Alpha'), tab('b', 'Beta')], activeTabId: 'a' })
  useRequestStore.setState({
    sendRequest: vi.fn(async () => {
      sentFrom.push(useTabsStore.getState().activeTabId)
    }),
  } as never)
})
afterEach(cleanup)

/** Focus only moves: A stays active, B holds the keyboard focus. */
function focusBetaWithArrow(): HTMLElement {
  tabEl('Alpha').focus()
  fireEvent.keyDown(tabEl('Alpha'), { key: 'ArrowRight' })
  const beta = tabEl('Beta')
  expect(document.activeElement).toBe(beta)
  expect(useTabsStore.getState().activeTabId).toBe('a')
  return beta
}

describe('tab strip keys vs. the global Mod+Enter', () => {
  it('Mod+Enter on a focused, inactive tab runs the ACTIVE tab once and switches nothing', () => {
    render(<Harness />)
    const beta = focusBetaWithArrow()
    // Both modifiers: the global handler reads Cmd on macOS and Ctrl elsewhere.
    fireEvent.keyDown(beta, { key: 'Enter', ctrlKey: true, metaKey: true })
    expect(sentFrom).toEqual(['a'])
    expect(useTabsStore.getState().activeTabId).toBe('a')
  })

  it('plain Enter activates the focused tab and sends nothing', () => {
    render(<Harness />)
    const beta = focusBetaWithArrow()
    fireEvent.keyDown(beta, { key: 'Enter' })
    expect(useTabsStore.getState().activeTabId).toBe('b')
    expect(sentFrom).toEqual([])
  })

  it('a modified Space / arrow is not the strip’s either', () => {
    render(<Harness />)
    const beta = focusBetaWithArrow()
    fireEvent.keyDown(beta, { key: ' ', shiftKey: true })
    expect(useTabsStore.getState().activeTabId).toBe('a')
    fireEvent.keyDown(beta, { key: 'ArrowLeft', altKey: true })
    expect(document.activeElement).toBe(beta)
    expect(sentFrom).toEqual([])
  })
})
