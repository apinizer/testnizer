/**
 * Issue #180 / #199 review fixes on the renderer side:
 *  - an ad-hoc tool server's URL / stdio command line / env never carries a
 *    LITERAL credential into the saved request or the tab snapshot (session
 *    keeps it, the session-only note shows);
 *  - "Allow this tool for this conversation" grants and the loaded catalog of
 *    an ad-hoc server are dropped when its URL / command / env changes;
 *  - the Tools-tab trust card's "Trust and connect" redeems main's token for
 *    the subject the card showed (no config rebuilt at click time);
 *  - the trust card shows env VALUES (credential-named masked) and flags
 *    dangerous names;
 *  - Save As of an AI tab compares the conversations' owner id.
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const api = vi.hoisted(() => ({
  listServerTools: vi.fn(),
  trustServerTools: vi.fn(),
}))

vi.hoisted(() => {
  const g = globalThis as unknown as { window: { api?: unknown } }
  g.window.api = {
    aiChat: {
      send: vi.fn(),
      cancel: vi.fn(),
      listServerTools: api.listServerTools,
      trustServerTools: api.trustServerTools,
      onChunk: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
      onCancelled: () => () => {},
      onEvent: () => () => {},
    },
  }
})

import { useAiChatStore, sanitizeAiTabState } from '../../src/renderer/stores/ai-chat.store'
import {
  loadServerTools,
  trustServerTools,
  updateToolServer,
} from '../../src/renderer/stores/ai-chat-tools'
import { aiSaveAsAction } from '../../src/renderer/stores/ai-chat-conversations'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import {
  hasSessionOnlyServerCredential,
  readToolServers,
  savedToolServersOf,
  stripCommandLineCredentials,
  stripUrlCredentials,
  type AiToolServerConfig,
} from '../../src/renderer/lib/ai-chat-tools-config'
import AiChatTrustCard from '../../src/renderer/components/protocols/ai-chat/AiChatTrustCard'
import { stdioEnvDisplay } from '../../src/shared/ai-stdio-env'

const adhoc = (patch: Partial<AiToolServerConfig> = {}): AiToolServerConfig => ({
  id: 'srv',
  source: 'adhoc',
  name: 'S',
  enabled: true,
  transport: 'http',
  url: 'http://127.0.0.1:9/mcp',
  headers: [],
  envVars: [],
  disabledTools: [],
  ...patch,
})

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', name: 'AI', protocol: 'ai', isDirty: false, isLoading: false }],
    activeTabId: 'tab-1',
  } as never)
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    getActiveVariables: () => ({}),
  } as never)
  useAiChatStore.setState({
    toolServers: [],
    toolCatalog: {},
    allowedTools: [],
    autoApproveTools: false,
    _tabStates: new Map(),
    _currentTabId: 'tab-1',
  })
})

describe('literal credentials in an ad-hoc URL / command line / env are session-only', () => {
  it('URL: userinfo and credential query params removed; {{var}} and other params kept', () => {
    expect(stripUrlCredentials('https://u:pw-SECRET@h/mcp?api_key=K-SECRET&tenant=a#x')).toBe(
      'https://h/mcp?tenant=a#x',
    )
    expect(stripUrlCredentials('{{base}}/mcp?token=T-SECRET')).toBe('{{base}}/mcp')
    expect(stripUrlCredentials('{{base}}/mcp?token={{tok}}&keyword=x')).toBe(
      '{{base}}/mcp?token={{tok}}&keyword=x',
    )
    expect(stripUrlCredentials('https://{{u}}:{{p}}@h/mcp')).toBe('https://{{u}}:{{p}}@h/mcp')
  })

  it('command line: credential flags (inline and spaced) removed with their value', () => {
    expect(
      stripCommandLineCredentials(
        'npx srv --api-key=K-SECRET --token T-SECRET --password "P SECRET" --port 3000',
      ),
    ).toBe('npx srv --port 3000')
    // `{{var}}`, a flag followed by another flag, and `--no-auth` are kept; untouched text is verbatim.
    const keep = 'node "my server.js" --token {{tok}} --auth --verbose --no-auth x'
    expect(stripCommandLineCredentials(keep)).toBe(keep)
    expect(stripCommandLineCredentials('uvx srv https://u:p-SECRET@h/x')).toBe(
      'uvx srv https://h/x',
    )
  })

  it('saved config + tab snapshot hold none of them; the session keeps them and shows the note', () => {
    const server = adhoc({
      transport: 'stdio',
      url: 'npx srv --token T-SECRET',
      envVars: [
        { id: '1', key: 'DATABASE_URL', value: 'postgres://u:DB-SECRET@h/db', enabled: true },
        { id: '2', key: 'MODE', value: 'x', enabled: true },
        { id: '3', key: 'HOME_URL', value: 'https://example.com', enabled: true },
      ],
    })
    const httpServer = adhoc({ id: 'h', url: 'https://h/mcp?access_token=A-SECRET' })
    const saved = savedToolServersOf([server, httpServer])
    const json = JSON.stringify(saved)
    for (const secret of ['T-SECRET', 'DB-SECRET', 'A-SECRET']) expect(json).not.toContain(secret)
    expect(saved[0].url).toBe('npx srv')
    expect(saved[0].envVars?.map((r) => r.key)).toEqual(['MODE', 'HOME_URL'])
    expect(saved[1].url).toBe('https://h/mcp')

    useAiChatStore.setState({ toolServers: [server, httpServer] })
    const snap = JSON.stringify(sanitizeAiTabState({ ...useAiChatStore.getState() }))
    for (const secret of ['T-SECRET', 'DB-SECRET', 'A-SECRET']) expect(snap).not.toContain(secret)
    // In memory the literal still works for this session.
    expect(useAiChatStore.getState().toolServers[0].url).toBe('npx srv --token T-SECRET')
    expect(hasSessionOnlyServerCredential([server])).toBe(true)
    expect(hasSessionOnlyServerCredential([httpServer])).toBe(true)
    expect(hasSessionOnlyServerCredential([adhoc({ url: '{{base}}/mcp?token={{t}}' })])).toBe(false)

    // An older saved row that still carries them is cleaned on read.
    const read = readToolServers([{ ...server, source: 'adhoc' }])
    expect(JSON.stringify(read)).not.toContain('T-SECRET')
    expect(JSON.stringify(read)).not.toContain('DB-SECRET')
  })
})

describe('grants follow the server identity', () => {
  it('editing an ad-hoc server URL / command / env drops its grants and catalog; a rename does not', () => {
    useAiChatStore.setState({
      toolServers: [adhoc(), adhoc({ id: 'other' })],
      allowedTools: ['srv::get', 'srv::delete', 'other::get'],
      toolCatalog: { srv: { tools: [{ name: 'get' }] } },
    })
    updateToolServer('srv', { name: 'Renamed' })
    expect(useAiChatStore.getState().allowedTools).toEqual([
      'srv::get',
      'srv::delete',
      'other::get',
    ])
    updateToolServer('srv', { url: 'http://evil.example/mcp' })
    expect(useAiChatStore.getState().allowedTools).toEqual(['other::get'])
    expect(useAiChatStore.getState().toolCatalog.srv).toBeUndefined()

    useAiChatStore.setState({ allowedTools: ['other::get'] })
    updateToolServer('other', {
      envVars: [{ id: 'e', key: 'NODE_OPTIONS', value: '--require x', enabled: true }],
    })
    expect(useAiChatStore.getState().allowedTools).toEqual([])
  })
})

describe("Tools-tab trust card uses main's token for the subject it showed", () => {
  it('"Load tools" stores the card with its token; "Trust and connect" redeems only the token', async () => {
    useAiChatStore.setState({
      toolServers: [adhoc({ transport: 'stdio', url: 'node server.js' })],
    })
    api.listServerTools.mockResolvedValue({
      success: true,
      data: {
        untrusted: {
          commandLine: 'node server.js',
          envNames: [],
          env: [],
          trustToken: 'tok-1',
        },
      },
    })
    await loadServerTools('srv')
    expect(useAiChatStore.getState().toolCatalog.srv?.untrusted?.trustToken).toBe('tok-1')
    expect(api.listServerTools.mock.calls[0][1]).not.toHaveProperty('trust')

    // The row is edited before the click: the click must not send the new config.
    updateToolServer('srv', { name: 'still same command' })
    api.trustServerTools.mockResolvedValue({ success: true, data: { tools: [{ name: 'get' }] } })
    await trustServerTools('srv', 'tok-1')
    expect(api.trustServerTools).toHaveBeenCalledWith('tok-1')
    expect(api.listServerTools).toHaveBeenCalledTimes(1)
    expect(useAiChatStore.getState().toolCatalog.srv?.tools).toEqual([{ name: 'get' }])
  })
})

describe('trust card shows env values (trust covers them)', () => {
  it('values shown, credential-named masked, dangerous names flagged with a warning', () => {
    const env = stdioEnvDisplay({
      NODE_OPTIONS: '--require ./evil.js',
      LD_PRELOAD: '/tmp/x.so',
      GITHUB_TOKEN: 'ghp-SECRET',
      MODE: 'debug',
    })
    render(<AiChatTrustCard commandLine="node server.js" envNames={[]} env={env} />)
    const rows = screen.getAllByTestId('ai-stdio-env-row').map((r) => r.textContent ?? '')
    expect(rows[0]).toContain('NODE_OPTIONS=--require ./evil.js')
    expect(rows[1]).toContain('LD_PRELOAD=/tmp/x.so')
    expect(rows[2]).toContain('GITHUB_TOKEN=••••••')
    expect(rows[3]).toContain('MODE=debug')
    expect(document.body.textContent).not.toContain('ghp-SECRET')
    expect(screen.getAllByTestId('ai-stdio-env-dangerous')).toHaveLength(2)
    expect(screen.getByTestId('ai-stdio-env-dangerous-warning')).toBeTruthy()
  })

  it('a dangerous value is never cut or masked by a credential-looking padding', () => {
    const padded = `${' '.repeat(5000)}--require ./evil.js`
    const [row] = stdioEnvDisplay({ NODE_OPTIONS: padded })
    expect(row.value).toBe(padded)
    expect(row.masked).toBeUndefined()
    const [url] = stdioEnvDisplay({ NPM_CONFIG_REGISTRY: 'https://u:p-SECRET@reg/' })
    expect(url).toMatchObject({ dangerous: true, value: 'https://••••••@reg/' })
  })
})

describe('Save As keeps conversations by owner id (#199)', () => {
  it('rehome / fresh / keep', () => {
    expect(aiSaveAsAction({ id: 't' }, 'sr-new')).toBe('rehome')
    expect(aiSaveAsAction({ id: 't', savedRequestId: 'sr-1' }, 'sr-1')).toBe('keep')
    expect(aiSaveAsAction({ id: 't', savedRequestId: 'sr-1' }, 'sr-2')).toBe('fresh')
    // Endpoint-backed tab saved as a request: the owner changes.
    expect(aiSaveAsAction({ id: 't', endpointId: 'ep-1' }, 'sr-2')).toBe('fresh')
    // Suite-item tab: the suite item still owns the conversations after Save As.
    expect(aiSaveAsAction({ id: 't', testSuiteItemId: 'si-1' }, 'sr-2')).toBe('keep')
  })
})
