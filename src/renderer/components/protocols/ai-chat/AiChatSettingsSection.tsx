import { useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import {
  useAiChatStore,
  PROVIDER_MODELS,
  AI_PROVIDERS,
  resolveDefaultUrl,
} from '../../../stores/ai-chat.store'
import { useTranslation } from '../../../lib/i18n'
import KeyValueTable from '../../shared/KeyValueTable'
import { STANDARD_HTTP_HEADERS } from '../../../lib/http-headers'
import ProviderSelect, { ProviderAvatar } from './AiProviderSelect'
import AiChatApiKeyField from './AiChatApiKeyField'
import AiChatParameters from './AiChatParameters'
import AiChatHeadersSessionNote from './AiChatHeadersSessionNote'

const LABEL = 'text-[var(--muted)]'
const INPUT =
  'rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]'

/** The collapsible Settings section: provider, model, URL, key, system prompt, parameters, headers. */
export default function AiChatSettingsSection(): ReactElement {
  const { t } = useTranslation()
  const provider = useAiChatStore((s) => s.provider)
  const customUrl = useAiChatStore((s) => s.customUrl)
  const model = useAiChatStore((s) => s.model)
  const systemPrompt = useAiChatStore((s) => s.systemPrompt)
  const customHeaders = useAiChatStore((s) => s.customHeaders)
  const setProvider = useAiChatStore((s) => s.setProvider)
  const setCustomUrl = useAiChatStore((s) => s.setCustomUrl)
  const setModel = useAiChatStore((s) => s.setModel)
  const setSystemPrompt = useAiChatStore((s) => s.setSystemPrompt)
  const addHeader = useAiChatStore((s) => s.addHeader)
  const updateHeader = useAiChatStore((s) => s.updateHeader)
  const removeHeader = useAiChatStore((s) => s.removeHeader)
  const setHeaders = useAiChatStore((s) => s.setHeaders)

  const [expanded, setExpanded] = useState(true)
  const [headersExpanded, setHeadersExpanded] = useState(false)
  const enabledHeaderCount = (customHeaders ?? []).filter((h) => h.enabled && h.key.trim()).length
  const models = PROVIDER_MODELS[provider]
  const providerInfo = AI_PROVIDERS.find((p) => p.id === provider) ?? AI_PROVIDERS[0]

  return (
    <div className="shrink-0 border-b border-[var(--border)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
        style={{ background: 'transparent', border: 'none' }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{t('aiChat.settings')}</span>
        <span
          className="ml-1 flex items-center gap-1.5 text-[var(--muted)]"
          style={{ fontSize: 12 }}
        >
          <ProviderAvatar info={providerInfo} size={14} />
          {providerInfo.label} · {model || '—'}
        </span>
      </button>
      {expanded && (
        <div className="grid gap-3 p-3.5 pt-1" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label className="flex flex-col gap-1">
            <span className={LABEL} style={{ fontSize: 12 }}>
              {t('aiChat.provider')}
            </span>
            <ProviderSelect value={provider} onChange={setProvider} />
          </label>

          <label className="flex flex-col gap-1">
            <span className={LABEL} style={{ fontSize: 12 }}>
              {t('aiChat.model')}
            </span>
            <input
              list={`ai-models-${provider}`}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model-id"
              className={`${INPUT} font-mono`}
              style={{ fontSize: 13 }}
            />
            <datalist id={`ai-models-${provider}`}>
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </datalist>
          </label>

          {/* Endpoint URL — always editable, pre-filled with the provider's default. */}
          <label className="flex flex-col gap-1" style={{ gridColumn: '1 / -1' }}>
            <span className={LABEL} style={{ fontSize: 12 }}>
              {t('aiChat.endpointUrl')}
            </span>
            <input
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder={t('aiChat.endpointUrlPlaceholder')}
              spellCheck={false}
              className={`${INPUT} font-mono`}
              style={{ fontSize: 13 }}
            />
            {provider !== 'custom' && customUrl !== resolveDefaultUrl(provider) && (
              <button
                type="button"
                onClick={() => setCustomUrl(resolveDefaultUrl(provider))}
                className="cursor-pointer self-start border-none bg-transparent p-0 text-[var(--accent-text)]"
                style={{ fontSize: 11 }}
              >
                {t('aiChat.resetToDefault')}
              </button>
            )}
          </label>

          {/* API Key — stored encrypted per provider, never with the request (issue #188) */}
          <AiChatApiKeyField />

          <label className="flex flex-col gap-1" style={{ gridColumn: '1 / -1' }}>
            <span className={LABEL} style={{ fontSize: 12 }}>
              {t('aiChat.systemPrompt')}
            </span>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t('aiChat.systemPromptPlaceholder')}
              rows={2}
              className={`${INPUT} resize-y`}
              style={{ fontSize: 13 }}
            />
          </label>

          {/* Temperature + max tokens (issue #189) */}
          <AiChatParameters />

          {/* Custom headers (issue #120) */}
          <div
            className="rounded-md border border-[var(--border)]"
            style={{ gridColumn: '1 / -1' }}
            data-testid="ai-chat-headers"
          >
            <button
              type="button"
              onClick={() => setHeadersExpanded((v) => !v)}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[var(--text)] hover:bg-[var(--hover)]"
              style={{ background: 'transparent', border: 'none', fontSize: 12 }}
              aria-expanded={headersExpanded}
            >
              {headersExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Settings2 size={14} className="text-[var(--muted)]" />
              <span>{t('aiChat.headers')}</span>
              {enabledHeaderCount > 0 && (
                <span
                  className="ml-1 rounded-full px-[5px]"
                  style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
                >
                  {enabledHeaderCount}
                </span>
              )}
            </button>
            {headersExpanded && (
              <div className="border-t border-[var(--border)] p-3">
                <p className="mb-2 text-[var(--muted)]" style={{ fontSize: 11 }}>
                  {t('aiChat.headersHint')}
                </p>
                <KeyValueTable
                  rows={customHeaders ?? []}
                  onUpdate={updateHeader}
                  onRemove={removeHeader}
                  onAdd={addHeader}
                  onReplaceAll={setHeaders}
                  addLabel={t('aiChat.addHeader')}
                  keyAutocompleteEntries={STANDARD_HTTP_HEADERS}
                />
              </div>
            )}
            {/* Shown collapsed too — a literal credential is not saved (issue #187). */}
            <AiChatHeadersSessionNote />
          </div>
        </div>
      )}
    </div>
  )
}
