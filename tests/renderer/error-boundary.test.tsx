/// <reference types="react" />
import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ErrorBoundary } from '../../src/renderer/components/shared/ErrorBoundary'

;(globalThis as unknown as { React: typeof React }).React = React

// Stable marker rendered by the boundary's recovery panel (ErrorBoundary.tsx).
const RECOVERY_MARKER = 'Testnizer hit a render error'

/** A child that throws during render on demand. */
function Boom({ crash }: { crash: boolean }): React.ReactElement {
  if (crash) throw new Error('screen exploded on mount')
  return <div data-testid="healthy-screen">healthy</div>
}

describe('ErrorBoundary', () => {
  // React logs caught render errors to console.error — silence it so the test
  // output stays clean without hiding real failures.
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errSpy.mockRestore()
    cleanup()
  })

  // ── Root usage (main.tsx) ──────────────────────────────────────────────
  it('shows the recovery panel when a child throws (root usage)', () => {
    render(
      <ErrorBoundary>
        <Boom crash />
      </ErrorBoundary>,
    )
    expect(screen.getByText(RECOVERY_MARKER)).toBeInTheDocument()
    // Recovery affordances the panel promises.
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.queryByTestId('healthy-screen')).not.toBeInTheDocument()
  })

  it('renders children untouched when nothing throws (root usage)', () => {
    render(
      <ErrorBoundary>
        <Boom crash={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('healthy-screen')).toBeInTheDocument()
    expect(screen.queryByText(RECOVERY_MARKER)).not.toBeInTheDocument()
  })

  // ── Content-region usage (Workbench) ───────────────────────────────────
  it('contains a screen throw to its pane without unmounting a sibling frame element', () => {
    // Mirror the Workbench layout: an app "frame" element sits as a SIBLING of
    // the content-region boundary. A render-throw inside the boundary must not
    // take the frame down with it.
    render(
      <div>
        <div data-testid="app-frame">header / tabs / tree / footer</div>
        <ErrorBoundary variant="inline" resetKey="tab-1">
          <Boom crash />
        </ErrorBoundary>
      </div>,
    )
    // The crashed screen is contained: recovery panel is showing…
    expect(screen.getByText(RECOVERY_MARKER)).toBeInTheDocument()
    // …but the sibling frame is still mounted and usable.
    expect(screen.getByTestId('app-frame')).toBeInTheDocument()
    expect(screen.queryByTestId('healthy-screen')).not.toBeInTheDocument()
  })

  it('auto-recovers when resetKey changes (switching to a healthy tab)', () => {
    const { rerender } = render(
      <ErrorBoundary variant="inline" resetKey="tab-1">
        <Boom crash />
      </ErrorBoundary>,
    )
    // Broken tab → recovery panel.
    expect(screen.getByText(RECOVERY_MARKER)).toBeInTheDocument()

    // User switches to a different, healthy tab: resetKey flips and the child
    // no longer throws. The boundary clears itself and renders the new screen.
    rerender(
      <ErrorBoundary variant="inline" resetKey="tab-2">
        <Boom crash={false} />
      </ErrorBoundary>,
    )
    expect(screen.queryByText(RECOVERY_MARKER)).not.toBeInTheDocument()
    expect(screen.getByTestId('healthy-screen')).toBeInTheDocument()
  })

  it('stays latched when resetKey is unchanged (root boundary keeps its panel)', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Boom crash />
      </ErrorBoundary>,
    )
    expect(screen.getByText(RECOVERY_MARKER)).toBeInTheDocument()
    // Re-render with the same (absent) resetKey and a now-healthy child: the
    // root boundary must NOT silently swap back — it waits for an explicit
    // Reload, exactly as before this change.
    rerender(
      <ErrorBoundary>
        <Boom crash={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText(RECOVERY_MARKER)).toBeInTheDocument()
    expect(screen.queryByTestId('healthy-screen')).not.toBeInTheDocument()
  })
})
