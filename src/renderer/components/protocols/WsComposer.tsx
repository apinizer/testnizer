import { Send } from 'lucide-react'
import { useWebSocketStore } from '../../stores/websocket.store'
import MonacoWrapper from '../shared/MonacoWrapper'

export default function WsComposer() {
  const composerContent = useWebSocketStore((s) => s.composerContent)
  const setComposerContent = useWebSocketStore((s) => s.setComposerContent)
  const composerMode = useWebSocketStore((s) => s.composerMode)
  const setComposerMode = useWebSocketStore((s) => s.setComposerMode)
  const sendMessage = useWebSocketStore((s) => s.sendMessage)
  const connectionState = useWebSocketStore((s) => s.connectionState)

  const isConnected = connectionState === 'connected'

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="font-medium uppercase tracking-widest text-[var(--muted)]">Message</label>
        <div className="flex rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setComposerMode('json')}
            className="cursor-pointer px-3 py-1 font-medium transition-colors"
            style={{
              background: composerMode === 'json' ? 'var(--accent)' : 'transparent',
              color: composerMode === 'json' ? 'white' : 'var(--muted)',
              border: 'none',
              borderRadius: composerMode === 'json' ? '7px' : '0',
            }}
          >
            JSON
          </button>
          <button
            type="button"
            onClick={() => setComposerMode('text')}
            className="cursor-pointer px-3 py-1 font-medium transition-colors"
            style={{
              background: composerMode === 'text' ? 'var(--accent)' : 'transparent',
              color: composerMode === 'text' ? 'white' : 'var(--muted)',
              border: 'none',
              borderRadius: composerMode === 'text' ? '7px' : '0',
            }}
          >
            Text
          </button>
        </div>
      </div>

      <div data-testid="ws-composer" className="flex-1 min-h-0">
        <MonacoWrapper
          value={composerContent}
          onChange={setComposerContent}
          language={composerMode === 'json' ? 'json' : 'plaintext'}
          height={120}
        />
      </div>

      <button
        type="button"
        onClick={sendMessage}
        disabled={!isConnected || !composerContent.trim()}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg py-2 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: 'var(--accent)', border: 'none' }}
      >
        <Send size={14} />
        Send Message
      </button>
    </div>
  )
}
