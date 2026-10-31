/**
 * 1.6.0 screen review G-16 (issue #255 follow-up) — at 1024x700 in Schedule
 * mode the Runner config column overflowed horizontally: the Run Sequence pane
 * kept its full stored width (`flexShrink: 0`), so the config column got
 * ~230 px; the three delay fields squeezed side by side, the interval row ran
 * past the box, and the footer's "Save configuration" was clipped at the right
 * edge with both labels wrapped onto two lines.
 *
 * jsdom has no layout, so this pins the structure that produces the layout
 * (the 1024x700 geometry is asserted by tests/e2e/ui/tur1/18-runner-report.spec.ts
 * "MST-255 narrow"):
 *  - the sequence pane shrinks first (`flex: 0 1 <w>px`, min 200 px) while the
 *    config column keeps a floor (`RUNNER_CONFIG_MIN_WIDTH`) — RunnerTab uses
 *    the shared `sequencePaneStyle` / `CONFIG_PANE_CLASS`;
 *  - RunnerConfig's root may shrink (`min-w-0`), its body keeps `overflow-auto`
 *    (MST-255 finds it by that class) and gets a testid;
 *  - Iterations / delays sit in an auto-fit grid (one column when narrow);
 *  - the interval row wraps; labels do not split ("Run every");
 *  - the action bar wraps (`flex-wrap`) and its buttons never shrink or wrap.
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import RunnerConfig from '../../src/renderer/components/runner/RunnerConfig'
import * as layout from '../../src/renderer/components/runner/runner-layout'
;(globalThis as unknown as { React: typeof React }).React = React

const noop = (): void => {}
const cls = (el: Element): string[] => el.className.split(/\s+/)

function renderConfig(): void {
  render(
    <RunnerConfig
      delay={0}
      setDelay={noop}
      iterationDelay={0}
      setIterationDelay={noop}
      iterations={1}
      setIterations={noop}
      environmentId=""
      setEnvironmentId={noop}
      stopOnError
      setStopOnError={noop}
      persistResponses
      setPersistResponses={noop}
      keepVariableValues
      setKeepVariableValues={noop}
      iterationData={[]}
      setIterationData={noop}
      runPreScript=""
      setRunPreScript={noop}
      runPostScript=""
      setRunPostScript={noop}
      runFailScript=""
      setRunFailScript={noop}
      onRun={noop}
      onSchedule={noop}
      isRunning={false}
      selectedCount={2}
      canSchedule
      onSaveConfig={async () => true}
    />,
  )
  act(() => {
    fireEvent.click(screen.getByLabelText(/Schedule runs/i))
  })
}

afterEach(cleanup)

describe('G-16 — RunnerTab panes: the sequence pane gives way first', () => {
  it('shared layout helpers', () => {
    const style = layout.sequencePaneStyle(360)
    expect(style.flex).toBe('0 1 360px')
    expect(style.minWidth).toBe(layout.RUNNER_SEQUENCE_MIN_WIDTH)
    expect(style.flexShrink).toBeUndefined()
    expect(layout.RUNNER_SEQUENCE_MIN_WIDTH).toBeLessThanOrEqual(200)
    expect(layout.RUNNER_CONFIG_MIN_WIDTH).toBeGreaterThanOrEqual(280)
    // A 900 px window: 900 - 83 icon bar - 300 left panel - 40 right rail = 477 px
    // for both panes + the 4 px divider. Both floors must fit, or the outer
    // overflow-hidden clips the config column one size down.
    expect(
      layout.RUNNER_SEQUENCE_MIN_WIDTH + 4 + layout.RUNNER_CONFIG_MIN_WIDTH,
    ).toBeLessThanOrEqual(477)
    expect(cls({ className: layout.CONFIG_PANE_CLASS } as Element)).toEqual(
      expect.arrayContaining(['flex', 'flex-1', 'overflow-hidden']),
    )
  })

  it('RunnerTab uses them (no fixed, non-shrinking sequence width)', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/renderer/components/runner/RunnerTab.tsx'),
      'utf8',
    )
    expect(src).toMatch(/style=\{sequencePaneStyle\(sequenceWidth\)\}/)
    expect(src).toMatch(/className=\{CONFIG_PANE_CLASS\}/)
    expect(src).toMatch(/style=\{\{ minWidth: RUNNER_CONFIG_MIN_WIDTH \}\}/)
    expect(src).not.toMatch(/width: sequenceWidth, flexShrink: 0/)
    expect(src).toMatch(/data-testid="runner-sequence-pane"/)
    expect(src).toMatch(/data-testid="runner-config-pane"/)
  })
})

describe('G-16 — RunnerConfig never needs a horizontal scrollbar', () => {
  it('root may shrink; body keeps overflow-auto and has a testid', () => {
    renderConfig()
    const body = screen.getByTestId('runner-config-body')
    expect(cls(body)).toContain('overflow-auto')
    expect(cls(body)).toContain('min-w-0')
    expect(cls(body.parentElement as Element)).toContain('min-w-0')
  })

  it('iterations and delays: an auto-fit grid that collapses to one column', () => {
    renderConfig()
    const grid = screen.getByTestId('runner-run-config-grid')
    expect(cls(grid)).toContain('grid')
    expect(grid.className).toMatch(/grid-cols-\[repeat\(auto-fit,minmax\(/)
    for (const child of Array.from(grid.children)) expect(cls(child)).toContain('min-w-0')
    expect(grid).toContainElement(screen.getByTestId('runner-iterations'))
    expect(grid).toContainElement(screen.getByTestId('runner-iteration-delay'))
  })

  it('the interval row wraps instead of running past the box', () => {
    renderConfig()
    const row = screen.getByTestId('runner-schedule-interval')
    expect(cls(row)).toContain('flex-wrap')
    const label = row.firstElementChild as HTMLElement
    expect(cls(label)).toContain('whitespace-nowrap')
  })

  it('the action bar wraps; its buttons keep one line and never shrink', () => {
    renderConfig()
    const bar = screen.getByTestId('runner-action-bar')
    expect(cls(bar)).toContain('flex-wrap')
    for (const id of ['runner-start', 'runner-save-config']) {
      const b = screen.getByTestId(id)
      expect(cls(b), id).toContain('whitespace-nowrap')
      expect(cls(b), id).toContain('shrink-0')
    }
  })
})
