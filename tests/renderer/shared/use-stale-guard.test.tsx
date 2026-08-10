/**
 * `useInvalidateOn` / `useStaleFlag` — the two halves of "the output on screen
 * must belong to the input on screen".
 *
 * The distinction they encode matters: a VERDICT ("Valid", "Signature
 * verified", "Trusted") is wrong the instant its input changes and must go,
 * while an ARTIFACT (generated passwords, UUIDs) is merely out of date and
 * deleting it would throw away the user's work.
 */
import * as React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { useInvalidateOn, useStaleFlag } from '../../../src/renderer/lib/use-stale-guard'
;(globalThis as unknown as { React: typeof React }).React = React

afterEach(() => cleanup())

describe('useInvalidateOn', () => {
  it('does NOT fire on mount', () => {
    // Mounting is not a change — firing here would wipe state a tool restored
    // from its store on the way in.
    const reset = vi.fn()
    function C({ dep }: { dep: string }) {
      useInvalidateOn([dep], reset)
      return <div>{dep}</div>
    }
    render(<C dep="a" />)
    expect(reset).not.toHaveBeenCalled()
  })

  it('fires when a dep changes', () => {
    const reset = vi.fn()
    function C({ dep }: { dep: string }) {
      useInvalidateOn([dep], reset)
      return <div>{dep}</div>
    }
    const { rerender } = render(<C dep="a" />)
    rerender(<C dep="b" />)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('does not fire when a re-render leaves the deps alone', () => {
    const reset = vi.fn()
    function C({ dep, other }: { dep: string; other: number }) {
      useInvalidateOn([dep], reset)
      return (
        <div>
          {dep}
          {other}
        </div>
      )
    }
    const { rerender } = render(<C dep="a" other={1} />)
    rerender(<C dep="a" other={2} />)
    expect(reset).not.toHaveBeenCalled()
  })

  it('uses the latest callback without re-arming on every render', () => {
    // The reset closure has to see current state; capturing it once would clear
    // stale values instead of the live ones.
    let seen = ''
    function C({ dep, value }: { dep: string; value: string }) {
      useInvalidateOn([dep], () => {
        seen = value
      })
      return <div>{dep}</div>
    }
    const { rerender } = render(<C dep="a" value="first" />)
    rerender(<C dep="a" value="second" />)
    rerender(<C dep="b" value="second" />)
    expect(seen).toBe('second')
  })

  it('fires once per change, not once per dep changed', () => {
    const reset = vi.fn()
    function C({ a, b }: { a: number; b: number }) {
      useInvalidateOn([a, b], reset)
      return <div>{a + b}</div>
    }
    const { rerender } = render(<C a={1} b={1} />)
    rerender(<C a={2} b={2} />)
    expect(reset).toHaveBeenCalledTimes(1)
  })
})

describe('useStaleFlag', () => {
  function Harness({ dep }: { dep: string }) {
    const { stale, markFresh } = useStaleFlag([dep])
    return (
      <div>
        <span data-testid="state">{stale ? 'stale' : 'fresh'}</span>
        <button onClick={markFresh}>regenerate</button>
      </div>
    )
  }

  it('starts fresh', () => {
    render(<Harness dep="a" />)
    expect(screen.getByTestId('state')).toHaveTextContent('fresh')
  })

  it('goes stale when an input changes', () => {
    const { rerender } = render(<Harness dep="a" />)
    rerender(<Harness dep="b" />)
    expect(screen.getByTestId('state')).toHaveTextContent('stale')
  })

  it('goes fresh again once the caller regenerates', () => {
    const { rerender } = render(<Harness dep="a" />)
    rerender(<Harness dep="b" />)
    act(() => {
      screen.getByText('regenerate').click()
    })
    expect(screen.getByTestId('state')).toHaveTextContent('fresh')
  })
})
