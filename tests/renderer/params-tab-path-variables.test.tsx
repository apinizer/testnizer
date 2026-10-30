/**
 * Issue #276 — the Params tab's Path Variables table: shown only when the URL
 * has `:name` segments, rows follow the URL, value + description editable.
 */
import React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ParamsTab from '../../src/renderer/components/request/ParamsTab'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Tab } from '../../src/renderer/types'

beforeEach(() => {
  useTabsStore.setState({
    tabs: [
      { id: 't1', name: 'T', protocol: 'http', method: 'GET', url: '', isDirty: false } as Tab,
    ],
    activeTabId: 't1',
  })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useRequestStore.getState().switchToTab('t1')
})

describe('issue #276 — Path Variables table', () => {
  it('appears with the URL, edits the store, disappears without :name', () => {
    render(<ParamsTab />)
    expect(screen.queryByTestId('path-variables')).toBeNull()

    act(() => useRequestStore.getState().setUrl('https://x.test/users/:id/posts/:postId'))
    expect(screen.getByTestId('path-variables')).toBeTruthy()
    expect(screen.getByTestId('path-var-row-id')).toBeTruthy()
    expect(screen.getByTestId('path-var-row-postId')).toBeTruthy()

    const row = screen.getByTestId('path-var-row-id')
    const value = row.querySelector('[data-testid="path-var-value"] input, input[data-testid="path-var-value"]') as HTMLInputElement
    fireEvent.change(value, { target: { value: '{{uid}}' } })
    const desc = row.querySelector('[data-testid="path-var-description"]') as HTMLInputElement
    fireEvent.change(desc, { target: { value: 'user id' } })
    expect(useRequestStore.getState().pathVariables[0]).toMatchObject({
      key: 'id',
      value: '{{uid}}',
      description: 'user id',
    })

    act(() => useRequestStore.getState().setUrl('https://x.test/users'))
    expect(screen.queryByTestId('path-variables')).toBeNull()
  })
})
