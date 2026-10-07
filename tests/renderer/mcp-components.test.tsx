/**
 * Issue #139 — MCP editor components: `McpResultView` renders each content
 * type (text / image / audio / embedded resource / resource_link /
 * structuredContent / isError), `McpCapabilityList` filters by search, the
 * paste-config modal imports a server into the tab, and the messages pane
 * shows the frame log with a JSON detail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import McpResultView from '../../src/renderer/components/protocols/mcp/McpResultView'
import McpCapabilityList from '../../src/renderer/components/protocols/mcp/McpCapabilityList'
import McpConfigMenu from '../../src/renderer/components/protocols/mcp/McpConfigMenu'
import McpMessagesPane from '../../src/renderer/components/protocols/mcp/McpMessagesPane'
import McpEditor from '../../src/renderer/components/protocols/McpEditor'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-ui')
})

afterEach(() => cleanup())

describe('McpResultView — content types', () => {
  it('text (JSON text pretty-printed), image, resource_link and structuredContent', () => {
    render(
      <McpResultView
        result={{
          content: [
            { type: 'text', text: 'pong' },
            { type: 'text', text: '{"a":1}' },
            { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
            {
              type: 'resource_link',
              uri: 'file:///tmp/a.txt',
              name: 'a.txt',
              mimeType: 'text/plain',
            },
          ],
          structuredContent: { temperature: 21 },
        }}
      />,
    )
    const texts = screen.getAllByTestId('mcp-block-text')
    expect(texts[0]).toHaveTextContent('pong')
    expect(texts[1].textContent).toBe('{\n  "a": 1\n}')
    expect(screen.getByTestId('mcp-block-image')).toHaveAttribute(
      'src',
      `data:image/png;base64,${PNG_1PX}`,
    )
    const link = screen.getByTestId('mcp-block-resource-link')
    expect(link).toHaveTextContent('a.txt')
    expect(link).toHaveTextContent('file:///tmp/a.txt')
    expect(screen.getByTestId('mcp-structured-content')).toHaveTextContent('"temperature": 21')
    expect(screen.getByTestId('mcp-result')).toHaveAttribute('data-error', 'false')
    expect(screen.queryByTestId('mcp-result-error-label')).toBeNull()
  })

  it('audio goes through a blob URL (CSP media-src blob:) and is revoked on unmount', () => {
    const create = vi.fn(() => 'blob:mcp-audio-1')
    const revoke = vi.fn()
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
    try {
      const { unmount } = render(
        <McpResultView
          result={{ content: [{ type: 'audio', data: 'AAAA', mimeType: 'audio/wav' }] }}
        />,
      )
      const audio = screen.getByTestId('mcp-block-audio') as HTMLAudioElement
      expect(create).toHaveBeenCalledTimes(1)
      expect(audio.getAttribute('src')).toBe('blob:mcp-audio-1')
      unmount()
      expect(revoke).toHaveBeenCalledWith('blob:mcp-audio-1')
    } finally {
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
    }
  })

  it('embedded resource: text shown, blob shown as "binary N bytes" + download', () => {
    render(
      <McpResultView
        result={{
          content: [
            {
              type: 'resource',
              resource: { uri: 'test://greeting', mimeType: 'text/plain', text: 'Hello!' },
            },
            {
              type: 'resource',
              resource: {
                uri: 'test://bin',
                mimeType: 'application/octet-stream',
                blob: 'AAECAw==',
              },
            },
          ],
        }}
      />,
    )
    const [textRes, binRes] = screen.getAllByTestId('mcp-block-resource')
    expect(textRes).toHaveTextContent('test://greeting')
    expect(textRes).toHaveTextContent('Hello!')
    expect(within(binRes).getByTestId('mcp-resource-binary')).toHaveTextContent('binary, 4 bytes')
    expect(within(binRes).getByTestId('mcp-resource-download')).toBeInTheDocument()
  })

  it('isError → red border + label; the Raw toggle shows the exact JSON', () => {
    render(
      <McpResultView
        result={{ content: [{ type: 'text', text: 'intentionally failed' }], isError: true }}
      />,
    )
    const box = screen.getByTestId('mcp-result')
    expect(box).toHaveAttribute('data-error', 'true')
    expect(box.className).toContain('border-[var(--red)]')
    expect(screen.getByTestId('mcp-result-error-label')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-block-text')).toHaveTextContent('intentionally failed')

    fireEvent.click(screen.getByTestId('mcp-result-raw-toggle'))
    expect(screen.getByTestId('mcp-result-json')).toHaveTextContent('"isError": true')
  })

  it('a non-CallToolResult value falls back to pretty JSON', () => {
    render(<McpResultView result={{ toolResult: 42 }} />)
    expect(screen.getByTestId('mcp-result-json')).toHaveTextContent('"toolResult": 42')
  })
})

describe('McpCapabilityList — tabs, counts, search', () => {
  beforeEach(() => {
    useMcpStore.setState({
      connectionState: 'connected',
      connectionId: 'c-1',
      tools: [
        { name: 'echo', description: 'Echo back the input', inputSchema: {} },
        { name: 'add', title: 'Adder', description: 'Add two numbers', inputSchema: {} },
      ],
      resources: [{ uri: 'test://greeting', name: 'greeting', description: 'A friendly hello' }],
      resourceTemplates: [{ uriTemplate: 'test://item/{id}', name: 'item' }],
      prompts: [{ name: 'summarize', description: 'Summarize a text' }],
      capabilityTab: 'tools',
      search: '',
    })
  })

  it('filters tools by name / title / description', () => {
    render(<McpCapabilityList />)
    expect(screen.getByTestId('mcp-tool-echo')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-tool-add')).toHaveTextContent('Adder')

    fireEvent.change(screen.getByTestId('mcp-search'), { target: { value: 'numbers' } })
    expect(screen.queryByTestId('mcp-tool-echo')).toBeNull()
    expect(screen.getByTestId('mcp-tool-add')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('mcp-search'), { target: { value: 'zzz' } })
    expect(screen.queryByTestId('mcp-tool-add')).toBeNull()
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('resources tab lists resources + templates, counts, and filters by URI', () => {
    render(<McpCapabilityList />)
    const resTab = screen.getByTestId('mcp-cap-tab-resources')
    expect(resTab).toHaveTextContent('2')
    fireEvent.click(resTab)
    expect(screen.getByTestId('mcp-resource-test_greeting')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-template-test_item_id_')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('mcp-search'), { target: { value: 'item/' } })
    expect(screen.queryByTestId('mcp-resource-test_greeting')).toBeNull()
    fireEvent.click(screen.getByTestId('mcp-template-test_item_id_'))
    expect(useMcpStore.getState().selectedResourceUri).toBe('test://item/{id}')
    expect(useMcpStore.getState().resourceUriDraft).toBe('test://item/{id}')
  })

  it('prompts tab selects a prompt', () => {
    render(<McpCapabilityList />)
    fireEvent.click(screen.getByTestId('mcp-cap-tab-prompts'))
    fireEvent.click(screen.getByTestId('mcp-prompt-summarize'))
    expect(useMcpStore.getState().selectedPrompt).toBe('summarize')
  })
})

describe('McpConfigMenu — paste config', () => {
  it('parses a multi-server config, lets the user pick one and imports it', () => {
    render(<McpConfigMenu disabled={false} />)
    fireEvent.click(screen.getByTestId('mcp-config-paste'))
    fireEvent.change(screen.getByTestId('mcp-config-text'), {
      target: {
        value: JSON.stringify({
          servers: {
            fs: { type: 'stdio', command: 'npx', args: ['-y', 'fs-server'], env: { K: 'v' } },
            remote: { type: 'http', url: 'https://r.test/mcp', headers: { 'X-K': '1' } },
          },
        }),
      },
    })
    fireEvent.click(screen.getByTestId('mcp-config-server-1'))
    fireEvent.click(screen.getByTestId('mcp-config-apply'))

    const s = useMcpStore.getState()
    expect(s.transport).toBe('http')
    expect(s.url).toBe('https://r.test/mcp')
    expect(s.customHeaders.map((h) => [h.key, h.value])).toEqual([['X-K', '1']])
    expect(screen.queryByTestId('mcp-config-text')).toBeNull()
  })

  it('shows the parse error for malformed JSON and keeps Import disabled', () => {
    render(<McpConfigMenu disabled={false} />)
    fireEvent.click(screen.getByTestId('mcp-config-paste'))
    fireEvent.change(screen.getByTestId('mcp-config-text'), {
      target: { value: '{ "mcpServers": ' },
    })
    expect(screen.getByTestId('mcp-config-error')).toHaveTextContent(/Invalid JSON/)
    expect(screen.getByTestId('mcp-config-apply')).toBeDisabled()
  })

  it('export renders the current tab for each host', () => {
    useMcpStore.setState({ transport: 'stdio', url: 'node server.js' })
    render(<McpConfigMenu disabled={false} />)
    fireEvent.click(screen.getByTestId('mcp-config-export'))
    expect(JSON.parse(screen.getByTestId('mcp-export-code').textContent ?? '')).toEqual({
      mcpServers: { 'mcp-server': { command: 'node', args: ['server.js'] } },
    })
    fireEvent.click(screen.getByTestId('mcp-export-host-vscode'))
    expect(
      JSON.parse(screen.getByTestId('mcp-export-code').textContent ?? '').servers,
    ).toHaveProperty('mcp-server.type', 'stdio')
  })
})

describe('McpMessagesPane / McpEditor', () => {
  it('frames list shows direction + label and a JSON detail on click', () => {
    useMcpStore.setState({
      frames: [
        {
          id: 'f1',
          ts: 0,
          direction: 'out',
          message: { jsonrpc: '2.0', id: 1, method: 'initialize' },
        },
        {
          id: 'f2',
          ts: 1,
          direction: 'in',
          message: { jsonrpc: '2.0', id: 1, result: { ok: true } },
        },
      ],
      notifications: [{ id: 'n1', ts: 0, method: 'notifications/message', params: { data: 'x' } }],
    })
    render(<McpMessagesPane />)
    fireEvent.click(screen.getByTestId('mcp-messages-toggle'))
    expect(screen.getByTestId('mcp-notifications')).toHaveTextContent('notifications/message')

    fireEvent.click(screen.getByTestId('mcp-messages-tab-frames'))
    const frames = screen.getByTestId('mcp-frames')
    expect(frames).toHaveTextContent('initialize #1')
    expect(frames).toHaveTextContent('result #1')
    fireEvent.click(within(frames).getByText('result #1'))
    expect(screen.getByTestId('mcp-frames-detail')).toHaveTextContent('"ok": true')

    fireEvent.click(screen.getByTestId('mcp-frames-clear'))
    expect(useMcpStore.getState().frames).toEqual([])
  })

  it('progress / log notifications get a summary; a truncated frame shows badge + preview', () => {
    useMcpStore.setState({
      notifications: [
        {
          id: 'n1',
          ts: 0,
          method: 'notifications/progress',
          params: { progressToken: 1, progress: 1, total: 4, message: 'step 1/4' },
        },
        {
          id: 'n2',
          ts: 1,
          method: 'notifications/message',
          params: { level: 'info', logger: 'e2e', data: 'notify tool started' },
        },
      ],
      frames: [
        {
          id: 'f1',
          ts: 0,
          direction: 'in',
          truncated: true,
          message: {
            jsonrpc: '2.0',
            id: 7,
            _truncated: { chars: 2_000_000, preview: 'PREVIEW-TEXT' },
          },
        },
      ],
    })
    render(<McpMessagesPane />)
    fireEvent.click(screen.getByTestId('mcp-messages-toggle'))
    const list = screen.getByTestId('mcp-notifications')
    expect(list).toHaveTextContent('1/4 (25%) — step 1/4')
    expect(list).toHaveTextContent('[info] e2e: notify tool started')

    fireEvent.click(screen.getByTestId('mcp-messages-tab-frames'))
    expect(screen.getByTestId('mcp-frame-truncated')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('mcp-frames')).getByText('result #7'))
    const detail = screen.getByTestId('mcp-frames-detail')
    expect(detail).toHaveTextContent('2000000 characters')
    expect(detail).toHaveTextContent('PREVIEW-TEXT')
    expect(detail.textContent).not.toContain('_truncated')
  })

  it('the editor keeps the e2e hooks and shows the env block only for stdio', () => {
    render(<McpEditor />)
    expect(screen.getByTestId('mcp-transport')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-url')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-connect')).toHaveTextContent('Connect')
    expect(screen.getByTestId('mcp-headers-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('mcp-env-toggle')).toBeNull()

    fireEvent.change(screen.getByTestId('mcp-transport'), { target: { value: 'stdio' } })
    expect(screen.getByTestId('mcp-env-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('mcp-headers-toggle')).toBeNull()
  })
})
