/**
 * Issue #97 — the "+" disappeared once every tab was closed.
 *
 * The tab strip returned null at zero tabs, so closing the last tab (or using
 * the context menu's Force Close All Tabs) unmounted the whole strip and the
 * "+" with it. The workbench does render PageWelcome in that state, and its
 * nine protocol cards are a richer new-tab surface than the strip — but the
 * two are not alternatives. The affordance the user was clicking a second ago
 * should not vanish at the moment they finish tidying up; that is also why the
 * e2e coverage for issue #93 had to open a tab through the APIs panel first.
 *
 * The strip now keeps its place with the "+" alone in it.
 */
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

// Importing the workbench pulls in every editor and tool, several of which
// read their IPC namespace at module scope. A permissive stub keeps the module
// graph loadable without pretending any of it is exercised here.
const anyApi: unknown = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
)
;(window as unknown as { api: unknown }).api = anyApi

const { EndpointTabBar } = await import('../../src/renderer/components/layout/Workbench')

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

describe('the tab strip with no tabs open', () => {
  it('keeps the new-tab button on screen', () => {
    render(<EndpointTabBar />)
    expect(screen.getByTestId('tab-new')).toBeTruthy()
  })

  it('shows no tabs, only the button', () => {
    render(<EndpointTabBar />)
    expect(screen.queryAllByTestId('endpoint-tab')).toHaveLength(0)
  })

  it('still renders the button once tabs exist', () => {
    useTabsStore.setState({ tabs: [tab('t1')], activeTabId: 't1' })
    render(<EndpointTabBar />)
    expect(screen.getByTestId('tab-new')).toBeTruthy()
    expect(screen.getAllByTestId('endpoint-tab')).toHaveLength(1)
  })
})
