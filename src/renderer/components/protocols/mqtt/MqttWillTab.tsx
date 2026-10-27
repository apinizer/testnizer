import { useMqttStore } from '../../../stores/mqtt.store'
import { useTranslation } from '../../../lib/i18n'
import { MQTT_CONTENT_TYPES } from '../../../../shared/mqtt'
import VariableAutocompleteInput from '../../shared/VariableAutocompleteInput'
import { Checkbox, INPUT_CLS } from '../../mock-mcp/ui'
import ContentTypeSelect from '../realtime/ContentTypeSelect'
import MqttMessagePropsForm from './MqttMessagePropsForm'
import { QosSelect } from './mqtt-ui'
import CredentialRestartHint from '../../shared/CredentialRestartHint'
import { scrubMessageCredentials } from '../../../lib/credential-text'

/** Last Will tab: sent only when the topic is set; MQTT 5 will properties under it. */
export default function MqttWillTab() {
  const { t } = useTranslation()
  const w = useMqttStore((s) => s.lastWill)
  const v5 = useMqttStore((s) => s.version === 5)
  const set = useMqttStore((s) => s.setLastWill)
  const setProps = useMqttStore((s) => s.setWillProperties)
  return (
    <div data-testid="mqtt-will" className="flex flex-col gap-3">
      <p className="m-0 text-[11px] text-[var(--muted)]">{t('mqtt.will.hint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[12rem] flex-1">
          <VariableAutocompleteInput
            value={w.topic}
            onChange={(topic) => set({ topic })}
            placeholder={t('mqtt.will.topicPlaceholder')}
            data-testid="mqtt-will-topic"
            className={`${INPUT_CLS} h-8 font-mono`}
            spellCheck={false}
          />
        </div>
        <QosSelect
          value={w.qos}
          onChange={(qos) => set({ qos })}
          testId="mqtt-will-qos"
          className="w-auto"
        />
        <Checkbox
          checked={w.retain}
          onChange={(retain) => set({ retain })}
          label={t('mqtt.retain')}
          testId="mqtt-will-retain"
        />
        <ContentTypeSelect
          value={w.type}
          options={MQTT_CONTENT_TYPES}
          onChange={(type) => set({ type })}
          testId="mqtt-will-format"
        />
      </div>
      <textarea
        value={w.payload}
        onChange={(e) => set({ payload: e.target.value })}
        placeholder={t('mqtt.will.payloadPlaceholder')}
        aria-label={t('mqtt.will.payload')}
        data-testid="mqtt-will-payload"
        rows={3}
        spellCheck={false}
        className="w-full resize-y rounded-md border border-[var(--border2)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      {scrubMessageCredentials(w.payload) !== w.payload && (
        <CredentialRestartHint id="mqtt-will-restart-hint-text" testId="mqtt-will-restart-hint" />
      )}
      {v5 && (
        <MqttMessagePropsForm
          value={w.properties}
          onChange={setProps}
          kind="will"
          testIdPrefix="mqtt-will"
        />
      )}
    </div>
  )
}
