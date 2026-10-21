import { useState, type ReactElement } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAiChatStore } from '../../../stores/ai-chat.store'
import { useTranslation } from '../../../lib/i18n'

/**
 * API key field of the AI Chat editor (issue #188). The key is stored per
 * provider, encrypted in main — never with the request and never in
 * localStorage. When the OS cannot encrypt, it is kept in memory only and a
 * short note says so. A tab opened from a mock server never loads the saved
 * key (issue #222): a note says so and offers to use it after all.
 */
export default function AiChatApiKeyField(): ReactElement {
  const { t } = useTranslation()
  const apiKey = useAiChatStore((s) => s.apiKey)
  const keyStorage = useAiChatStore((s) => s.keyStorage)
  const setApiKey = useAiChatStore((s) => s.setApiKey)
  const savedKeyDisabled = useAiChatStore((s) => s.savedKeyDisabled)
  const setSavedKeyDisabled = useAiChatStore((s) => s.setSavedKeyDisabled)
  const [showApiKey, setShowApiKey] = useState(false)

  return (
    <label className="flex flex-col gap-1" style={{ gridColumn: '1 / -1' }}>
      <span className="text-[var(--muted)]" style={{ fontSize: 12 }}>
        {t('aiChat.apiKey')}
      </span>
      <div className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--white)] focus-within:border-[var(--accent)]">
        <input
          type={showApiKey ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          data-testid="ai-api-key"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 bg-transparent px-2 py-1.5 font-mono text-[var(--text)] outline-none"
          style={{ fontSize: 13 }}
        />
        <button
          type="button"
          onClick={() => setShowApiKey((v) => !v)}
          className="flex h-7 w-7 cursor-pointer items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
          style={{ background: 'transparent', border: 'none' }}
          title={showApiKey ? t('aiChat.hideKey') : t('aiChat.showKey')}
        >
          {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {savedKeyDisabled ? (
        <span
          data-testid="ai-saved-key-disabled-note"
          role="status"
          className="flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--muted)]"
        >
          {t('aiChat.savedKeyDisabled')}
          <button
            type="button"
            data-testid="ai-use-saved-key"
            onClick={() => setSavedKeyDisabled(false)}
            className="cursor-pointer border-none bg-transparent p-0 text-[11px] text-[var(--accent-text)] underline"
          >
            {t('aiChat.useSavedKey')}
          </button>
        </span>
      ) : keyStorage === 'memory' && apiKey ? (
        <span
          data-testid="ai-key-memory-note"
          role="status"
          className="text-[var(--orange)]"
          style={{ fontSize: 11 }}
        >
          {t('aiChat.keyMemoryOnly')}
        </span>
      ) : (
        <span className="text-[var(--hint)]" style={{ fontSize: 11 }}>
          {t('aiChat.keyStoredHint')}
        </span>
      )}
    </label>
  )
}
