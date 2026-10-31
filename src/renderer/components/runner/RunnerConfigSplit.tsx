import { useEffect, useRef, useState, type ReactNode } from 'react'
import { observeWidth } from '../../lib/use-narrow-layout'
import {
  CONFIG_PANE_CLASS,
  RUNNER_CONFIG_MIN_WIDTH,
  SPLIT_SIDE_CLASS,
  SPLIT_STACKED_CLASS,
  STACKED_CONFIG_PANE_CLASS,
  STACKED_SEQUENCE_PANE_CLASS,
  runnerSplitLayout,
  sequencePaneStyle,
} from './runner-layout'

interface Props {
  /** Run Sequence column (RunnerSequence). */
  sequence: ReactNode
  /** Configuration column (RunnerConfig). */
  config: ReactNode
  /** Column resize handle — side-by-side layout only. */
  divider: ReactNode
  /** The user's dragged sequence width — the side-by-side flex basis. */
  sequenceWidth: number
}

/**
 * Runner config view: Run Sequence + configuration, side by side when the
 * split is wide enough and stacked below `RUNNER_STACK_BELOW` (issue #308).
 * The decision reads this element's own measured width, which the mode does
 * not change (see runner-layout.ts).
 *
 * The tree is the same in both modes — wrapper, sequence pane, divider slot,
 * config pane — so crossing the threshold while resizing only restyles the
 * panes and never remounts RunnerConfig (its run mode and schedule drafts are
 * local state).
 */
export default function RunnerConfigSplit({ sequence, config, divider, sequenceWidth }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return observeWidth(el, setWidth)
  }, [])
  const layout = runnerSplitLayout(width)
  const stacked = layout === 'stacked'

  return (
    <div
      ref={ref}
      data-testid="runner-config-split"
      data-layout={layout}
      className={stacked ? SPLIT_STACKED_CLASS : SPLIT_SIDE_CLASS}
    >
      {/* Side by side the sequence pane shrinks first (G-16); stacked it sits on top. */}
      <div
        data-testid="runner-sequence-pane"
        className={stacked ? STACKED_SEQUENCE_PANE_CLASS : undefined}
        style={stacked ? undefined : sequencePaneStyle(sequenceWidth)}
      >
        {sequence}
      </div>
      {!stacked && divider}
      {/* Config keeps a floor side by side; stacked it has the full width. */}
      <div
        data-testid="runner-config-pane"
        className={stacked ? STACKED_CONFIG_PANE_CLASS : CONFIG_PANE_CLASS}
        style={stacked ? undefined : { minWidth: RUNNER_CONFIG_MIN_WIDTH }}
      >
        {config}
      </div>
    </div>
  )
}
