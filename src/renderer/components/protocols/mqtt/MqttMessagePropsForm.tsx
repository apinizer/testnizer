import type { MqttMessageProperties, MqttWillProperties } from '../../../../shared/mqtt'
import { useTranslation } from '../../../lib/i18n'
import VariableAutocompleteInput from '../../shared/VariableAutocompleteInput'
import { Checkbox, Field, INPUT_CLS, OptionalIntInput } from '../../mock-mcp/ui'
import { UserPropertiesTable } from './mqtt-ui'

const U32 = 4_294_967_295

type Props = Partial<MqttMessageProperties & MqttWillProperties>

/**
 * MQTT 5 message properties (issue #284) — Postman's per-message options:
 * content type (MIME), response topic, correlation data, message expiry,
 * payload format indicator, user properties, plus Topic Alias for a publish
 * and the will delay for the Last Will. Shared by the composer and the Last
 * Will tab; `kind` picks the one field that differs. Empty = not sent.
 */
export default function MqttMessagePropsForm({
  value,
  onChange,
  kind,
  testIdPrefix,
}: {
  value: MqttMessageProperties | MqttWillProperties
  onChange: (patch: Props) => void
  kind: 'message' | 'will'
  testIdPrefix: string
}) {
  const { t } = useTranslation()
  const id = (f: string): string => `${testIdPrefix}-${f}`
  const v = value as Props
  const text = (key: 'contentType' | 'responseTopic' | 'correlationData', label: string) => (
    <Field label={label}>
      <VariableAutocompleteInput
        value={v[key] ?? ''}
        onChange={(next) => onChange({ [key]: next })}
        data-testid={id(key)}
        className={`${INPUT_CLS} font-mono`}
        spellCheck={false}
      />
    </Field>
  )
  return (
    <div data-testid={id('form')} className="flex min-w-0 flex-col gap-3">
      <div className="grid max-w-[48rem] grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        {text('contentType', t('mqtt.props.contentType'))}
        {text('responseTopic', t('mqtt.props.responseTopic'))}
        {text('correlationData', t('mqtt.props.correlationData'))}
        <Field label={t('mqtt.props.messageExpiry')}>
          <OptionalIntInput
            value={v.messageExpiryInterval ?? undefined}
            min={0}
            max={U32}
            onChange={(n) => onChange({ messageExpiryInterval: n ?? null })}
            testId={id('message-expiry')}
          />
        </Field>
        {kind === 'message' ? (
          <Field label={t('mqtt.props.topicAlias')}>
            <OptionalIntInput
              value={v.topicAlias ?? undefined}
              min={1}
              max={65_535}
              onChange={(n) => onChange({ topicAlias: n ?? null })}
              testId={id('topic-alias')}
            />
          </Field>
        ) : (
          <Field label={t('mqtt.props.willDelay')}>
            <OptionalIntInput
              value={v.willDelayInterval ?? undefined}
              min={0}
              max={U32}
              onChange={(n) => onChange({ willDelayInterval: n ?? null })}
              testId={id('will-delay')}
            />
          </Field>
        )}
      </div>
      <Checkbox
        checked={v.payloadFormatIndicator === true}
        onChange={(payloadFormatIndicator) => onChange({ payloadFormatIndicator })}
        label={t('mqtt.props.payloadFormat')}
        testId={id('payload-format')}
      />
      <div>
        <span className="mb-1 block text-[11px] font-medium text-[var(--muted)]">
          {t('mqtt.props.userProperties')}
        </span>
        <UserPropertiesTable
          rows={v.userProperties ?? []}
          onChange={(userProperties) => onChange({ userProperties })}
          testId={id('user-properties')}
        />
      </div>
    </div>
  )
}
