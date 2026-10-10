/**
 * Issue #139 — MCP editor components: `McpResultView` renders each content
 * type (text / image / audio / embedded resource / resource_link /
 * structuredContent / isError), `McpCapabilityList` filters by search, the
 * paste-config modal imports a server into the tab, and the messages pane
 * shows the frame log with a JSON detail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import McpResultView from '../../src/renderer/components/protocols/mcp/McpResultView'
import McpCapabilityList from '../../src/renderer/components/protocols/mcp/McpCapabilityList'
import McpConfigMenu from '../../src/renderer/components/protocols/mcp/McpConfigMenu'
import McpMessagesPane from '../../src/renderer/components/protocols/mcp/McpMessagesPane'
import McpEditor from '../../src/renderer/components/protocols/McpEditor'
import McpConfigTabs from '../../src/renderer/components/protocols/mcp/McpConfigTabs'
import McpAuthSection from '../../src/renderer/components/protocols/mcp/McpAuthSection'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

beforeEach(() => {
  // The Messages pane remembers open/closed per user (issue #172) — start closed.
  window.localStorage.clear()
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

describe('McpResultView — empty text block (#162 follow-up)', () => {
  it('a text block whose text is "" shows a muted "(empty text)" placeholder (EN + TR)', () => {
    render(<McpResultView result={{ content: [{ type: 'text', text: '' }] }} />)
    const block = screen.getByTestId('mcp-block-text')
    expect(within(block).getByTestId('mcp-block-text-empty')).toHaveTextContent('(empty text)')
    expect(within(block).getByTestId('mcp-block-text-empty').className).toContain('--muted')
    cleanup()
    // Components read the locale from the UI store (`useTranslation`).
    useUIStore.setState({ locale: 'tr' })
    try {
      render(<McpResultView result={{ content: [{ type: 'text', text: '' }] }} />)
      expect(screen.getByTestId('mcp-block-text-empty')).toHaveTextContent('(boş metin)')
    } finally {
      useUIStore.setState({ locale: 'en' })
      setLocale('en')
    }
  })

  it('a non-empty text block has no placeholder', () => {
    render(<McpResultView result={{ content: [{ type: 'text', text: 'ok' }] }} />)
    expect(screen.queryByTestId('mcp-block-text-empty')).toBeNull()
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

describe('config export — Authorization tab', () => {
  const exported = () =>
    JSON.parse(screen.getByTestId('mcp-export-code').textContent ?? '').servers['mcp-server']

  it('a Bearer token is exported as the Authorization header', () => {
    useMcpStore.setState({
      transport: 'http',
      url: 'https://r.test/mcp',
      auth: { type: 'bearer', bearer: { token: 'tok' } },
    })
    render(<McpConfigMenu disabled={false} />)
    fireEvent.click(screen.getByTestId('mcp-config-export'))
    fireEvent.click(screen.getByTestId('mcp-export-host-vscode'))
    expect(exported().headers).toEqual({ Authorization: 'Bearer tok' })
    expect(screen.getByTestId('mcp-export-auth-note')).toBeInTheDocument()
  })

  it('a custom Authorization header row wins over the Authorization tab', () => {
    useMcpStore.setState({
      transport: 'http',
      url: 'https://r.test/mcp',
      customHeaders: [{ id: 'h1', key: 'Authorization', value: 'Custom row', enabled: true }],
      auth: { type: 'bearer', bearer: { token: 'tok' } },
    })
    render(<McpConfigMenu disabled={false} />)
    fireEvent.click(screen.getByTestId('mcp-config-export'))
    fireEvent.click(screen.getByTestId('mcp-export-host-vscode'))
    expect(exported().headers).toEqual({ Authorization: 'Custom row' })
    expect(screen.queryByTestId('mcp-export-auth-note')).toBeNull()
  })

  it('an API key in query lands in the exported URL; No Auth adds nothing', () => {
    useMcpStore.setState({
      transport: 'http',
      url: 'https://r.test/mcp',
      auth: { type: 'api-key', apiKey: { key: 'key', value: 'k1', in: 'query' } },
    })
    render(<McpConfigMenu disabled={false} />)
    fireEvent.click(screen.getByTestId('mcp-config-export'))
    fireEvent.click(screen.getByTestId('mcp-export-host-vscode'))
    expect(exported()).toEqual({ type: 'http', url: 'https://r.test/mcp?key=k1' })
    act(() => useMcpStore.setState({ auth: { type: 'none' } }))
    expect(exported()).toEqual({ type: 'http', url: 'https://r.test/mcp' })
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

describe('McpConfigTabs — Postman-style config strip (MCP Auth)', () => {
  it('http / sse: Authorization + Headers; stdio: Authorization + Environment', () => {
    render(<McpConfigTabs />)
    expect(screen.getByTestId('mcp-config-tab-auth')).toHaveTextContent('Authorization')
    expect(screen.getByTestId('mcp-config-tab-headers')).toHaveTextContent('Headers')
    expect(screen.queryByTestId('mcp-config-tab-env')).toBeNull()
    // Default: Authorization selected and unfolded, No Auth.
    expect(screen.getByTestId('mcp-config-tab-auth')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('mcp-auth-none')).toHaveTextContent(
      'This request does not use any authorization.',
    )

    act(() => useMcpStore.getState().setTransport('stdio'))
    expect(screen.queryByTestId('mcp-config-tab-headers')).toBeNull()
    expect(screen.getByTestId('mcp-config-tab-env')).toBeInTheDocument()
  })

  it('a tab click shows its panel; the legacy toggle ids sit on the tab labels', () => {
    render(<McpConfigTabs />)
    fireEvent.click(screen.getByTestId('mcp-headers-toggle'))
    expect(useMcpStore.getState().configTab).toBe('headers')
    expect(screen.getByTestId('mcp-config-panel-headers')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-headers-section')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+ Add Header/i })).toBeInTheDocument()
    // Clicking the active tab again keeps it open — only the chevron folds.
    fireEvent.click(screen.getByTestId('mcp-config-tab-headers'))
    expect(screen.getByTestId('mcp-headers-section')).toBeInTheDocument()
  })

  it('the chevron folds / unfolds the panel; a tab click unfolds it too', () => {
    render(<McpConfigTabs />)
    const chevron = screen.getByTestId('mcp-config-collapse')
    expect(chevron).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(chevron)
    expect(useMcpStore.getState().configCollapsed).toBe(true)
    expect(screen.queryByTestId('mcp-config-panel-auth')).toBeNull()
    expect(screen.getByTestId('mcp-config-collapse')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByTestId('mcp-config-tab-auth'))
    expect(screen.getByTestId('mcp-config-panel-auth')).toBeInTheDocument()
    expect(useMcpStore.getState().configCollapsed).toBe(false)
  })

  it('count badges show enabled rows with a key; the auth tab gets a dot once a type is set', () => {
    useMcpStore.setState({
      customHeaders: [
        { id: 'a', key: 'X-A', value: '1', enabled: true },
        { id: 'b', key: 'X-B', value: '2', enabled: false },
        { id: 'c', key: '', value: '3', enabled: true },
      ],
    })
    render(<McpConfigTabs />)
    expect(screen.getByTestId('mcp-headers-count')).toHaveTextContent('1')
    expect(screen.queryByTestId('mcp-config-auth-dot')).toBeNull()
    act(() => useMcpStore.getState().setAuth({ type: 'bearer', bearer: { token: 't' } }))
    expect(screen.getByTestId('mcp-config-auth-dot')).toBeInTheDocument()
  })

  it('a stored Headers tab falls back to Authorization on stdio without rewriting the store', () => {
    useMcpStore.setState({ configTab: 'headers', transport: 'stdio' })
    render(<McpConfigTabs />)
    expect(screen.getByTestId('mcp-config-panel-auth')).toBeInTheDocument()
    expect(useMcpStore.getState().configTab).toBe('headers')
  })
})

describe('McpAuthSection — each type renders its fields and writes the store', () => {
  const pick = (type: string): void => {
    fireEvent.change(screen.getByTestId('mcp-auth-type'), { target: { value: type } })
  }

  it('offers No Auth, Basic, Bearer, API Key and OAuth 2.1', () => {
    render(<McpAuthSection />)
    const options = within(screen.getByTestId('mcp-auth-type'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options).toEqual(['No Auth', 'Basic Auth', 'Bearer Token', 'API Key', 'OAuth 2.1'])
  })

  it('basic: username + masked password with a show toggle', () => {
    render(<McpAuthSection />)
    pick('basic')
    fireEvent.change(screen.getByTestId('mcp-auth-basic-username'), {
      target: { value: '{{user}}' },
    })
    const pass = screen.getByTestId('mcp-auth-basic-password')
    expect(pass).toHaveAttribute('type', 'password')
    fireEvent.change(pass, { target: { value: 's3cret' } })
    fireEvent.click(screen.getByTestId('mcp-auth-basic-password-toggle'))
    expect(screen.getByTestId('mcp-auth-basic-password')).toHaveAttribute('type', 'text')
    expect(useMcpStore.getState().auth).toEqual({
      type: 'basic',
      basic: { username: '{{user}}', password: 's3cret' },
    })
    expect(screen.getByTestId('mcp-auth-preview')).toHaveTextContent('Authorization: Basic')
    expect(screen.getByTestId('mcp-auth-preview')).not.toHaveTextContent('s3cret')
  })

  it('bearer: token + optional prefix; the preview names the prefix, never the token', () => {
    render(<McpAuthSection />)
    pick('bearer')
    fireEvent.change(screen.getByTestId('mcp-auth-bearer-token'), { target: { value: 'tok-1' } })
    fireEvent.change(screen.getByTestId('mcp-auth-bearer-prefix'), { target: { value: 'Token' } })
    expect(useMcpStore.getState().auth).toEqual({
      type: 'bearer',
      bearer: { token: 'tok-1', prefix: 'Token' },
    })
    const preview = screen.getByTestId('mcp-auth-preview')
    expect(preview).toHaveTextContent('Authorization: Token <token>')
    expect(preview).not.toHaveTextContent('tok-1')
  })

  it('api key: key, value and Header / Query placement', () => {
    render(<McpAuthSection />)
    pick('api-key')
    fireEvent.change(screen.getByTestId('mcp-auth-apikey-key'), { target: { value: 'api_key' } })
    fireEvent.change(screen.getByTestId('mcp-auth-apikey-value'), { target: { value: 'k-1' } })
    fireEvent.change(screen.getByTestId('mcp-auth-apikey-in'), { target: { value: 'query' } })
    expect(useMcpStore.getState().auth).toEqual({
      type: 'api-key',
      apiKey: { key: 'api_key', value: 'k-1', in: 'query' },
    })
    expect(screen.getByTestId('mcp-auth-preview')).toHaveTextContent('?api_key=<value>')
  })

  it('switching type keeps what was typed for the other types', () => {
    render(<McpAuthSection />)
    pick('bearer')
    fireEvent.change(screen.getByTestId('mcp-auth-bearer-token'), { target: { value: 'keep' } })
    pick('basic')
    pick('bearer')
    expect(screen.getByTestId('mcp-auth-bearer-token')).toHaveValue('keep')
  })

  it('every type has its one-line description; stdio shows a note instead of fields', () => {
    render(<McpAuthSection />)
    expect(screen.getByTestId('mcp-auth-none')).toHaveTextContent(
      'This request does not use any authorization.',
    )
    expect(screen.queryByTestId('mcp-auth-description')).toBeNull()
    pick('bearer')
    expect(screen.getByTestId('mcp-auth-description')).toHaveTextContent(/Authorization header/)
    act(() => useMcpStore.getState().setTransport('stdio'))
    expect(screen.getByTestId('mcp-auth-stdio-note')).toHaveTextContent(/stdio/)
    expect(screen.queryByTestId('mcp-auth-preview')).toBeNull()
    expect(screen.queryByTestId('mcp-auth-bearer-token')).toBeNull()
  })
})

describe('review item 12: the capability pane (and its Run button) can never be squeezed to zero', () => {
  it('Messages pane is capped at half the editor, shrinks first; Scripts at 40vh; the middle keeps a floor', () => {
    window.localStorage.setItem(
      'testnizer-mcp-messages-pane',
      JSON.stringify({ open: true, height: 600 }),
    )
    useMcpStore.setState({ configTab: 'scripts', configCollapsed: false })
    render(<McpEditor />)
    const pane = screen.getByTestId('mcp-messages-pane')
    expect(pane.className).toContain('max-h-[50%]')
    expect(pane.className).not.toContain('shrink-0')
    const scripts = screen.getByTestId('mcp-config-panel-scripts')
    expect(scripts.className).toContain('max-h-[40vh]')
    // A fixed min-height would beat the max on a short window.
    expect(scripts.className).not.toContain('min-h-[220px]')
    expect(screen.getByTestId('mcp-editor-body').className).toContain('min-h-[120px]')
  })
})
