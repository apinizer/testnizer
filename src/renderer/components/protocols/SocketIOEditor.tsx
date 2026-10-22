import { Plug, Radio, Unplug, X } from 'lucide-react'
import { useSocketIOStore } from '../../stores/socketio.store'
import EmptyState from '../shared/EmptyState'
import { T } from '../../styles/tokens'
import { useTranslation } from '../../lib/i18n'
import McpStatusPill from './mcp/McpStatusPill'
import {
  CB_ERROR_BOX,
  CB_INPUT,
  CB_ROW,
  CB_TARGET,
  CB_URL,
  cbPrimaryButton,
} from './connection-bar-ui'

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
  const { t, locale } = useTranslation()
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
      {/* ─ Connection bar ─ the WS / SSE / MCP bars' sizes and wrap rule
          (`connection-bar-ui.ts`): status pill, then URL + Connect as one
          group; namespace and token on their own row under it so they never
          squeeze the URL or push Connect off the line. */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
        <div data-testid="socketio-connection-row" className={CB_ROW}>
          <McpStatusPill state={store.connectionState} testId="socketio-status" />
          <div className={CB_TARGET}>
            <input
              type="text"
              value={store.url}
              onChange={(e) => store.setUrl(e.target.value)}
              disabled={isConnected}
              data-testid="socketio-url"
              placeholder="http://localhost:3000"
              className={CB_URL}
            />
            <button
              type="button"
              onClick={
                isConnected || isConnecting ? () => store.disconnect() : () => store.connect()
              }
              disabled={!isConnected && !isConnecting && !store.url.trim()}
              data-testid="socketio-connect"
              className={cbPrimaryButton(isConnected || isConnecting)}
            >
              {isConnecting ? (
                <X size={14} />
              ) : isConnected ? (
                <Unplug size={14} />
              ) : (
                <Plug size={14} />
              )}
              {isConnecting
                ? t('common.cancel')
                : isConnected
                  ? t('mcp.disconnect')
                  : t('mcp.connect')}
            </button>
          </div>
        </div>
        <div data-testid="socketio-options-row" className={CB_ROW}>
          <input
            type="text"
            value={store.namespace}
            onChange={(e) => store.setNamespace(e.target.value)}
            disabled={isConnected}
            data-testid="socketio-namespace"
            aria-label={t('socketio.namespace')}
            placeholder={t('socketio.namespacePlaceholder')}
            className={`w-[10rem] ${CB_INPUT}`}
          />
          <input
            type="password"
            value={store.bearerToken}
            onChange={(e) => store.setBearerToken(e.target.value)}
            disabled={isConnected}
            data-testid="socketio-bearer-token"
            aria-label={t('socketio.tokenPlaceholder')}
            aria-describedby="socketio-token-hint"
            placeholder={t('socketio.tokenPlaceholder')}
            className={`w-[16rem] max-w-full ${CB_INPUT}`}
          />
        </div>
        {(store.connectionState === 'error' || store.connectionState === 'connected') &&
          store.errorMessage && (
            <div data-testid="socketio-error" role="alert" className={CB_ERROR_BOX}>
              {store.errorMessage}
            </div>
          )}
        {/* Issue #243: the literal token is never written to localStorage. */}
        <p
          id="socketio-token-hint"
          data-testid="socketio-token-hint"
          className="m-0 text-[11px] text-[var(--muted)]"
        >
          {t('socketio.tokenHint')}
        </p>
      </div>

      {/* ─ Body ─ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }} lang={locale}>
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
              {t('socketio.emitEvent')}
            </div>
            <input
              type="text"
              value={store.emitEvent}
              onChange={(e) => store.setEmitEvent(e.target.value)}
              placeholder={t('socketio.eventNamePlaceholder')}
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
              {t('socketio.emit')}
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
              {t('socketio.subscribe')}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="text"
                value={store.newSubscription}
                onChange={(e) => store.setNewSubscription(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && store.subscribe()}
                placeholder={t('socketio.eventNamePlaceholder')}
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
              <EmptyState
                icon={Radio}
                title={t('socketio.noSubscriptions')}
                variant="compact"
                size="sm"
              />
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
              {t('socketio.eventTimeline')} {store.events.length > 0 && `(${store.events.length})`}
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
                {t('console.clear')}
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
                {isConnected ? t('sse.waitingForEvents') : t('socketio.connectToSee')}
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
