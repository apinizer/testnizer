import { useMcpStore, type McpTransport } from '../../stores/mcp.store'
import { T } from '../../styles/tokens'

const TRANSPORT_OPTIONS: { value: McpTransport; label: string }[] = [
  { value: 'http', label: 'Streamable HTTP' },
  { value: 'sse', label: 'SSE (legacy)' },
  { value: 'stdio', label: 'stdio (local)' },
]

export default function McpEditor() {
  const store = useMcpStore()
  const isConnected = store.connectionState === 'connected'
  const isConnecting = store.connectionState === 'connecting'

  const selectedToolDef = store.tools.find((t) => t.name === store.selectedTool)
  const hasSchema =
    selectedToolDef?.inputSchema && Object.keys(selectedToolDef.inputSchema).length > 0

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--white)',
        overflow: 'hidden',
      }}
    >
      {/* ─ Connection bar ─ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <select
          value={store.transport}
          onChange={(e) => store.setTransport(e.target.value as McpTransport)}
          disabled={isConnected}
          style={{
            height: 32,
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            padding: '0 8px',
            fontSize: 12,
            background: 'var(--white)',
            color: T.text,
            cursor: isConnected ? 'not-allowed' : 'pointer',
          }}
        >
          {TRANSPORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={store.url}
          onChange={(e) => store.setUrl(e.target.value)}
          disabled={isConnected}
          placeholder={
            store.transport === 'stdio'
              ? 'e.g. npx @modelcontextprotocol/server-everything'
              : 'https://mcp.example.com/mcp'
          }
          style={{
            flex: 1,
            minWidth: 200,
            height: 32,
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            padding: '0 10px',
            fontSize: 13,
            color: T.text,
            background: isConnected ? 'var(--bg)' : 'var(--white)',
          }}
        />

        <button
          type="button"
          onClick={isConnected ? () => store.disconnect() : () => store.connect()}
          disabled={isConnecting}
          style={{
            height: 32,
            padding: '0 16px',
            borderRadius: 6,
            border: 'none',
            background: isConnected ? T.DELETE.color : T.accent,
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: isConnecting ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
        >
          {isConnecting ? 'Connecting…' : isConnected ? 'Disconnect' : 'Connect'}
        </button>

        {isConnected && store.serverName && (
          <span style={{ fontSize: 12, color: T.muted }}>{store.serverName}</span>
        )}
        {store.connectionState === 'error' && store.errorMessage && (
          <span style={{ fontSize: 12, color: T.DELETE.color }}>{store.errorMessage}</span>
        )}
      </div>

      {/* ─ Body ─ */}
      <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>
        {/* Left: tool list */}
        <div
          style={{
            width: 200,
            borderRight: `1px solid ${T.border}`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              fontSize: 11,
              fontWeight: 600,
              color: T.muted,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderBottom: `1px solid ${T.border}`,
            }}
          >
            Tools {store.tools.length > 0 && `(${store.tools.length})`}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!isConnected && (
              <div style={{ padding: 16, fontSize: 12, color: T.ghost, textAlign: 'center' }}>
                Connect to see tools
              </div>
            )}
            {store.tools.map((tool) => (
              <button
                key={tool.name}
                type="button"
                onClick={() => store.setSelectedTool(tool.name)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  border: 'none',
                  borderBottom: `1px solid ${T.border}`,
                  background: store.selectedTool === tool.name ? T.accentBg : 'transparent',
                  color: store.selectedTool === tool.name ? T.accentText : T.text,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{tool.name}</div>
                {tool.description && (
                  <div
                    style={{
                      fontSize: 11,
                      color: T.muted,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {tool.description}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right: arguments + result */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!store.selectedTool ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                color: T.ghost,
              }}
            >
              {isConnected ? 'Select a tool from the list' : 'Connect to an MCP server'}
            </div>
          ) : (
            <>
              {/* Arguments pane */}
              <div
                style={{
                  borderBottom: `1px solid ${T.border}`,
                  padding: '10px 14px',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: T.muted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 8,
                  }}
                >
                  Arguments (JSON)
                </div>
                {hasSchema && (
                  <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>
                    <strong>Schema:</strong>{' '}
                    {JSON.stringify(
                      selectedToolDef?.inputSchema?.properties ?? selectedToolDef?.inputSchema,
                    )}
                  </div>
                )}
                <textarea
                  value={store.toolArgs}
                  onChange={(e) => store.setToolArgs(e.target.value)}
                  rows={5}
                  style={{
                    width: '100%',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    border: `1px solid ${T.border}`,
                    borderRadius: 6,
                    padding: 8,
                    resize: 'vertical',
                    color: T.text,
                    background: 'var(--white)',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => store.callTool()}
                  disabled={store.isInvoking}
                  style={{
                    marginTop: 8,
                    height: 32,
                    padding: '0 20px',
                    borderRadius: 6,
                    border: 'none',
                    background: T.accent,
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: store.isInvoking ? 'not-allowed' : 'pointer',
                  }}
                >
                  {store.isInvoking ? 'Invoking…' : `Invoke ${store.selectedTool}`}
                </button>
              </div>

              {/* Result pane */}
              <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: T.muted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 8,
                  }}
                >
                  Result
                </div>
                {store.resultError ? (
                  <div style={{ color: T.DELETE.color, fontSize: 12 }}>{store.resultError}</div>
                ) : store.result != null ? (
                  <pre
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: T.text,
                      margin: 0,
                    }}
                  >
                    {JSON.stringify(store.result, null, 2)}
                  </pre>
                ) : (
                  <div style={{ color: T.ghost, fontSize: 12 }}>No result yet</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
