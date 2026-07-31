/**
 * A hidden tool tab keeps its text, not its editors (issue #77).
 *
 * The Workbench mounts EVERY open tool tab and toggles `display`, deliberately,
 * so a tool's typed input survives switching away and back. The cost was that
 * each mounted tool also kept roughly two Monaco editors alive — models,
 * workers and DOM for panes nobody is looking at, accumulating with every tool
 * the user opens.
 *
 * The state worth preserving belongs to the tool (`useState` holding the text);
 * Monaco is a controlled VIEW of it. So the tool stays mounted and Monaco does
 * not. These tests pin both halves — the editor really goes away, and the tool
 * really does not.
 */
import * as React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

/** Stands in for the real Monaco chunk, and counts live instances. */
let liveEditors = 0
vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: ({ value }: { value?: string }) => {
    React.useEffect(() => {
      liveEditors += 1
      return () => {
        liveEditors -= 1
      }
    }, [])
    return <div data-testid="monaco">{value}</div>
  },
}))

import MonacoWrapper from '../../src/renderer/components/shared/MonacoWrapper'
import { EditorVisibilityProvider } from '../../src/renderer/lib/editor-visibility'

/** A tool: owns its text, renders it through an editor. */
function FakeTool() {
  const [text, setText] = React.useState('')
  return (
    <div>
      <input aria-label="text" value={text} onChange={(e) => setText(e.target.value)} />
      <MonacoWrapper value={text} />
    </div>
  )
}

/** Mirrors the Workbench: every tab mounted, only the active one visible. */
function Workbench({ active }: { active: string }) {
  return (
    <>
      {['a', 'b'].map((id) => (
        <div key={id} style={{ display: id === active ? 'block' : 'none' }}>
          <EditorVisibilityProvider visible={id === active}>
            <FakeTool />
          </EditorVisibilityProvider>
        </div>
      ))}
    </>
  )
}

afterEach(() => {
  cleanup()
  liveEditors = 0
})

describe('editors follow visibility', () => {
  it('mounts an editor only for the tab on screen', async () => {
    render(<Workbench active="a" />)
    // The impl is behind `lazy`, so wait for it rather than measuring the
    // Suspense fallback.
    await screen.findByTestId('monaco')

    // The bug: both tabs were mounted, so both held an editor.
    expect(liveEditors).toBe(1)
    // The hidden pane still renders the same skeleton the lazy chunk uses, so
    // nothing reflows when it comes back.
    expect(screen.getAllByLabelText('Loading editor')).toHaveLength(1)
  })

  it('releases the editor when a tab is switched away from', async () => {
    const { rerender } = render(<Workbench active="a" />)
    await screen.findByTestId('monaco')
    expect(liveEditors).toBe(1)

    rerender(<Workbench active="b" />)
    await screen.findByTestId('monaco')

    // Still one — b's came up as a's went away, rather than accumulating.
    expect(liveEditors).toBe(1)
  })

  it('renders normally with no provider at all', async () => {
    // The request editor and response body have no provider; they must be
    // untouched by this.
    render(<MonacoWrapper value="plain" />)
    expect(await screen.findByTestId('monaco')).toHaveTextContent('plain')
    expect(liveEditors).toBe(1)
  })
})

describe('the tool itself is never unmounted', () => {
  it('keeps typed input across a tab switch and back', async () => {
    const { rerender } = render(<Workbench active="a" />)
    await screen.findByTestId('monaco')

    const [inputA] = screen.getAllByLabelText('text') as HTMLInputElement[]
    fireEvent.change(inputA, { target: { value: 'typed in a' } })

    rerender(<Workbench active="b" />)
    rerender(<Workbench active="a" />)
    await screen.findByTestId('monaco')

    // This is what the Workbench's keep-everything-mounted design buys, and
    // what dropping the editor must not cost.
    expect((screen.getAllByLabelText('text')[0] as HTMLInputElement).value).toBe('typed in a')
    // …and the editor rebuilds from that state.
    expect(screen.getByTestId('monaco')).toHaveTextContent('typed in a')
  })
})
