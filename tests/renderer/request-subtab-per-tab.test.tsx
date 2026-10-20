/**
 * Issue #205 — the request editor remembers its sub-tab (Params / Body /
 * Headers …) per open request tab.
 *
 * Workbench mounts `<RequestEditor key={activeTab.id} />`, so a tab switch
 * remounts the editor. With a local `useState('params')` every switch went
 * back to Params. The choice now lives in `tab-subtab.store` (in memory,
 * keyed by tab id) and is dropped when the tab closes.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Tab } from '../../src/renderer/types'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useTabSubTabStore } from '../../src/renderer/stores/tab-subtab.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import RequestEditor from '../../src/renderer/components/request/RequestEditor'
import SoapEditor from '../../src/renderer/components/protocols/SoapEditor'

function tab(id: string, protocol: Tab['protocol'] = 'http'): Tab {
  return { id, name: id, protocol, isDirty: false, isLoading: false } as Tab
}

/** Mirrors Workbench: the editor is keyed by the active tab id. */
function Editor() {
  const activeTabId = useTabsStore((s) => s.activeTabId)
  return <RequestEditor key={activeTabId ?? 'none'} />
}

function switchTo(id: string): void {
  act(() => useTabsStore.getState().setActiveTab(id))
}

/** The Body tab content (its body-type picker) is on screen. */
function bodyShown(): boolean {
  return screen.queryAllByTestId(/^body-type-/).length > 0
}

function activeKey(): string | null {
  const active = document.querySelector('[data-testid^="req-tab-"][data-active="true"]')
  return active?.getAttribute('data-testid')?.replace('req-tab-', '') ?? null
}

beforeEach(() => {
  mockWindowApi()
  setLocale('en')
  useTabSubTabStore.setState({ byTab: {} })
  useTabsStore.setState({ tabs: [tab('A'), tab('B')], activeTabId: 'A' })
})

afterEach(() => {
  cleanup()
})

describe('RequestEditor sub-tab per open tab (issue #205)', () => {
  it('A on Body, switch to B, back to A — Body is still selected', () => {
    render(<Editor />)
    fireEvent.click(screen.getByTestId('req-tab-body'))
    expect(bodyShown()).toBe(true)

    switchTo('B')
    expect(bodyShown()).toBe(false)
    expect(activeKey()).toBe('params')

    switchTo('A')
    expect(bodyShown()).toBe(true)
    expect(activeKey()).toBe('body')
  })

  it('each tab keeps its own choice', () => {
    render(<Editor />)
    fireEvent.click(screen.getByTestId('req-tab-body'))
    switchTo('B')
    fireEvent.click(screen.getByTestId('req-tab-headers'))
    switchTo('A')
    expect(activeKey()).toBe('body')
    switchTo('B')
    expect(activeKey()).toBe('headers')
  })

  it('a newly opened tab starts on Params', () => {
    render(<Editor />)
    fireEvent.click(screen.getByTestId('req-tab-body'))
    act(() =>
      useTabsStore
        .getState()
        .openTab({ id: 'C', name: 'C', protocol: 'http' } as Omit<Tab, 'isDirty' | 'isLoading'>),
    )
    expect(useTabsStore.getState().activeTabId).toBe('C')
    expect(activeKey()).toBe('params')
    expect(bodyShown()).toBe(false)
  })

  it('closing a tab forgets its sub-tab — reopening the same id starts on Params', () => {
    render(<Editor />)
    fireEvent.click(screen.getByTestId('req-tab-body'))
    expect(useTabSubTabStore.getState().byTab.A).toEqual({ request: 'body' })

    act(() => useTabsStore.getState().closeTab('A'))
    expect(useTabSubTabStore.getState().byTab.A).toBeUndefined()

    act(() =>
      useTabsStore
        .getState()
        .openTab({ id: 'A', name: 'A', protocol: 'http' } as Omit<Tab, 'isDirty' | 'isLoading'>),
    )
    switchTo('A')
    expect(activeKey()).toBe('params')
  })

  it('closeAllTabs forgets every tab', () => {
    useTabSubTabStore.getState().setSubTab('A', 'request', 'body')
    useTabSubTabStore.getState().setSubTab('B', 'request', 'auth')
    useTabsStore.getState().closeAllTabs()
    expect(useTabSubTabStore.getState().byTab).toEqual({})
  })

  it('a stored value that is not a request sub-tab falls back to Params', () => {
    useTabSubTabStore.getState().setSubTab('A', 'request', 'not-a-tab')
    render(<Editor />)
    expect(activeKey()).toBe('params')
  })
})

describe('SoapEditor detail tab per open tab (issue #205)', () => {
  function soapActive(): string | null {
    const el = document.querySelector('[data-testid^="soap-detail-tab-"][data-active="true"]')
    return el?.getAttribute('data-testid')?.replace('soap-detail-tab-', '') ?? null
  }

  it('A on Headers, switch to B, back to A — Headers is still selected', () => {
    useTabsStore.setState({ tabs: [tab('A', 'soap'), tab('B', 'soap')], activeTabId: 'A' })
    function Soap() {
      const activeTabId = useTabsStore((s) => s.activeTabId)
      return <SoapEditor key={activeTabId ?? 'none'} />
    }
    render(<Soap />)
    expect(soapActive()).toBe('body')
    fireEvent.click(screen.getByTestId('soap-detail-tab-headers'))
    expect(soapActive()).toBe('headers')

    switchTo('B')
    expect(soapActive()).toBe('body')

    switchTo('A')
    expect(soapActive()).toBe('headers')
    // Its own scope — the HTTP request editor's choice is not touched.
    expect(useTabSubTabStore.getState().byTab.A).toEqual({ soap: 'headers' })
  })
})
