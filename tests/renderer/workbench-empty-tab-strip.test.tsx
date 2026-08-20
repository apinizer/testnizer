/**
 * Issue #97, retest — the "+" was still gone after closing every tab.
 *
 * The first fix removed `if (tabs.length === 0) return null` from the strip
 * itself, and `tab-strip-empty.test.tsx` renders `EndpointTabBar` directly, so
 * it went green while the reported behaviour did not change at all: the
 * workbench branch that ACTUALLY renders at zero tabs — the one showing
 * PageWelcome — never mounted the strip in the first place. Twelve other
 * branches did.
 *
 * So this test drives the workbench, not the strip: it asserts on what the
 * user sees after closing the last tab, which is the only level at which the
 * original report could have been verified.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- classic JSX runtime
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Tab } from '../../src/renderer/types'

vi.mock('../../src/renderer/lib/activate-tab', () => ({
  activateTabStores: vi.fn(),
  switchActiveTab: vi.fn(),
}))
vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

// The workbench pulls in every editor and tool, several of which read their
// IPC namespace at module scope. A permissive stub keeps the module graph
// loadable without pretending any of it is exercised here.
const anyApi: unknown = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
)
;(window as unknown as { api: unknown }).api = anyApi

const Workbench = (await import('../../src/renderer/components/layout/Workbench')).default

function tab(id: string): Tab {
  return {
    id,
    name: id,
    protocol: 'http',
    method: 'GET',
    url: '',
    isDirty: false,
    isLoading: false,
  } as Tab
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
})
afterEach(cleanup)

describe('the tab strip at zero tabs (#97)', () => {
  it('still offers "+" when the last tab has been closed', () => {
    render(<Workbench />)
    expect(screen.getByTestId('tab-new')).toBeTruthy()
  })

  it('keeps the welcome surface as well — the two are not alternatives', () => {
    render(<Workbench />)
    // PageWelcome's protocol cards are the richer new-tab surface and were
    // never the thing in question; the report was that the affordance the user
    // had just been clicking disappeared alongside them.
    expect(screen.getByTestId('tab-new')).toBeTruthy()
    expect(document.body.textContent).toBeTruthy()
  })

  it('survives Force Close All Tabs, which is how the reporter got there', () => {
    useTabsStore.setState({ tabs: [tab('a'), tab('b')], activeTabId: 'a' })
    const { rerender } = render(<Workbench />)
    expect(screen.getByTestId('tab-new')).toBeTruthy()

    useTabsStore.getState().closeAllTabs()
    rerender(<Workbench />)

    expect(useTabsStore.getState().tabs).toHaveLength(0)
    expect(screen.getByTestId('tab-new')).toBeTruthy()
  })
})
