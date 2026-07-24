/**
 * Reusable smoke-render harness for renderer "screens".
 *
 * Goal: turn a screen that throws on mount (or white-screens the whole app)
 * into a RED test instead of a shipped regression. Testnizer is a live app
 * with 600+ users; the renderer is UI-only and every network/DB call goes
 * through the MOCKED `window.api` bridge in tests.
 *
 * The core assertion wraps the component under test in the REAL production
 * `ErrorBoundary` (the same one wired around <App/> in main.tsx). If the child
 * throws during render, the boundary swallows the throw and swaps in its
 * recovery panel — so `render()` itself does NOT throw. We detect that swap by
 * asserting the recovery panel's stable marker text is absent AND that the
 * render produced meaningful DOM. A component that bails early to `null` would
 * leave an empty container and fail here too — a smoke test that silently
 * passes on an empty screen is worthless.
 */
import * as React from 'react'
import { expect } from 'vitest'
import { render, within } from '@testing-library/react'
import { ErrorBoundary } from '../../../src/renderer/components/shared/ErrorBoundary'

// The recovery panel's headline (ErrorBoundary.tsx). Stable across redeploys —
// if it ever changes, this harness must change with it.
const ERROR_BOUNDARY_MARKER = 'Testnizer hit a render error'

/**
 * Render `ui` inside the real ErrorBoundary and assert it mounted cleanly:
 *   (a) render did not surface the boundary's recovery panel (no render throw),
 *   (b) the component produced non-empty DOM.
 *
 * Portal-aware: Radix-based modals render their content through a React portal
 * into `document.body` (the RTL `baseElement`), NOT into the in-tree `container`.
 * A clean modal therefore leaves `container` empty even though it rendered a full
 * screen. So the "meaningful DOM" check accepts EITHER in-container output OR a
 * populated portal sibling in `baseElement`. Throw-detection is unaffected: a
 * render-throw from inside a portal still unwinds to the nearest React-tree error
 * boundary (portals don't change error bubbling), and the boundary renders its
 * recovery panel into `container` — so the marker query below still catches it.
 */
export function mountsWithoutCrash(ui: React.ReactElement): void {
  const { container, baseElement } = render(<ErrorBoundary>{ui}</ErrorBoundary>)
  // If the child threw, the boundary rendered its recovery panel (into container,
  // even for a portalled child). Scope to baseElement so it's found either way.
  expect(
    within(baseElement).queryByText(ERROR_BOUNDARY_MARKER),
    'Screen threw on mount — ErrorBoundary recovery panel is showing',
  ).toBeNull()
  // Something meaningful must have rendered (guards a component that bails to
  // null). Inline screens fill `container`; portalled modals fill a sibling of
  // `container` inside `baseElement`.
  const portalRendered = Array.from(baseElement.children).some(
    (el) => el !== container && el.childNodes.length > 0,
  )
  expect(
    container.hasChildNodes() || portalRendered,
    'Screen produced no DOM (bailed to null?) — neither container nor a portal rendered',
  ).toBe(true)
}

// ─── window.api mock ─────────────────────────────────────────────────────────
// A realistic bridge: any namespace method resolves to a `{success,data}`
// envelope by default; subscription methods (`on*`) return an unsubscribe fn.
// Built with Proxies so tests never have to enumerate the (large) real surface.

type ApiEnvelope = { success: boolean; data?: unknown; error?: string }

function makeMethod(name: string): unknown {
  // Event subscriptions are synchronous and return an unsubscribe function.
  if (name.startsWith('on')) return (..._args: unknown[]) => () => {}
  return (..._args: unknown[]): Promise<ApiEnvelope> => Promise.resolve({ success: true, data: null })
}

function makeNamespace(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined
        // Never look thenable — some call sites `await window.api.x` a namespace.
        if (prop === 'then') return undefined
        return makeMethod(prop)
      },
    },
  )
}

/**
 * Install a mock `window.api` onto the global. `overrides` maps a namespace
 * name to a concrete stub object that fully replaces the auto-generated one
 * (use it when a screen needs a specific return shape at mount).
 */
export function mockWindowApi(overrides: Record<string, unknown> = {}): unknown {
  const api = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined
        if (prop === 'then') return undefined
        if (Object.prototype.hasOwnProperty.call(overrides, prop)) return overrides[prop]
        return makeNamespace()
      },
    },
  )
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
  return api
}
