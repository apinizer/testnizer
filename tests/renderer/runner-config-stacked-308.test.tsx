/**
 * Issue #308 — below the width where Run Sequence and the config column both
 * fit, the Runner config view stacks them (sequence on top, config below)
 * instead of squeezing both side by side.
 *
 * The decision is keyed on the MEASURED width of the split itself
 * (`runner-config-split`, ResizeObserver `contentRect.width`), like the #251
 * narrow-editor rules — not on the window. jsdom has no layout, so the width
 * is reported through a fake ResizeObserver (same pattern as
 * right-panel-auto-collapse-251.test.tsx).
 *
 * Single owner: `src/renderer/components/runner/runner-layout.ts`
 * (`RUNNER_STACK_BELOW`, `runnerSplitLayout`).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import RunnerConfig from '../../src/renderer/components/runner/RunnerConfig'
import RunnerSequence from '../../src/renderer/components/runner/RunnerSequence'
import RunnerConfigSplit from '../../src/renderer/components/runner/RunnerConfigSplit'
import * as layout from '../../src/renderer/components/runner/runner-layout'
import type { RunnerEndpointItem } from '../../src/renderer/components/runner/RunnerTab'
;(globalThis as unknown as { React: typeof React }).React = React

type Cb = (
  entries: Array<{ target: Element; contentRect: { width: number; height: number } }>,
) => void
const observers: Array<{ cb: Cb; els: Set<Element> }> = []

class FakeResizeObserver {
  private rec: { cb: Cb; els: Set<Element> }
  constructor(cb: Cb) {
    this.rec = { cb, els: new Set() }
    observers.push(this.rec)
  }
  observe(el: Element): void {
    this.rec.els.add(el)
  }
  unobserve(el: Element): void {
    this.rec.els.delete(el)
  }
  disconnect(): void {
    this.rec.els.clear()
  }
}

function resize(el: Element, width: number): void {
  act(() => {
    for (const o of observers) {
      if (o.els.has(el)) o.cb([{ target: el, contentRect: { width, height: 600 } }])
    }
  })
}

const noop = (): void => {}
const cls = (el: Element): string[] => el.className.split(/\s+/)

const endpoints: RunnerEndpointItem[] = [
  { id: 'a', name: 'New Request', method: 'GET', url: 'http://x/a', selected: true },
  { id: 'b', name: 'New Request', method: 'GET', url: 'http://x/b', selected: true },
]

function renderSplit(): HTMLElement {
  render(
    <RunnerConfigSplit
      sequenceWidth={360}
      divider={<div data-testid="runner-split-divider" />}
      sequence={
        <RunnerSequence
          endpoints={endpoints}
          folderGroups={[]}
          onToggle={noop}
          onSelectAll={noop}
          onDeselectAll={noop}
          onReset={noop}
          onSetPhase={noop}
        />
      }
      config={
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
        />
      }
    />,
  )
  return screen.getByTestId('runner-config-split')
}

beforeEach(() => {
  observers.length = 0
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
})

afterEach(cleanup)

/*
 * Space the split gets at the app's minimum window (src/main/index.ts
 * minWidth 900) with the left sidebar open at its default 300 px and the
 * Runner's Variables panel on its 40 px rail: 900 - 83 icon bar - 300 - 40.
 */
const MIN_WINDOW_SPLIT_PX = 900 - 83 - 300 - 40
/** Same at the 1024 px window of screen-tour shot 306 / MST-255 narrow. */
const W1024_SPLIT_PX = 1024 - 83 - 300 - 40

describe('#308 runner-layout: one threshold, derived from named pieces', () => {
  it('stacks below RUNNER_STACK_BELOW, side by side at/above it, side when unmeasured', () => {
    const t = layout.RUNNER_STACK_BELOW
    expect(t).toBe(
      layout.RUNNER_SEQUENCE_SIDE_MIN_PX +
        layout.RUNNER_SPLIT_DIVIDER_PX +
        layout.RUNNER_CONFIG_MIN_WIDTH,
    )
    expect(layout.runnerSplitLayout(t - 1)).toBe('stacked')
    expect(layout.runnerSplitLayout(t)).toBe('side')
    expect(layout.runnerSplitLayout(1400)).toBe('side')
    for (const unmeasured of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(layout.runnerSplitLayout(unmeasured), String(unmeasured)).toBe('side')
    }
  })

  it('the minimum window and the 1024 px window of the issue screenshot stack', () => {
    expect(layout.runnerSplitLayout(MIN_WINDOW_SPLIT_PX)).toBe('stacked')
    expect(layout.runnerSplitLayout(W1024_SPLIT_PX)).toBe('stacked')
  })
})

describe('#308 RunnerConfigSplit: stacked below the threshold', () => {
  it('unmeasured → side by side with the divider (G-16 layout unchanged)', () => {
    const split = renderSplit()
    expect(split.getAttribute('data-layout')).toBe('side')
    expect(cls(split)).not.toContain('flex-col')
    expect(screen.getByTestId('runner-split-divider')).toBeTruthy()
  })

  it('at the minimum window width: stacked, no divider, no min-width wider than the split', () => {
    const split = renderSplit()
    resize(split, MIN_WINDOW_SPLIT_PX)
    expect(split.getAttribute('data-layout')).toBe('stacked')
    expect(cls(split)).toContain('flex-col')
    expect(screen.queryByTestId('runner-split-divider')).toBeNull()

    const seq = screen.getByTestId('runner-sequence-pane')
    const cfg = screen.getByTestId('runner-config-pane')
    // Sequence on top, config below — both full width of the split.
    expect(split.firstElementChild).toBe(seq)
    expect(split.lastElementChild).toBe(cfg)
    // No inline px floor survives into stacked mode (the 280 px config floor
    // would clip on a 252 px split with the Variables panel open).
    expect(seq.style.minWidth).toBe('')
    expect(seq.style.flex).toBe('')
    expect(cfg.style.minWidth).toBe('')
    // The sequence takes a bounded share of the height; config gets the rest.
    expect(cls(seq)).toEqual(expect.arrayContaining(['shrink-0', 'overflow-hidden']))
    expect(seq.className).toMatch(/max-h-\[/)
    expect(cls(cfg)).toEqual(
      expect.arrayContaining(['flex', 'min-h-0', 'flex-1', 'overflow-hidden']),
    )
  })

  it('wide again → side by side; the sequence pane gets its G-16 flex basis back', () => {
    const split = renderSplit()
    resize(split, MIN_WINDOW_SPLIT_PX)
    resize(split, 1000)
    expect(split.getAttribute('data-layout')).toBe('side')
    const seq = screen.getByTestId('runner-sequence-pane')
    expect(seq.style.flex).toBe('0 1 360px')
    expect(seq.style.minWidth).toBe(`${layout.RUNNER_SEQUENCE_MIN_WIDTH}px`)
    const cfg = screen.getByTestId('runner-config-pane')
    expect(cfg.style.minWidth).toBe(`${layout.RUNNER_CONFIG_MIN_WIDTH}px`)
    expect(screen.getByTestId('runner-split-divider')).toBeTruthy()
  })

  it('crossing the threshold keeps the config form state (no remount)', () => {
    const split = renderSplit()
    act(() => {
      fireEvent.click(screen.getByLabelText(/Schedule runs/i))
    })
    expect((screen.getByLabelText(/Schedule runs/i) as HTMLInputElement).checked).toBe(true)
    resize(split, MIN_WINDOW_SPLIT_PX)
    expect((screen.getByLabelText(/Schedule runs/i) as HTMLInputElement).checked).toBe(true)
    resize(split, 1200)
    expect((screen.getByLabelText(/Schedule runs/i) as HTMLInputElement).checked).toBe(true)
  })

  it('stacked: footer actions and inputs keep a usable minimum width', () => {
    const split = renderSplit()
    act(() => {
      fireEvent.click(screen.getByLabelText(/Schedule runs/i))
    })
    resize(split, MIN_WINDOW_SPLIT_PX)
    for (const id of ['runner-start', 'runner-save-config']) {
      const b = screen.getByTestId(id)
      expect(cls(b), id).toContain('shrink-0')
      expect(cls(b), id).toContain('whitespace-nowrap')
    }
    // Iterations + both delays: an explicit rem floor so a narrow cell can
    // never squeeze the field to a few px beside "ms".
    const grid = screen.getByTestId('runner-run-config-grid')
    const inputs = Array.from(grid.querySelectorAll('input[type="number"]'))
    expect(inputs).toHaveLength(3)
    for (const input of inputs) expect(input.className).toMatch(/(^|\s)min-w-\[\d+(\.\d+)?rem\]/)
    // The grid track never demands more than the cell has (no horizontal scroll).
    expect(grid.className).toContain('minmax(min(')
  })
})

describe('#308 RunnerSequence header never wraps into a stack of words', () => {
  it('title and each action stay on one line; the row wraps whole units', () => {
    renderSplit()
    const title = screen.getByText('Run Sequence')
    expect(cls(title)).toContain('whitespace-nowrap')
    const header = title.parentElement as HTMLElement
    expect(cls(header)).toContain('flex-wrap')
    for (const name of [/Deselect All/, /^Select All$/, /^Reset$/]) {
      const b = screen.getByRole('button', { name })
      expect(cls(b), String(name)).toContain('whitespace-nowrap')
    }
    const actions = screen.getByRole('button', { name: /Deselect All/ })
      .parentElement as HTMLElement
    expect(cls(actions)).toContain('flex-wrap')
  })
})
