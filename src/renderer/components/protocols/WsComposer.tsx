import { useState } from 'react'
import { Save, Send, Wand2 } from 'lucide-react'
import { useWebSocketStore } from '../../stores/websocket.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import { useTranslation } from '../../lib/i18n'
import { WS_CONTENT_TYPES, isBinaryContentType, type RtContentType } from '../../../shared/realtime'
import { beautify, canBeautify } from '../../lib/realtime-format'
import { GhostButton, PrimaryButton } from '../mock-mcp/ui'
import ContentTypeSelect from './realtime/ContentTypeSelect'
import SavedMessagesPane from './realtime/SavedMessagesPane'

const MONACO_LANGUAGE: Record<RtContentType, string> = {
  text: 'plaintext',
  json: 'json',
  xml: 'xml',
  html: 'html',
  base64: 'plaintext',
  hex: 'plaintext',
}

/**
 * WebSocket Message tab (issue #282), Postman's composer: format (Text, JSON,
 * XML, HTML, Binary as Base64 / Hex — sent as a real binary frame), Beautify
 * for JSON / XML / HTML, Send, and Save into the "Saved messages" pane on the
 * right. The message stays in the editor after Send for a resend.
 */
export default function WsComposer() {
  const { t, locale } = useTranslation()
  const content = useWebSocketStore((s) => s.composerContent)
  const mode = useWebSocketStore((s) => s.composerMode)
  const connected = useWebSocketStore((s) => s.connectionState === 'connected')
  const saved = useWebSocketStore((s) => s.savedMessages)
  const activeSavedId = useWebSocketStore((s) => s.activeSavedMessageId)
  const setContent = useWebSocketStore((s) => s.setComposerContent)
  const setMode = useWebSocketStore((s) => s.setComposerMode)
  const send = useWebSocketStore((s) => s.sendMessage)
  const saveCurrent = useWebSocketStore((s) => s.saveCurrentMessage)
  const addSaved = useWebSocketStore((s) => s.addSavedMessage)
  const loadSaved = useWebSocketStore((s) => s.loadSavedMessage)
  const renameSaved = useWebSocketStore((s) => s.renameSavedMessage)
  const deleteSaved = useWebSocketStore((s) => s.deleteSavedMessage)
  const [beautifyError, setBeautifyError] = useState<string | null>(null)
  const nextName = t('rt.saved.defaultName').replace('{n}', String(saved.length + 1))

  const runBeautify = (): void => {
    const res = beautify(content, mode)
    if (res.ok) {
      setBeautifyError(null)
      setContent(res.output)
    } else {
      setBeautifyError(res.error)
    }
  }

  return (
    <div className="flex min-h-0 gap-3" lang={locale}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ContentTypeSelect
            value={mode}
            options={WS_CONTENT_TYPES}
            onChange={(m) => {
              setBeautifyError(null)
              setMode(m)
            }}
            testId="ws-format"
          />
          {canBeautify(mode) && (
            <GhostButton onClick={runBeautify} data-testid="ws-beautify" className="h-8">
              <Wand2 size={13} aria-hidden />
              {t('ws.beautify')}
            </GhostButton>
          )}
          <span className="ml-auto flex items-center gap-2">
            <GhostButton
              onClick={() => saveCurrent(nextName)}
              data-testid="ws-save-message"
              title={t('rt.saved.saveHint')}
              className="h-8"
            >
              <Save size={13} aria-hidden />
              {t('common.save')}
            </GhostButton>
            <PrimaryButton
              onClick={() => void send()}
              disabled={!connected || !content.trim()}
              data-testid="ws-send"
              className="h-8"
            >
              <Send size={13} aria-hidden />
              {t('ws.sendMessage')}
            </PrimaryButton>
          </span>
        </div>
        {isBinaryContentType(mode) && (
          <p data-testid="ws-binary-hint" className="m-0 text-[11px] text-[var(--muted)]">
            {mode === 'hex' ? t('ws.binaryHexHint') : t('ws.binaryBase64Hint')}
          </p>
        )}
        {beautifyError && (
          <p
            data-testid="ws-beautify-error"
            role="alert"
            className="m-0 text-[12px] text-[var(--red)]"
          >
            {t('ws.beautifyFailed').replace('{error}', beautifyError)}
          </p>
        )}
        <div data-testid="ws-composer" className="min-h-0">
          <MonacoWrapper
            value={content}
            onChange={setContent}
            language={MONACO_LANGUAGE[mode]}
            height={120}
          />
        </div>
      </div>
      <div className="w-56 shrink-0 border-l border-[var(--border)] pl-3">
        <SavedMessagesPane
          items={saved.map((m) => ({
            id: m.id,
            name: m.name,
            subtitle: `${m.contentType} · ${m.content.replace(/\s+/g, ' ').slice(0, 40)}`,
          }))}
          activeId={activeSavedId}
          onLoad={loadSaved}
          onRename={renameSaved}
          onDelete={deleteSaved}
          onAdd={() => addSaved(nextName)}
          testIdPrefix="ws"
        />
      </div>
    </div>
  )
}
