import { useState } from 'react'
import { ChevronDown, ChevronRight, Save, Send, Wand2 } from 'lucide-react'
import { useMqttStore } from '../../../stores/mqtt.store'
import MonacoWrapper from '../../shared/MonacoWrapper'
import VariableAutocompleteInput from '../../shared/VariableAutocompleteInput'
import { useTranslation } from '../../../lib/i18n'
import { MQTT_CONTENT_TYPES } from '../../../../shared/mqtt'
import { isBinaryContentType } from '../../../../shared/realtime'
import { RT_MONACO_LANGUAGE, beautify, canBeautify } from '../../../lib/realtime-format'
import { Checkbox, GhostButton, INPUT_CLS, PrimaryButton } from '../../mock-mcp/ui'
import ContentTypeSelect from '../realtime/ContentTypeSelect'
import SavedMessagesPane from '../realtime/SavedMessagesPane'
import MqttMessagePropsForm from './MqttMessagePropsForm'
import { QosSelect } from './mqtt-ui'
import CredentialRestartHint from '../../shared/CredentialRestartHint'
import { scrubMessageCredentials } from '../../../lib/credential-text'

/**
 * MQTT Message tab (issue #284), Postman's publish composer: topic, QoS,
 * Retain, payload format (Text, JSON, XML, HTML, Binary as Base64 / Hex —
 * published as raw bytes), Beautify, the MQTT 5 message properties behind a
 * toggle, Save into "Saved messages" on the right, Publish. The WebSocket
 * composer's anatomy; the message stays in the editor for a resend.
 */
export default function MqttComposer() {
  const { t } = useTranslation()
  const c = useMqttStore((s) => s.composer)
  const v5 = useMqttStore((s) => s.version === 5)
  const connected = useMqttStore((s) => s.connectionState === 'connected')
  const saved = useMqttStore((s) => s.savedMessages)
  const activeSavedId = useMqttStore((s) => s.activeSavedMessageId)
  const setComposer = useMqttStore((s) => s.setComposer)
  const setProps = useMqttStore((s) => s.setComposerProperties)
  const publish = useMqttStore((s) => s.publish)
  const saveCurrent = useMqttStore((s) => s.saveCurrentMessage)
  const addSaved = useMqttStore((s) => s.addSavedMessage)
  const loadSaved = useMqttStore((s) => s.loadSavedMessage)
  const renameSaved = useMqttStore((s) => s.renameSavedMessage)
  const deleteSaved = useMqttStore((s) => s.deleteSavedMessage)
  const [beautifyError, setBeautifyError] = useState<string | null>(null)
  const [showProps, setShowProps] = useState(false)
  const nextName = t('rt.saved.defaultName').replace('{n}', String(saved.length + 1))

  const runBeautify = (): void => {
    const res = beautify(c.content, c.contentType)
    if (res.ok) {
      setBeautifyError(null)
      setComposer({ content: res.output })
    } else setBeautifyError(res.error)
  }

  return (
    <div className="flex min-h-0 gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[12rem] flex-1">
            <VariableAutocompleteInput
              value={c.topic}
              onChange={(topic) => setComposer({ topic })}
              placeholder={t('mqtt.topicPlaceholder')}
              data-testid="mqtt-publish-topic"
              className={`${INPUT_CLS} h-8 font-mono`}
              spellCheck={false}
            />
          </div>
          <QosSelect
            value={c.qos}
            onChange={(qos) => setComposer({ qos })}
            testId="mqtt-publish-qos"
            className="w-auto"
          />
          <Checkbox
            checked={c.retain}
            onChange={(retain) => setComposer({ retain })}
            label={t('mqtt.retain')}
            testId="mqtt-publish-retain"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ContentTypeSelect
            value={c.contentType}
            options={MQTT_CONTENT_TYPES}
            onChange={(contentType) => {
              setBeautifyError(null)
              setComposer({ contentType })
            }}
            testId="mqtt-format"
          />
          {canBeautify(c.contentType) && (
            <GhostButton onClick={runBeautify} data-testid="mqtt-beautify" className="h-8">
              <Wand2 size={13} aria-hidden />
              {t('ws.beautify')}
            </GhostButton>
          )}
          {v5 && (
            <GhostButton
              onClick={() => setShowProps(!showProps)}
              aria-expanded={showProps}
              data-testid="mqtt-publish-props-toggle"
              className="h-8"
            >
              {showProps ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {t('mqtt.messageProperties')}
            </GhostButton>
          )}
          <span className="ml-auto flex items-center gap-2">
            <GhostButton
              onClick={() => saveCurrent(nextName)}
              data-testid="mqtt-save-message"
              title={t('rt.saved.saveHint')}
              className="h-8"
            >
              <Save size={13} aria-hidden />
              {t('common.save')}
            </GhostButton>
            <PrimaryButton
              onClick={() => void publish()}
              disabled={!connected || !c.topic.trim()}
              data-testid="mqtt-publish"
              className="h-8"
            >
              <Send size={13} aria-hidden />
              {t('mqtt.publish')}
            </PrimaryButton>
          </span>
        </div>
        {isBinaryContentType(c.contentType) && (
          <p data-testid="mqtt-binary-hint" className="m-0 text-[11px] text-[var(--muted)]">
            {c.contentType === 'hex' ? t('mqtt.binaryHexHint') : t('mqtt.binaryBase64Hint')}
          </p>
        )}
        {beautifyError && (
          <p
            role="alert"
            data-testid="mqtt-beautify-error"
            className="m-0 text-[12px] text-[var(--red)]"
          >
            {t('ws.beautifyFailed').replace('{error}', beautifyError)}
          </p>
        )}
        {v5 && showProps && (
          <div className="rounded-md border border-[var(--border)] p-2.5">
            <MqttMessagePropsForm
              value={c.properties}
              onChange={setProps}
              kind="message"
              testIdPrefix="mqtt-msg"
            />
          </div>
        )}
        <div data-testid="mqtt-composer" className="min-h-0">
          <MonacoWrapper
            value={c.content}
            onChange={(content) => setComposer({ content })}
            language={RT_MONACO_LANGUAGE[c.contentType]}
            height={120}
          />
        </div>
        {scrubMessageCredentials(c.content) !== c.content && (
          <CredentialRestartHint
            id="mqtt-composer-restart-hint-text"
            testId="mqtt-composer-restart-hint"
          />
        )}
      </div>
      <div className="w-56 shrink-0 border-l border-[var(--border)] pl-3">
        <SavedMessagesPane
          items={saved.map((m) => ({
            id: m.id,
            name: m.name,
            subtitle: `${m.topic || '—'} · ${m.contentType} · QoS ${m.qos}`,
          }))}
          activeId={activeSavedId}
          onLoad={loadSaved}
          onRename={renameSaved}
          onDelete={deleteSaved}
          onAdd={() => addSaved(nextName)}
          testIdPrefix="mqtt"
        />
      </div>
    </div>
  )
}
