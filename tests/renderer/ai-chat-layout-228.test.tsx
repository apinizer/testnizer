/**
 * Issue #228 — AI Chat layout contract. With Settings and Tools expanded the
 * conversation used to shrink to ~25 px (both sections were `shrink-0`, the
 * conversation the only flexible child), clipping the tool approval card.
 *
 * Contract:
 *  - while a configuration section is open, the body is a vertical split
 *    (config ↔ conversation, the MCP editor's #211 split, remembered per user)
 *    whose conversation floor is AI_TRANSCRIPT_MIN_PX;
 *  - with both sections collapsed there is no split (headers + conversation);
 *  - the toggles expose their state (`aria-expanded`, `data-expanded`) and a
 *    collapsed section really drops its body;
 *  - a card waiting for the user is scrolled into view inside the conversation
 *    without `scrollIntoView` (it scrolls overflow-hidden ancestors) and
 *    without moving focus.
 */
// The browser build, as in mcp-resizable-splits.test.tsx: vitest would resolve
// the SSR build, which has no layout effects and never restores a saved layout.
vi.mock(
  'react-resizable-panels',
  () =>
    import('../../node_modules/react-resizable-panels/dist/react-resizable-panels.browser.development.esm.js'),
)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

vi.hoisted(() => {
  const g = globalThis as unknown as { window: { api?: unknown } }
  g.window.api = {
    aiChat: {
      send: vi.fn(),
      cancel: vi.fn(),
      approveTool: vi.fn(async () => ({ success: true, data: { applied: true } })),
      resolveStdioTrust: vi.fn(async () => ({ success: true, data: { applied: true } })),
      onChunk: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
      onCancelled: () => () => {},
      onEvent: () => () => {},
      conversations: {
        list: vi.fn(async () => ({ success: true, data: [] })),
        load: vi.fn(),
        rename: vi.fn(),
        remove: vi.fn(),
        create: vi.fn(),
        append: vi.fn(),
        rehome: vi.fn(),
        dropTab: vi.fn(),
      },
    },
  }
})

import AiChatEditor from '../../src/renderer/components/protocols/AiChatEditor'
import { useAiChatStore } from '../../src/renderer/stores/ai-chat.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import {
  AI_CHAT_SPLIT_ID,
  AI_CONFIG_PANEL_ID,
  AI_TRANSCRIPT_MIN_PX,
  AI_TRANSCRIPT_PANEL_ID,
  awaitingUserKey,
  scrollTopToReveal,
} from '../../src/renderer/lib/ai-chat-view'
import type { AiAssistantTurn, AiTurn } from '../../src/shared/ai-chat-types'

function seed(extra: Record<string, unknown> = {}): void {
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', name: 'AI', protocol: 'ai', isDirty: false, isLoading: false }],
    activeTabId: 'tab-1',
  } as never)
  useAiChatStore.setState({
    provider: 'openai',
    customUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-5',
    systemPrompt: '',
    customHeaders: [],
    messages: [],
    streaming: false,
    pendingResponseId: null,
    pendingMessageId: null,
    errorMessage: null,
    toolServers: [],
    toolCatalog: {},
    autoApproveTools: false,
    allowedTools: [],
    conversationId: null,
    conversationName: null,
    conversations: [],
    conversationLoaded: true,
    _tabStates: new Map(),
    _currentTabId: 'tab-1',
    ...extra,
  })
}

const pendingTurn: AiAssistantTurn = {
  id: 'a1',
  role: 'assistant',
  content: '',
  timestamp: 2,
  parts: [
    {
      type: 'tool_call',
      id: 'call1',
      serverId: 's',
      server: 'Echo',
      tool: 'echo',
      argsJson: '{"text":"hi"}',
      status: 'pending-approval',
    },
  ],
}
const userTurn: AiTurn = { id: 'u1', role: 'user', content: 'echo', timestamp: 1 }

// jsdom has no layout: give every box a height (the split measures its body)
// and let a test place the conversation and the card where it wants.
const rects = new Map<string, { top: number; bottom: number }>()
let rectSpy: ReturnType<typeof vi.spyOn> | null = null
const scrollTops = new WeakMap<Element, number>()
const scrollTopDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')

beforeEach(() => {
  vi.clearAllMocks()
  rects.clear()
  window.localStorage.clear()
  act(() => useUIStore.setState({ locale: 'en' }))
  seed()
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const id = this.getAttribute('data-testid') ?? ''
    const r = rects.get(id) ?? { top: 0, bottom: 600 }
    return {
      top: r.top,
      bottom: r.bottom,
      left: 0,
      right: 800,
      width: 800,
      height: r.bottom - r.top,
      x: 0,
      y: r.top,
      toJSON: () => ({}),
    } as DOMRect
  })
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return scrollTops.get(this) ?? 0
    },
    set(this: Element, v: number) {
      scrollTops.set(this, v)
    },
  })
})
afterEach(() => {
  cleanup()
  rectSpy?.mockRestore()
  if (scrollTopDesc) Object.defineProperty(Element.prototype, 'scrollTop', scrollTopDesc)
})

describe('issue #228 — config ↔ conversation split', () => {
  it('Settings open (default): the body is a remembered vertical split with a conversation floor', () => {
    render(<AiChatEditor />)
    const body = screen.getByTestId('ai-chat-body')
    expect(body.getAttribute('data-split')).toBe('true')
    expect(screen.getByTestId('ai-chat-split-handle')).toBeTruthy()
    // Settings + Tools live in the scrolling config panel, the conversation in its own.
    const config = screen.getByTestId('ai-chat-config')
    expect(config.className).toContain('overflow-y-auto')
    expect(config.contains(screen.getByTestId('ai-settings-toggle'))).toBe(true)
    expect(config.contains(screen.getByTestId('ai-tools-toggle'))).toBe(true)
    const transcript = screen.getByTestId('ai-chat-transcript-panel')
    expect(transcript.contains(screen.getByTestId('ai-conversation'))).toBe(true)
    // Floor: on a 600 px body the conversation may not go under AI_TRANSCRIPT_MIN_PX.
    const minPct = Number(transcript.getAttribute('data-min-size'))
    expect((minPct / 100) * 600).toBeGreaterThanOrEqual(AI_TRANSCRIPT_MIN_PX - 1)
    // The composer is outside the split — always visible.
    expect(body.contains(screen.getByPlaceholderText(/Ask anything/i))).toBe(false)
  })

  it('restores the remembered split, like the MCP splits (#211)', () => {
    window.localStorage.setItem(
      `react-resizable-panels:${AI_CHAT_SPLIT_ID}`,
      JSON.stringify({
        [`${AI_CONFIG_PANEL_ID},${AI_TRANSCRIPT_PANEL_ID}`]: {
          layout: [30, 70],
          expandToSizes: {},
        },
      }),
    )
    render(<AiChatEditor />)
    const panelOf = (id: string): Element | null =>
      screen.getByTestId(id).closest('[data-panel-size]')
    expect(panelOf('ai-chat-config')).toHaveAttribute('data-panel-size', '30.0')
    expect(screen.getByTestId('ai-chat-transcript-panel')).toHaveAttribute(
      'data-panel-size',
      '70.0',
    )
    expect(screen.getByTestId('ai-chat-split-handle')).toHaveAttribute(
      'data-panel-group-direction',
      'vertical',
    )
  })

  it('both sections collapsed: no split, the conversation takes the rest', () => {
    render(<AiChatEditor />)
    fireEvent.click(screen.getByTestId('ai-settings-toggle'))
    expect(screen.getByTestId('ai-chat-body').getAttribute('data-split')).toBe('false')
    expect(screen.queryByTestId('ai-chat-split-handle')).toBeNull()
    expect(screen.getByTestId('ai-conversation').className).toContain('min-h-0')
    expect(screen.getByTestId('ai-conversation').className).toContain('flex-1')
  })

  it('toggles expose their state and a collapsed section drops its body', () => {
    render(<AiChatEditor />)
    const settings = screen.getByTestId('ai-settings-toggle')
    const tools = screen.getByTestId('ai-tools-toggle')
    expect(settings.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('ai-settings-section').getAttribute('data-expanded')).toBe('true')
    expect(screen.getByTestId('ai-settings-body')).toBeTruthy()
    expect(tools.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('ai-tools-section').getAttribute('data-expanded')).toBe('false')
    expect(screen.queryByTestId('ai-tools-body')).toBeNull()

    fireEvent.click(tools)
    expect(screen.getByTestId('ai-tools-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('ai-tools-section').getAttribute('data-expanded')).toBe('true')
    const toolsBody = screen.getByTestId('ai-tools-body')
    expect(screen.getByTestId('ai-tools-toggle').getAttribute('aria-controls')).toBe(toolsBody.id)

    fireEvent.click(screen.getByTestId('ai-tools-toggle'))
    expect(screen.queryByTestId('ai-tools-body')).toBeNull()
    expect(screen.getByTestId('ai-tools-section').getAttribute('data-expanded')).toBe('false')
  })
})

describe('issue #228 — a card that waits for the user is brought into view', () => {
  it('the approval card is scrolled into the conversation, focus and ancestors untouched', () => {
    const scrollIntoView = vi.fn()
    ;(Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView
    seed({ messages: [userTurn], streaming: false })
    render(<AiChatEditor />)
    fireEvent.click(screen.getByTestId('ai-tools-toggle'))
    const composer = screen.getByPlaceholderText(/Ask anything/i)
    composer.focus()
    expect(document.activeElement).toBe(composer)
    const conversation = screen.getByTestId('ai-conversation')
    // The user scrolled up: the pinned auto-scroll would not move the view.
    Object.defineProperty(conversation, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(conversation, 'clientHeight', { configurable: true, value: 220 })
    conversation.scrollTop = 40
    fireEvent.scroll(conversation)

    // The conversation shows 100..320; the approval block sits at 500..570.
    rects.set('ai-conversation', { top: 100, bottom: 320 })
    rects.set('ai-tool-approval', { top: 500, bottom: 570 })
    act(() =>
      useAiChatStore.setState({
        messages: [userTurn, pendingTurn],
        pendingResponseId: 'a1',
        pendingMessageId: 'm1',
      }),
    )
    expect(screen.getByTestId('ai-tool-approval')).toBeTruthy()
    // 570 must end 8 px above 320 → scrolled by 258 from where the user left it.
    expect(conversation.scrollTop).toBe(40 + 258)
    expect(conversation.getAttribute('data-awaiting-user-key')).toBe('call:call1')
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(composer)
    // The editor root and the body never scroll.
    expect(screen.getByTestId('ai-chat-editor').scrollTop).toBe(0)
    expect(screen.getByTestId('ai-chat-body').scrollTop).toBe(0)
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
  })
})

describe('issue #228 — pure helpers', () => {
  it('scrollTopToReveal moves as little as possible; a tall card is aligned to its bottom', () => {
    const view = { top: 100, bottom: 300 }
    expect(scrollTopToReveal(view, { top: 150, bottom: 250 }, 40)).toBe(40)
    expect(scrollTopToReveal(view, { top: 320, bottom: 380 }, 40)).toBe(40 + 88)
    expect(scrollTopToReveal(view, { top: 50, bottom: 90 }, 400)).toBe(400 - 58)
    expect(scrollTopToReveal(view, { top: 0, bottom: 900 }, 10)).toBe(10 + 608)
    expect(scrollTopToReveal(view, { top: 0, bottom: 90 }, 5)).toBe(0)
  })

  it('awaitingUserKey: only the live turn, approval or pending stdio trust', () => {
    expect(awaitingUserKey([userTurn, pendingTurn], 'a1')).toBe('call:call1')
    expect(awaitingUserKey([userTurn, pendingTurn], null)).toBeNull()
    expect(awaitingUserKey([userTurn, pendingTurn], 'other')).toBeNull()
    const trust: AiAssistantTurn = {
      ...pendingTurn,
      parts: [{ type: 'notice', id: 'stdio:x', kind: 'stdio-untrusted', status: 'pending' }],
    }
    expect(awaitingUserKey([trust], 'a1')).toBe('trust:stdio:x')
    const trusted: AiAssistantTurn = {
      ...pendingTurn,
      parts: [{ type: 'notice', id: 'stdio:x', kind: 'stdio-untrusted', status: 'trusted' }],
    }
    expect(awaitingUserKey([trusted], 'a1')).toBeNull()
  })
})
