import type { CSSProperties } from 'react'

/**
 * Runner config view: Run Sequence (left, resizable) + config column (right).
 *
 * The sequence pane used to keep its full stored width (`flexShrink: 0`), so on
 * a 1024 px window the config column got ~230 px and overflowed (1.6.0 screen
 * review G-16, issue #255 follow-up). Now the sequence pane is the one that
 * gives way: its stored width is only a basis (`flex: 0 1 <w>px`) down to
 * `RUNNER_SEQUENCE_MIN_WIDTH`, while the config column keeps a floor of
 * `RUNNER_CONFIG_MIN_WIDTH` — enough for one-column fields and a wrapped
 * action bar. Both floors + the 4 px divider fit the ~477 px a 900 px window
 * leaves (83 icon bar + 300 left panel + 40 right rail), so the outer
 * overflow-hidden never clips the config column.
 */
export const RUNNER_SEQUENCE_MIN_WIDTH = 160
export const RUNNER_CONFIG_MIN_WIDTH = 280

export function sequencePaneStyle(width: number): CSSProperties {
  return {
    flex: `0 1 ${width}px`,
    minWidth: RUNNER_SEQUENCE_MIN_WIDTH,
    overflow: 'hidden',
    display: 'flex',
  }
}

export const CONFIG_PANE_CLASS = 'flex flex-1 overflow-hidden'
