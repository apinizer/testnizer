/**
 * RunnerTab wiring of the Run-results folder icon (issue #115 follow-up).
 *
 * RunnerTab used to pass no reveal handler at all when the run came from a
 * test suite (`runOrigin === 'suite' ? undefined : …`), so suite runs had no
 * icon. A RunnerResults-only test cannot see that line; this one mounts the
 * real RunnerTab on a restored suite run and checks the icon is there, labelled
 * for the Tests sidebar, and an APIs run keeps "Reveal in APIs".
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Permissive bridge: every `window.api.<ns>.<method>()` resolves `{success,data:null}`
// (stores read some namespaces at module-eval time — see screens/runner-frame-screens).
vi.hoisted(() => {
  const ns = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === 'then'
          ? undefined
          : (..._a: unknown[]) => Promise.resolve({ success: true, data: null }),
    },
  )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : ns) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
})

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import RunnerTab from '../../src/renderer/components/runner/RunnerTab'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { runnerKey } from '../../src/renderer/lib/runner-storage'
import type { EndpointRunResult } from '../../src/shared/runner-types'

const TAB = 'runner-wiring'

const RESULT = {
  endpointId: 'item-1',
  endpointName: 'Refund payment',
  method: 'POST',
  url: 'http://x/refund',
  status: 200,
  statusText: 'OK',
  duration: 5,
  passed: 1,
  failed: 0,
  skipped: 0,
  assertions: [],
} as unknown as EndpointRunResult

/** Restore a finished run on the results view, as a tab switch back would. */
function seedRun(scope: { sourceType: string; suiteId?: string }): void {
  sessionStorage.setItem(runnerKey('view', TAB)!, 'results')
  sessionStorage.setItem(
    runnerKey('run-data', TAB)!,
    JSON.stringify({ results: [RESULT], report: null, startedAt: 1 }),
  )
  sessionStorage.setItem(runnerKey('report', TAB)!, JSON.stringify(scope))
  // The payload's one-shot intent is already spent (no sessionKey → token '').
  sessionStorage.setItem(runnerKey('report-spent', TAB)!, '')
}

beforeEach(() => {
  sessionStorage.clear()
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
  useUIStore.getState().setLocale('en')
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe('RunnerTab — Run-results folder icon', () => {
  it('a suite run offers it, labelled "Reveal in Tests"', async () => {
    seedRun({ sourceType: 'suite', suiteId: 'suite-1' })
    render(<RunnerTab tabId={TAB} />)
    const icon = await screen.findByTestId('runner-reveal-item-1')
    expect(icon.getAttribute('title')).toBe('Reveal in Tests')
  })

  it('an APIs run keeps "Reveal in APIs"', async () => {
    seedRun({ sourceType: 'apis' })
    render(<RunnerTab tabId={TAB} />)
    const icon = await screen.findByTestId('runner-reveal-item-1')
    expect(icon.getAttribute('title')).toBe('Reveal in APIs')
  })
})
