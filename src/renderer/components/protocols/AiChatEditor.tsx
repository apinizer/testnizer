import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, Send, Square, Trash2, Bot, User } from 'lucide-react'
import {
  useAiChatStore,
  PROVIDER_MODELS,
  AI_PROVIDERS,
  type AiProvider,
  type AiProviderInfo,
} from '../../stores/ai-chat.store'
import { useTranslation } from '../../lib/i18n'

function ProviderAvatar({ info, size = 18 }: { info: AiProviderInfo; size?: number }): ReactElement {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md font-bold text-white"
      style={{
        width: size,
        height: size,
        background: info.color,
        fontSize: Math.max(10, Math.floor(size * 0.6)),
      }}
    >
      {info.letter}
    </span>
  )
}

function ProviderSelect({
  value,
  onChange,
}: {
  value: AiProvider
  onChange: (v: AiProvider) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  const current = AI_PROVIDERS.find((p) => p.id === value) ?? AI_PROVIDERS[0]

  useEffect(() => {
    if (!open) return
    const update = (): void => {
      if (!buttonRef.current) return
      const r = buttonRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    update()
    const onMouseDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1.5 text-left text-[var(--text)] transition-colors hover:border-[var(--accent)]"
        style={{ fontSize: 13 }}
      >
        <ProviderAvatar info={current} />
        <span className="flex-1 truncate">{current.label}</span>
        <ChevronDown size={12} style={{ color: 'var(--muted)' }} />
      </button>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9000] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--white)]"
            style={{
              top: pos.top,
              left: pos.left,
              width: Math.max(pos.width, 220),
              maxHeight: 320,
              overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            }}
          >
            {AI_PROVIDERS.map((p) => {
              const isActive = p.id === value
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onChange(p.id)
                    setOpen(false)
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left"
                  style={{
                    background: isActive ? 'var(--accent-light)' : 'transparent',
                    color: isActive ? 'var(--accent-text)' : 'var(--text)',
                    border: 'none',
                    fontSize: 13,
                    fontWeight: isActive ? 500 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      (e.currentTarget as HTMLElement).style.background = 'var(--surface)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      (e.currentTarget as HTMLElement).style.background = 'transparent'
                  }}
                >
                  <ProviderAvatar info={p} />
                  <span className="flex-1 truncate">{p.label}</span>
                  {isActive && <Check size={12} style={{ color: 'var(--accent)' }} />}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}

// ─── Markdown-lite renderer ─────────────────────────────────
// Apidog/Postman do basic markdown rendering for assistant turns. We avoid
// pulling in a markdown lib — just render fenced code blocks specially and
// preserve paragraph breaks. Inline code with backticks is also handled.

interface MdSegment {
  type: 'text' | 'code'
  content: string
  lang?: string
}

function parseMarkdown(text: string): MdSegment[] {
  const segments: MdSegment[] = []
  const fenceRegex = /```(\w+)?\n([\s\S]*?)(?:```|$)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'code', content: match[2], lang: match[1] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
  }
  return segments
}

function MarkdownText({ text }: { text: string }): ReactElement {
  const segments = parseMarkdown(text)
  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 font-mono"
            style={{ fontSize: 12.5 }}
          >
            {seg.lang && (
              <div className="mb-2 uppercase tracking-wider text-[var(--muted)]" style={{ fontSize: 11 }}>
                {seg.lang}
              </div>
            )}
            <code>{seg.content}</code>
          </pre>
        ) : (
          <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {renderInline(seg.content)}
          </div>
        ),
      )}
    </div>
  )
}

function renderInline(text: string): ReactElement[] {
  // Inline code: `...`
  const parts: ReactElement[] = []
  const regex = /`([^`]+)`/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>)
    }
    parts.push(
      <code
        key={key++}
        className="rounded bg-[var(--bg)] px-1 py-0.5 font-mono"
        style={{ fontSize: 12.5 }}
      >
        {match[1]}
      </code>,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>)
  }
  return parts
}

// ─── Editor ─────────────────────────────────────────────────

export default function AiChatEditor(): ReactElement {
  const { t } = useTranslation()
  const provider = useAiChatStore((s) => s.provider)
  const customUrl = useAiChatStore((s) => s.customUrl)
  const apiKey = useAiChatStore((s) => s.apiKey)
  const model = useAiChatStore((s) => s.model)
  const systemPrompt = useAiChatStore((s) => s.systemPrompt)
  const messages = useAiChatStore((s) => s.messages)
  const streaming = useAiChatStore((s) => s.streaming)
  const errorMessage = useAiChatStore((s) => s.errorMessage)
  const pendingResponseId = useAiChatStore((s) => s.pendingResponseId)

  const setProvider = useAiChatStore((s) => s.setProvider)
  const setCustomUrl = useAiChatStore((s) => s.setCustomUrl)
  const setApiKey = useAiChatStore((s) => s.setApiKey)
  const setModel = useAiChatStore((s) => s.setModel)
  const setSystemPrompt = useAiChatStore((s) => s.setSystemPrompt)
  const sendPrompt = useAiChatStore((s) => s.sendPrompt)
  const cancel = useAiChatStore((s) => s.cancel)
  const clearConversation = useAiChatStore((s) => s.clearConversation)

  const [settingsExpanded, setSettingsExpanded] = useState(true)
  const [showApiKey, setShowApiKey] = useState(false)
  const [draft, setDraft] = useState('')
  const conversationRef = useRef<HTMLDivElement>(null)

  const models = PROVIDER_MODELS[provider]
  const providerInfo = AI_PROVIDERS.find((p) => p.id === provider) ?? AI_PROVIDERS[0]

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    const el = conversationRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  function handleSend(): void {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    void sendPrompt(text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Tab bar label */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--white)] px-3.5 py-2">
        <Bot size={16} style={{ color: 'var(--accent-text)' }} />
        <span className="font-medium" style={{ color: 'var(--accent-text)' }}>
          {t('aiChat.title')}
        </span>
        {streaming && (
          <span
            className="rounded-full px-2 py-0.5 font-medium"
            style={{ background: '#e8f9f1', color: '#1a7a4a' }}
          >
            {t('aiChat.streaming')}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={clearConversation}
          disabled={streaming || messages.length === 0}
          title={t('aiChat.clear')}
          className="flex cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 size={13} />
          <span style={{ fontSize: 12 }}>{t('aiChat.clear')}</span>
        </button>
      </div>

      {/* Settings (collapsible) */}
      <div className="shrink-0 border-b border-[var(--border)]">
        <button
          type="button"
          onClick={() => setSettingsExpanded((v) => !v)}
          className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
          style={{ background: 'transparent', border: 'none' }}
        >
          {settingsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{t('aiChat.settings')}</span>
          <span className="ml-1 flex items-center gap-1.5 text-[var(--muted)]" style={{ fontSize: 12 }}>
            <ProviderAvatar info={providerInfo} size={14} />
            {providerInfo.label} · {model || '—'}
          </span>
        </button>
        {settingsExpanded && (
          <div className="grid gap-3 p-3.5 pt-1" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {/* Provider */}
            <label className="flex flex-col gap-1">
              <span className="text-[var(--muted)]" style={{ fontSize: 12 }}>
                {t('aiChat.provider')}
              </span>
              <ProviderSelect value={provider} onChange={setProvider} />
            </label>

            {/* Model */}
            <label className="flex flex-col gap-1">
              <span className="text-[var(--muted)]" style={{ fontSize: 12 }}>
                {t('aiChat.model')}
              </span>
              <input
                list={`ai-models-${provider}`}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model-id"
                className="rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1.5 font-mono text-[var(--text)] outline-none focus:border-[var(--accent)]"
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

            {/* Custom URL (or override) */}
            <label className="flex flex-col gap-1" style={{ gridColumn: '1 / -1' }}>
              <span className="text-[var(--muted)]" style={{ fontSize: 12 }}>
                {provider === 'custom'
                  ? t('aiChat.customUrlRequired')
                  : t('aiChat.customUrlOptional')}
              </span>
              <input
                type="text"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder={
                  provider === 'custom'
                    ? 'https://your-host/v1/chat/completions'
                    : 'https://… (override default URL)'
                }
                className="rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1.5 font-mono text-[var(--text)] outline-none focus:border-[var(--accent)]"
                style={{ fontSize: 13 }}
              />
            </label>

            {/* API Key */}
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
            </label>

            {/* System prompt */}
            <label className="flex flex-col gap-1" style={{ gridColumn: '1 / -1' }}>
              <span className="text-[var(--muted)]" style={{ fontSize: 12 }}>
                {t('aiChat.systemPrompt')}
              </span>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('aiChat.systemPromptPlaceholder')}
                rows={2}
                className="resize-y rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                style={{ fontSize: 13 }}
              />
            </label>
          </div>
        )}
      </div>

      {/* Conversation */}
      <div ref={conversationRef} className="flex-1 overflow-y-auto p-3.5">
        {messages.length === 0 && !errorMessage ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--muted)]">
            <Bot size={36} strokeWidth={1.2} />
            <div style={{ fontSize: 13 }}>{t('aiChat.emptyTitle')}</div>
            <div style={{ fontSize: 12 }}>{t('aiChat.emptyHint')}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => {
              if (m.role === 'user') {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div
                      className="flex max-w-[80%] items-start gap-2 rounded-lg px-3 py-2"
                      style={{
                        background: 'var(--accent-light)',
                        border: '1px solid var(--accent)',
                        color: 'var(--text)',
                      }}
                    >
                      <div className="flex-1" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
                        {m.content}
                      </div>
                      <User size={14} style={{ color: 'var(--accent-text)', marginTop: 2 }} />
                    </div>
                  </div>
                )
              }
              const isStreamingThis = pendingResponseId === m.id
              return (
                <div key={m.id} className="flex justify-start">
                  <div
                    className="flex max-w-[85%] items-start gap-2 rounded-lg px-3 py-2"
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <Bot size={14} style={{ color: 'var(--accent-text)', marginTop: 2 }} />
                    <div className="flex-1" style={{ fontSize: 13 }}>
                      {m.content ? <MarkdownText text={m.content} /> : null}
                      {isStreamingThis && (
                        <span
                          className="ml-0.5 inline-block animate-pulse"
                          style={{
                            width: 8,
                            height: 14,
                            background: 'var(--accent)',
                            verticalAlign: 'middle',
                            borderRadius: 1,
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {errorMessage && (
              <div
                className="rounded-md border px-3 py-2"
                style={{
                  background: '#fff0f0',
                  borderColor: '#f5b3b3',
                  color: '#cc2200',
                  fontSize: 12.5,
                }}
              >
                {errorMessage}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Prompt input */}
      <div className="shrink-0 border-t border-[var(--border)] p-3.5">
        <div
          className="flex items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--white)] p-2 focus-within:border-[var(--accent)]"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('aiChat.placeholder')}
            rows={2}
            className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1 text-[var(--text)] outline-none placeholder:text-[var(--hint)]"
            style={{ fontSize: 13 }}
            disabled={streaming}
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => void cancel()}
              title={t('aiChat.stop')}
              className="flex h-9 cursor-pointer items-center gap-1 rounded-md px-3 font-medium text-white transition-colors"
              style={{ background: '#cc2200', border: 'none', fontSize: 13 }}
            >
              <Square size={13} fill="currentColor" />
              {t('aiChat.stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim() || !apiKey.trim()}
              title={t('aiChat.send')}
              className="flex h-9 cursor-pointer items-center gap-1 rounded-md px-3 font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--accent)', border: 'none', fontSize: 13 }}
            >
              <Send size={13} />
              {t('aiChat.send')}
            </button>
          )}
        </div>
        <div className="mt-1 text-[var(--hint)]" style={{ fontSize: 11 }}>
          {t('aiChat.inputHint')}
        </div>
      </div>
    </div>
  )
}
