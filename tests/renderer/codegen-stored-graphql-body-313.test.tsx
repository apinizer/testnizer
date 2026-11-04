/**
 * Issue #313 — "Cannot read properties of undefined (reading 'query')".
 *
 * A saved GraphQL row stores `{type:'graphql', content: query}`
 * (`snapshotProtocol`), and that is what `request.store` holds for its tab.
 * `useCodegenSource` reads the protocol from the tabs store and the body from
 * `request.store`, so once the active tab has moved on — Cmd+W and bulk close
 * flip the stores in a later effect, closing the last tab never does — the
 * HTTP branch gets the stored shape. `resolveBody` assumed the GraphQL tab's
 * `{graphql:{query,variables}}` and threw during render. The modal computed
 * its snippet even while hidden, so it did not need to be open.
 */
import * as React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('pre', { 'data-testid': 'monaco' }, value),
}))

import CodeGeneratorModal from '../../src/renderer/components/modals/CodeGeneratorModal'
import GenerateCodePane from '../../src/renderer/components/layout/GenerateCodePane'
import { generateSnippet } from '../../src/renderer/lib/code-generator'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { RequestBody, Tab } from '../../src/renderer/types'

const STORED_BODY = { type: 'graphql', content: 'query { me { id } }' } as RequestBody
const curl = 'curl'

/** A saved GraphQL tab (active), its body in `request.store`, and an HTTP tab next to it. */
function openSavedGraphqlTab(withHttpNeighbour: boolean): void {
  useTabsStore.setState({
    tabs: [
      { id: 'gql', name: 'Q', protocol: 'graphql', endpointId: 'e1', isDirty: false } as Tab,
      ...(withHttpNeighbour ? [{ id: 'h', name: 'H', protocol: 'http', isDirty: false } as Tab] : []),
    ],
    activeTabId: 'gql',
  })
  useRequestStore.setState({ method: 'POST', url: 'https://x.test/graphql', body: STORED_BODY })
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    settings: { get: vi.fn(async () => ({ success: true, data: undefined })) },
    folder: { list: vi.fn(async () => ({ success: true, data: [] })) },
  }
  useUIStore.setState({ showCodeGenerator: false })
})
afterEach(() => {
  cleanup()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({ body: { type: 'none' } })
})

describe('issue #313 — a stored GraphQL body in Generate Code', () => {
  it('renders the stored query instead of throwing', () => {
    const code = generateSnippet(
      curl,
      { method: 'POST', url: 'https://x.test/graphql', params: [], headers: [], body: STORED_BODY },
      { envVars: {}, includeSecrets: false },
    )
    expect(code).toContain('query { me { id } }')
  })

  it('resolves {{var}} in the stored query, like the GraphQL tab shape', () => {
    const code = generateSnippet(
      curl,
      {
        method: 'POST',
        url: 'https://x.test/graphql',
        params: [],
        headers: [],
        body: { type: 'graphql', content: 'query { user(id: "{{id}}") }' } as RequestBody,
      },
      { envVars: { id: '42' } },
    )
    expect(code).toContain('user(id:')
    expect(code).toContain('42')
  })

  it.each([
    ['closing it with an HTTP tab next to it (Cmd+W / bulk close)', true],
    ['closing the last tab', false],
  ])('hidden modal survives %s', (_name, neighbour) => {
    openSavedGraphqlTab(neighbour)
    render(<CodeGeneratorModal />)
    act(() => useTabsStore.getState().closeTab('gql'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each([
    ['open modal', () => useUIStore.setState({ showCodeGenerator: true }), CodeGeneratorModal],
    ['right panel Code pane', () => undefined, GenerateCodePane],
  ])('%s survives the tab change', (_name, arrange, Surface) => {
    openSavedGraphqlTab(true)
    arrange()
    render(<Surface />)
    act(() => useTabsStore.getState().closeTab('gql'))
    expect(screen.getAllByTestId('monaco')[0].textContent).toContain('me { id }')
  })
})

describe('issue #313 — the hidden modal does no work', () => {
  it('does not resolve inheritance while closed', () => {
    const get = vi.fn(async () => ({ success: true, data: undefined }))
    ;(window as unknown as { api: unknown }).api = { settings: { get } }
    useRequestStore.setState({ auth: { type: 'inherit' } })
    render(<CodeGeneratorModal />)
    expect(get).not.toHaveBeenCalled()
    useRequestStore.setState({ auth: { type: 'none' } })
  })
})
