/**
 * Issue #276 — a Test Suite item tab resolves `inherit` through the SUITE's
 * folders on Send and in Generate Code, like Run (`buildSuiteFolderChain`).
 *
 * A suite built from an imported folder keeps the collection auth on a
 * mirrored suite folder and its items as `inherit`. The renderer resolver only
 * knew endpoints and saved requests, so Send from the Tests panel (and the
 * snippet) fell through to the project auth — Run sent the header, Send did not.
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useGeneratedCode } from '../../src/renderer/components/shared/use-generated-code'
import type { Tab } from '../../src/renderer/types'

void React
const ok = (data: unknown) => ({ success: true, data })
let sentAuth: unknown[] = []

beforeEach(() => {
  sentAuth = []
  ;(window as unknown as { api: unknown }).api = {
    request: {
      send: vi.fn(async (opts: { auth?: unknown }) => {
        sentAuth.push(opts.auth)
        return ok({ requestId: 'r', protocol: 'http', status: 200, headers: {}, body: '', timing: { total: 1 } })
      }),
      cancel: vi.fn(),
    },
    settings: { get: vi.fn(async () => ok({})) },
    testSuiteItem: { get: vi.fn(async () => ok({ id: 'it1', suite_id: 's1', folder_id: 'sf2' })) },
    testSuite: {
      listEndpoints: vi.fn(async () =>
        ok({
          items: [],
          folders: [
            {
              id: 'sf1',
              parent_id: null,
              name: 'Imported',
              auth: JSON.stringify({ type: 'bearer', bearer: { token: 'SUITE-TOKEN' } }),
            },
            { id: 'sf2', parent_id: 'sf1', name: 'Sub', auth: null },
          ],
        }),
      ),
    },
  }
  useWorkspaceStore.setState({ activeProjectId: 'p1' })
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    environments: [],
    globalVariables: [],
    activeEnvironmentId: null,
  })
  useResponseStore.setState({ response: null, isLoading: false })
  useTabsStore.setState({
    tabs: [
      {
        id: 'st',
        name: 'deep',
        protocol: 'http',
        method: 'GET',
        url: 'https://api.test/deep',
        isDirty: false,
        testSuiteItemId: 'it1',
      } as Tab,
    ],
    activeTabId: 'st',
  })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useRequestStore.getState().switchToTab('st')
  useRequestStore
    .getState()
    .loadFromEndpoint({ method: 'GET', url: 'https://api.test/deep', auth: { type: 'inherit' } })
})

describe('issue #276 — suite item tab: inherited auth from the suite folders', () => {
  it('Send sends the suite folder auth', async () => {
    await useRequestStore.getState().sendRequest()
    expect(sentAuth[0]).toMatchObject({ type: 'bearer', bearer: { token: 'SUITE-TOKEN' } })
  })

  it('Generate Code shows it', async () => {
    const { result } = renderHook(() => useGeneratedCode('curl', true))
    await waitFor(() => expect(result.current.code).toContain('Authorization: Bearer SUITE-TOKEN'))
  })
})
