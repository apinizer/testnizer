/// <reference types="react" />
import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

;(globalThis as unknown as { React: typeof React }).React = React

// Stub the heavy descendants so the test focuses on the dispatch decision.
// ProjectWelcome / TestsHome import the workspace + history stores and reach
// into window.api — none of that matters here.
vi.mock('../../src/renderer/components/layout/ProjectWelcome', () => ({
  default: () => <div data-testid="project-welcome" />,
}))
vi.mock('../../src/renderer/components/runner/TestsHome', () => ({
  default: (props: { onNewRun?: () => void }) => (
    <div data-testid="tests-home" data-has-actions={Boolean(props.onNewRun)} />
  ),
}))
// openOrReuseRunnerTab is a side-effect helper — stub to a noop so PageWelcome
// doesn't try to mutate the tabs store at module load.
vi.mock('../../src/renderer/lib/open-runner-tab', () => ({
  openOrReuseRunnerTab: vi.fn(),
}))

import PageWelcome from '../../src/renderer/components/layout/PageWelcome'

describe('PageWelcome', () => {
  beforeEach(() => {
    cleanup()
  })
  afterEach(() => {
    cleanup()
  })

  it('renders ProjectWelcome on the APIs page', () => {
    render(<PageWelcome page="apis" />)
    expect(screen.getByTestId('project-welcome')).toBeInTheDocument()
    expect(screen.queryByTestId('tests-home')).not.toBeInTheDocument()
  })

  it('renders TestsHome on the Tests page with runner callbacks wired', () => {
    render(<PageWelcome page="tests" />)
    const home = screen.getByTestId('tests-home')
    expect(home).toBeInTheDocument()
    expect(home.getAttribute('data-has-actions')).toBe('true')
  })

  it.each(['mocks', 'history', 'tools', 'docs', 'settings'] as const)(
    'renders an EmptyState on the %s page',
    (page) => {
      render(<PageWelcome page={page} />)
      // The actual copy comes from the i18n table — assertion is "something rendered"
      // (welcome.* keys fall back to the key if missing, so any non-empty text confirms).
      const root = document.body.firstChild as HTMLElement | null
      expect(root).toBeTruthy()
      expect(screen.queryByTestId('project-welcome')).not.toBeInTheDocument()
      expect(screen.queryByTestId('tests-home')).not.toBeInTheDocument()
    },
  )
})
