import { Plug, Radio, Unplug, X } from 'lucide-react'
import { useSocketIOStore } from '../../stores/socketio.store'
import EmptyState from '../shared/EmptyState'
import { T } from '../../styles/tokens'
import { useTranslation } from '../../lib/i18n'
import McpStatusPill from './mcp/McpStatusPill'

/** The MCP bar's URL field classes (`mcp/McpConnectionBar.tsx` URL_INPUT) — issue #224. */
const SIO_INPUT =
  'h-8 rounded-md border border-[var(--border)] px-2.5 font-mono text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] disabled:opacity-60'

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function SocketIOEditor() {
  const store = useSocketIOStore()
  const { t } = useTranslation()
  const isConnected = store.connectionState === 'connected'
  const isConnecting = store.connectionState === 'connecting'

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
      {/* ─ Connection bar ─ the MCP / SSE / WebSocket bars' anatomy (issue #224):
          shared token status pill, translated Connect / Cancel / Disconnect,
          red token error line — globals.css tokens only, no hex. */}
      <div
        data-testid="socketio-connection-row"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3.5 py-2.5"
      >
        <McpStatusPill state={store.connectionState} testId="socketio-status" />
        <input
          type="text"
          value={store.url}
          onChange={(e) => store.setUrl(e.target.value)}
          disabled={isConnected}
          data-testid="socketio-url"
          placeholder="http://localhost:3000"
          className={`min-w-[180px] flex-1 ${SIO_INPUT}`}
        />
        <input
          type="text"
          value={store.namespace}
          onChange={(e) => store.setNamespace(e.target.value)}
          disabled={isConnected}
          data-testid="socketio-namespace"
          aria-label={t('socketio.namespace')}
          placeholder={t('socketio.namespacePlaceholder')}
          className={`w-[120px] ${SIO_INPUT}`}
        />
        <input
          type="password"
          value={store.bearerToken}
          onChange={(e) => store.setBearerToken(e.target.value)}
          disabled={isConnected}
          data-testid="socketio-bearer-token"
          aria-describedby="socketio-token-hint"
          placeholder="Bearer token (optional)"
          style={{
            width: 160,
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
          onClick={isConnected || isConnecting ? () => store.disconnect() : () => store.connect()}
          disabled={!isConnected && !isConnecting && !store.url.trim()}
          data-testid="socketio-connect"
          className={`flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-none px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
            isConnected || isConnecting ? 'bg-[var(--mb-delete-fg)]' : 'bg-[var(--accent)]'
          }`}
        >
          {isConnecting ? <X size={14} /> : isConnected ? <Unplug size={14} /> : <Plug size={14} />}
          {isConnecting ? t('common.cancel') : isConnected ? t('mcp.disconnect') : t('mcp.connect')}
        </button>
        {(store.connectionState === 'error' || store.connectionState === 'connected') &&
          store.errorMessage && (
            <div
              data-testid="socketio-error"
              role="alert"
              className="basis-full break-words rounded-md border border-[var(--mb-delete-br)] bg-[var(--mb-delete-bg)] px-3 py-1.5 text-[12px] text-[var(--red)]"
            >
              {store.errorMessage}
            </div>
          )}
        {/* Issue #243: the literal token is never written to localStorage. */}
        <p
          id="socketio-token-hint"
          data-testid="socketio-token-hint"
          className="m-0 basis-full text-[var(--muted)]"
          style={{ fontSize: 11 }}
        >
          {t('socketio.tokenHint')}
        </p>
      </div>

      {/* ─ Body ─ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: emit + subscriptions */}
        <div
          style={{
            width: 280,
            borderRight: `1px solid ${T.border}`,
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          {/* Emit section */}
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>
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
              Emit Event
            </div>
            <input
              type="text"
              value={store.emitEvent}
              onChange={(e) => store.setEmitEvent(e.target.value)}
              placeholder="event name"
              style={{
                width: '100%',
                height: 28,
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: '0 8px',
                fontSize: 12,
                color: T.text,
                background: 'var(--white)',
                boxSizing: 'border-box',
                marginBottom: 6,
              }}
            />
            <textarea
              value={store.emitPayload}
              onChange={(e) => store.setEmitPayload(e.target.value)}
              rows={4}
              placeholder='{"key": "value"}'
              style={{
                width: '100%',
                fontFamily: 'monospace',
                fontSize: 12,
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: 6,
                resize: 'vertical',
                color: T.text,
                background: 'var(--white)',
                boxSizing: 'border-box',
                marginBottom: 6,
              }}
            />
            <button
              type="button"
              onClick={() => store.emit()}
              disabled={!isConnected}
              data-testid="socketio-emit"
              style={{
                width: '100%',
                height: 28,
                borderRadius: 6,
                border: 'none',
                background: isConnected ? T.accent : T.border,
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: isConnected ? 'pointer' : 'not-allowed',
              }}
            >
              Emit
            </button>
          </div>

          {/* Subscriptions section */}
          <div
            style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}
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
              Subscribe
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="text"
                value={store.newSubscription}
                onChange={(e) => store.setNewSubscription(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && store.subscribe()}
                placeholder="event name"
                style={{
                  flex: 1,
                  height: 28,
                  border: `1px solid ${T.border}`,
                  borderRadius: 6,
                  padding: '0 8px',
                  fontSize: 12,
                  color: T.text,
                  background: 'var(--white)',
                }}
              />
              <button
                type="button"
                onClick={() => store.subscribe()}
                disabled={!isConnected}
                style={{
                  height: 28,
                  padding: '0 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: isConnected ? T.accent : T.border,
                  color: '#fff',
                  fontSize: 12,
                  cursor: isConnected ? 'pointer' : 'not-allowed',
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* Active subscriptions */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {store.subscriptions.length === 0 ? (
              <EmptyState icon={Radio} title="No subscriptions yet" variant="compact" size="sm" />
            ) : (
              store.subscriptions.map((sub) => (
                <div
                  key={sub}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 12, color: T.text, fontFamily: 'monospace' }}>
                    {sub}
                  </span>
                  <button
                    type="button"
                    onClick={() => store.unsubscribe(sub)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: T.muted,
                      cursor: 'pointer',
                      fontSize: 13,
                      padding: '0 4px',
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: event timeline */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div
            style={{
              padding: '8px 12px',
              borderBottom: `1px solid ${T.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: T.muted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Event Timeline {store.events.length > 0 && `(${store.events.length})`}
            </span>
            {store.events.length > 0 && (
              <button
                type="button"
                onClick={() => store.clearEvents()}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 11,
                  color: T.muted,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            )}
          </div>
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {store.events.length === 0 ? (
              <div style={{ fontSize: 12, color: T.ghost, textAlign: 'center', marginTop: 20 }}>
                {isConnected ? 'Waiting for events…' : 'Connect to see events'}
              </div>
            ) : (
              [...store.events].reverse().map((ev, i) => (
                <div
                  key={i}
                  style={{
                    borderRadius: 6,
                    border: `1px solid ${T.border}`,
                    padding: '6px 10px',
                    background: ev.direction === 'in' ? 'var(--bg)' : T.accentBg,
                  }}
                >
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: ev.direction === 'in' ? T.text : T.accentText,
                      }}
                    >
                      {ev.direction === 'in' ? '↓ ' : '↑ '}
                      {ev.event}
                    </span>
                    <span style={{ fontSize: 10, color: T.ghost }}>{formatTime(ev.timestamp)}</span>
                  </div>
                  <pre
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: T.text,
                    }}
                  >
                    {typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
