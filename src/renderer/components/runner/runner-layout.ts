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
 * overflow-hidden never clips the config column. These floors apply to the
 * side-by-side layout only, which since issue #308 is used at or above
 * `RUNNER_STACK_BELOW`; narrower views stack (below).
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

/*
 * Stacked layout (issue #308). The floors above only stop the config column
 * from overflowing; at the app's minimum window (900 px: 900 - 83 icon bar -
 * 300 left panel - 40 Variables rail = 477 px for the whole view) they still
 * squeezed both columns — the sequence header broke into a stack of words and
 * the fields were cramped. Below `RUNNER_STACK_BELOW` the view stacks: Run
 * Sequence on top (a bounded share of the height, its list scrolls), the
 * config column below at the full width.
 *
 * Budget, worst case = TR at the largest font setting (20 px root). Runner text
 * is a fixed 13 px but every Tailwind padding / rem floor scales with the root:
 *  - sequence: 360 px holds the action group ("Tümünü Bırak | Tümünü Seç |
 *    Sıfırla" ~280 px with its 20 px-root padding) on one line. Title and
 *    actions together need ~440 px in that worst case, so there the header
 *    takes two lines of WHOLE units (title, then actions) — RunnerSequence's
 *    header wraps units, never words, at any width;
 *  - config: `RUNNER_CONFIG_MIN_WIDTH` holds one 9rem field column and the
 *    widest footer button ("Çalıştırmayı planla" + icon ~207 px) inside the
 *    bar's 2 x 1.25rem padding.
 *
 * Decided on the split's OWN measured width (ResizeObserver, see
 * RunnerConfigSplit): that element is a `min-w-0 flex-1` child whose width
 * does not depend on the mode inside it — stacking cannot change the
 * measurement that chose it, so there is no feedback loop.
 */
/** Sequence column width the side-by-side layout must be able to give. */
export const RUNNER_SEQUENCE_SIDE_MIN_PX = 360
/** `ResizeDivider` between the two columns (RunnerTab). */
export const RUNNER_SPLIT_DIVIDER_PX = 5
/** Below this split width the sequence and config columns stack. */
export const RUNNER_STACK_BELOW =
  RUNNER_SEQUENCE_SIDE_MIN_PX + RUNNER_SPLIT_DIVIDER_PX + RUNNER_CONFIG_MIN_WIDTH

export type RunnerSplitLayout = 'side' | 'stacked'

/** `width` <= 0, NaN or Infinity means "not measured yet" — side by side. */
export function runnerSplitLayout(width: number): RunnerSplitLayout {
  if (!Number.isFinite(width) || width <= 0) return 'side'
  return width < RUNNER_STACK_BELOW ? 'stacked' : 'side'
}

export const SPLIT_SIDE_CLASS = 'flex min-w-0 flex-1 overflow-hidden'
export const SPLIT_STACKED_CLASS = 'flex min-w-0 flex-1 flex-col overflow-hidden'
/** Stacked sequence: content height up to 40 % of the view; its list scrolls. */
export const STACKED_SEQUENCE_PANE_CLASS =
  'flex max-h-[40%] min-w-0 shrink-0 overflow-hidden border-b border-[var(--border)]'
export const STACKED_CONFIG_PANE_CLASS = 'flex min-h-0 min-w-0 flex-1 overflow-hidden'
