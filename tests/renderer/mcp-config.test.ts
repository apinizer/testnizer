/**
 * Issue #139 — MCP host config paste / export (`lib/mcp-config.ts`).
 *
 * Pins the three host shapes (checked against each host's docs, 2026-10):
 *  - Claude Desktop: `{ mcpServers: { name: { command, args?, env? } } }` —
 *    stdio only; a remote server is exported through the `mcp-remote` bridge
 *    (modelcontextprotocol.io/docs/develop/connect-local-servers,
 *    support.claude.com/en/articles/11175166, github.com/geelen/mcp-remote).
 *  - VS Code: `{ servers: { name: { type: 'stdio'|'http'|'sse', … } }, inputs? }`
 *    (code.visualstudio.com/docs/agents/reference/mcp-configuration).
 *  - Cursor: `{ mcpServers: { name: { type: 'stdio', command, … } | { url, headers? } } }`
 *    (cursor.com/docs/context/mcp).
 */
import { describe, expect, it } from 'vitest'
import {
  formatMcpConfig,
  parseMcpConfig,
  serverFromTabFields,
  tabUrlForServer,
  McpConfigError,
  type McpConfigHost,
  type ParsedMcpServer,
} from '../../src/renderer/lib/mcp-config'
import {
  joinCommandLine,
  parseCommandLine,
  tokenizeCommandLine,
} from '../../src/shared/mcp-call'

const STDIO: ParsedMcpServer = {
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Docs'],
  env: { API_KEY: 'k-1' },
}
const HTTP: ParsedMcpServer = {
  name: 'gateway',
  transport: 'http',
  url: 'https://gw.example.com/apigateway/project1/mcp',
  headers: { Authorization: 'Bearer abc', 'X-Gateway-Project': 'project1' },
}
const SSE: ParsedMcpServer = {
  name: 'legacy',
  transport: 'sse',
  url: 'http://10.0.0.5:8080/sse',
  headers: { 'X-Api-Key': 'k' },
}

const HOSTS: McpConfigHost[] = ['claude-desktop', 'vscode', 'cursor']

describe('formatMcpConfig → parseMcpConfig round-trip', () => {
  for (const host of HOSTS) {
    for (const server of [STDIO, HTTP, SSE]) {
      it(`${host} / ${server.transport}`, () => {
        const text = formatMcpConfig(server, host)
        expect(parseMcpConfig(text)).toEqual([server])
      })
    }
  }
})

describe('formatMcpConfig — real host shapes', () => {
  it('Claude Desktop stdio is { mcpServers: { name: { command, args, env } } } with no type', () => {
    expect(JSON.parse(formatMcpConfig(STDIO, 'claude-desktop'))).toEqual({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Docs'],
          env: { API_KEY: 'k-1' },
        },
      },
    })
  })

  it('Claude Desktop remote goes through npx mcp-remote with headers in env', () => {
    const doc = JSON.parse(formatMcpConfig(HTTP, 'claude-desktop'))
    expect(doc).toEqual({
      mcpServers: {
        gateway: {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            'https://gw.example.com/apigateway/project1/mcp',
            '--transport',
            'http-only',
            '--header',
            'Authorization:${MCP_HEADER_AUTHORIZATION}',
            '--header',
            'X-Gateway-Project:${MCP_HEADER_X_GATEWAY_PROJECT}',
          ],
          env: {
            MCP_HEADER_AUTHORIZATION: 'Bearer abc',
            MCP_HEADER_X_GATEWAY_PROJECT: 'project1',
          },
        },
      },
    })
  })

  it('Claude Desktop remote adds --allow-http for a non-localhost http:// URL only', () => {
    const sse = JSON.parse(formatMcpConfig(SSE, 'claude-desktop')).mcpServers.legacy
    expect(sse.args).toContain('--allow-http')
    expect(sse.args).toContain('sse-only')
    const local = JSON.parse(
      formatMcpConfig(
        { name: 'l', transport: 'http', url: 'http://127.0.0.1:3000/mcp' },
        'claude-desktop',
      ),
    ).mcpServers.l
    expect(local.args).not.toContain('--allow-http')
    expect(local).not.toHaveProperty('env')
  })

  it('VS Code uses `servers` and always writes `type`', () => {
    expect(JSON.parse(formatMcpConfig(HTTP, 'vscode'))).toEqual({
      servers: { gateway: { type: 'http', url: HTTP.url, headers: HTTP.headers } },
    })
    expect(JSON.parse(formatMcpConfig(STDIO, 'vscode')).servers.filesystem.type).toBe('stdio')
    expect(JSON.parse(formatMcpConfig(SSE, 'vscode')).servers.legacy.type).toBe('sse')
  })

  it('Cursor uses `mcpServers`; stdio carries type, remote is { url, headers }', () => {
    expect(JSON.parse(formatMcpConfig(HTTP, 'cursor'))).toEqual({
      mcpServers: { gateway: { url: HTTP.url, headers: HTTP.headers } },
    })
    expect(JSON.parse(formatMcpConfig(STDIO, 'cursor')).mcpServers.filesystem).toEqual({
      type: 'stdio',
      command: 'npx',
      args: STDIO.args,
      env: STDIO.env,
    })
  })
})

describe('parseMcpConfig — accepted inputs', () => {
  it('Claude Desktop doc example (several servers)', () => {
    const text = JSON.stringify({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
        brave: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-brave-search'],
          env: { BRAVE_API_KEY: 'x' },
        },
      },
    })
    const servers = parseMcpConfig(text)
    expect(servers.map((s) => [s.name, s.transport, s.command])).toEqual([
      ['filesystem', 'stdio', 'npx'],
      ['brave', 'stdio', 'npx'],
    ])
    expect(servers[1].env).toEqual({ BRAVE_API_KEY: 'x' })
  })

  it('mcp-remote README example (header value from env, no --transport flag)', () => {
    const [s] = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          'remote-example': {
            command: 'npx',
            args: [
              'mcp-remote',
              'https://remote.mcp.server/sse',
              '--header',
              'Authorization:${AUTH_HEADER}',
            ],
            env: { AUTH_HEADER: 'Bearer tok' },
          },
        },
      }),
    )
    expect(s).toEqual({
      name: 'remote-example',
      transport: 'sse',
      url: 'https://remote.mcp.server/sse',
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('VS Code JSONC with comments, trailing commas and an `inputs` block', () => {
    const text = `{
      // Inputs are prompted by VS Code — ignored here
      "inputs": [{ "type": "promptString", "id": "api-token", "password": true }],
      "servers": {
        "slack": {
          "type": "http",
          "url": "https://mcp.slack.com/mcp", /* remote */
          "headers": { "Authorization": "Bearer \${input:api-token}" },
        },
        "playwright": { "command": "npx", "args": ["-y", "@microsoft/mcp-server-playwright"], },
      },
    }`
    expect(parseMcpConfig(text)).toEqual([
      {
        name: 'slack',
        transport: 'http',
        url: 'https://mcp.slack.com/mcp',
        headers: { Authorization: 'Bearer ${input:api-token}' },
      },
      {
        name: 'playwright',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@microsoft/mcp-server-playwright'],
      },
    ])
  })

  it('a URL containing // inside a string is not treated as a comment', () => {
    const [s] = parseMcpConfig('{ "url": "https://a.test//mcp" }')
    expect(s.url).toBe('https://a.test//mcp')
  })

  it('Cursor remote entry without type → transport guessed from the URL', () => {
    const servers = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          a: { url: 'http://localhost:3000/mcp', headers: { API_KEY: 'v' } },
          b: { url: 'http://localhost:3000/sse/' },
        },
      }),
    )
    expect(servers.map((s) => s.transport)).toEqual(['http', 'sse'])
    expect(servers[0].headers).toEqual({ API_KEY: 'v' })
  })

  it('bare single-server object', () => {
    expect(parseMcpConfig('{ "command": "node", "args": ["server.js"] }')).toEqual([
      { name: 'server', transport: 'stdio', command: 'node', args: ['server.js'] },
    ])
    expect(parseMcpConfig('{ "type": "sse", "url": "https://x.test/events" }')).toEqual([
      { name: 'server', transport: 'sse', url: 'https://x.test/events' },
    ])
  })

  it('a name → server map pasted without the wrapper key', () => {
    const [s] = parseMcpConfig('{ "brave": { "command": "npx", "args": ["-y", "pkg"] } }')
    expect(s).toMatchObject({ name: 'brave', transport: 'stdio', command: 'npx' })
  })
})

describe('parseMcpConfig — errors', () => {
  it('malformed JSON throws McpConfigError("Invalid JSON …")', () => {
    expect(() => parseMcpConfig('{ "mcpServers": { ')).toThrow(McpConfigError)
    expect(() => parseMcpConfig('{ "mcpServers": { ')).toThrow(/Invalid JSON/)
  })

  it('empty text, a JSON array, or no recognisable server all throw', () => {
    expect(() => parseMcpConfig('   ')).toThrow(McpConfigError)
    expect(() => parseMcpConfig('[1,2]')).toThrow(/JSON object/)
    expect(() => parseMcpConfig('{ "mcpServers": {} }')).toThrow(/No MCP servers/)
    expect(() => parseMcpConfig('{ "foo": 1 }')).toThrow(/No MCP servers/)
  })
})

describe('stdio command line <-> tab URL field', () => {
  it('tokenizer honours quotes and keeps Windows backslashes', () => {
    expect(tokenizeCommandLine('node "C:\\My Tools\\srv.js" --flag \'a b\'')).toEqual([
      'node',
      'C:\\My Tools\\srv.js',
      '--flag',
      'a b',
    ])
    expect(parseCommandLine('  npx   -y pkg ')).toEqual({ command: 'npx', args: ['-y', 'pkg'] })
  })

  it('join quotes args with spaces so the round-trip is lossless', () => {
    const line = joinCommandLine('npx', ['-y', 'pkg', '/Users/me/My Docs', 'say "hi"'])
    expect(line).toBe('npx -y pkg "/Users/me/My Docs" \'say "hi"\'')
    expect(parseCommandLine(line)).toEqual({
      command: 'npx',
      args: ['-y', 'pkg', '/Users/me/My Docs', 'say "hi"'],
    })
  })

  it('serverFromTabFields / tabUrlForServer round-trip a stdio server', () => {
    const url = tabUrlForServer(STDIO)
    expect(
      serverFromTabFields({ name: 'filesystem', transport: 'stdio', url, env: STDIO.env }),
    ).toEqual(STDIO)
    expect(tabUrlForServer(HTTP)).toBe(HTTP.url)
  })
})
