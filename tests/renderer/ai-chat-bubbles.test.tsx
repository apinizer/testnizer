/**
 * AI Chat bubble regressions — issues #74 and #75.
 *
 * #74: bubble text must be selectable (and therefore copyable). The guard is
 *      twofold: the text node opts into `user-select: text`, and nothing on
 *      its ancestor chain re-suppresses selection.
 * #75: the conversation must only auto-follow new SSE deltas while the user
 *      is parked at the bottom — scrolling up mid-stream has to stick.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

import AiChatEditor, {
  isPinnedToBottom,
  SCROLL_PIN_THRESHOLD_PX,
} from '../../src/renderer/components/protocols/AiChatEditor'
import { useAiChatStore, type AiChatMessage } from '../../src/renderer/stores/ai-chat.store'

function msg(id: string, role: AiChatMessage['role'], content: string): AiChatMessage {
  return { id, role, content, timestamp: 0 }
}

/** Fake a real scrolling box — jsdom reports 0 for every scroll metric. */
function stubScrollBox(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

beforeEach(() => {
  useAiChatStore.setState({
    provider: 'openai',
    customUrl: '',
    apiKey: 'sk-test',
    model: 'gpt-5',
    systemPrompt: '',
    messages: [msg('u1', 'user', 'my prompt text'), msg('a1', 'assistant', 'assistant reply text')],
    streaming: false,
    pendingResponseId: null,
    pendingMessageId: null,
    errorMessage: null,
    _tabStates: new Map(),
    _currentTabId: null,
  })
})

// Vitest globals are off here, so RTL's auto-cleanup doesn't run by itself.
afterEach(cleanup)

describe('AI Chat — bubble text selection (issue #74)', () => {
  it('renders both bubbles with selectable text', () => {
    render(React.createElement(AiChatEditor))
    const bubbles = screen.getAllByTestId('ai-bubble-text')
    expect(bubbles).toHaveLength(2)
    expect(bubbles[0].textContent).toContain('my prompt text')
    expect(bubbles[1].textContent).toContain('assistant reply text')
    for (const b of bubbles) {
      expect(b.classList.contains('select-text')).toBe(true)
    }
  })

  it('has nothing on the ancestor chain that suppresses selection', () => {
    render(React.createElement(AiChatEditor))
    for (const bubble of screen.getAllByTestId('ai-bubble-text')) {
      let node: HTMLElement | null = bubble
      while (node && node !== document.body) {
        expect(node.classList.contains('select-none')).toBe(false)
        expect(node.style.userSelect).not.toBe('none')
        expect(node.style.webkitUserSelect).not.toBe('none')
        node = node.parentElement
      }
    }
  })
})

describe('AI Chat — auto-scroll pinning (issue #75)', () => {
  it('treats the view as pinned only within the bottom threshold', () => {
    // Exactly at the bottom.
    expect(isPinnedToBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })).toBe(true)
    // Inside the slack window.
    expect(
      isPinnedToBottom({
        scrollTop: 800 - SCROLL_PIN_THRESHOLD_PX,
        scrollHeight: 1000,
        clientHeight: 200,
      }),
    ).toBe(true)
    // One pixel past it — the user has deliberately scrolled away.
    expect(
      isPinnedToBottom({
        scrollTop: 800 - SCROLL_PIN_THRESHOLD_PX - 1,
        scrollHeight: 1000,
        clientHeight: 200,
      }),
    ).toBe(false)
    // Way up in the scrollback.
    expect(isPinnedToBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 })).toBe(false)
    // Nothing to scroll at all.
    expect(isPinnedToBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 })).toBe(true)
  })

  it('keeps the view where the user put it when a delta arrives mid-stream', () => {
    render(React.createElement(AiChatEditor))
    const box = screen.getByTestId('ai-conversation')
    stubScrollBox(box, 1000, 200)

    // User scrolls up into the scrollback while the answer is streaming.
    box.scrollTop = 120
    fireEvent.scroll(box)

    act(() => {
      useAiChatStore.setState({
        streaming: true,
        pendingResponseId: 'a1',
        messages: [
          msg('u1', 'user', 'my prompt text'),
          msg('a1', 'assistant', 'assistant reply text + more streamed tokens'),
        ],
      })
    })

    expect(box.scrollTop).toBe(120)
  })

  it('resumes following the stream once the user scrolls back down', () => {
    render(React.createElement(AiChatEditor))
    const box = screen.getByTestId('ai-conversation')
    stubScrollBox(box, 1000, 200)

    box.scrollTop = 120
    fireEvent.scroll(box)
    box.scrollTop = 800
    fireEvent.scroll(box)

    act(() => {
      useAiChatStore.setState({
        messages: [
          msg('u1', 'user', 'my prompt text'),
          msg('a1', 'assistant', 'assistant reply text + even more tokens'),
        ],
      })
    })

    expect(box.scrollTop).toBe(1000)
  })
})
