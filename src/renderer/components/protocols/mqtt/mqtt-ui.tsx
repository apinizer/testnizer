import type { KeyValuePair } from '../../../types'
import { MQTT_QOS, type MqttKeyValue, type MqttQos } from '../../../../shared/mqtt'
import { useTranslation } from '../../../lib/i18n'
import { makeId } from '../../../lib/utils'
import KeyValueTable from '../../shared/KeyValueTable'
import CredentialRowsHint from '../../shared/CredentialRowsHint'
import { SELECT_CLS } from '../../mock-mcp/ui'

/**
 * Small pieces the MQTT tabs share (issue #284): the QoS picker (composer,
 * will, topics) and the user-properties table (CONNECT, will, publish) —
 * the HTTP editor's key/value table with the restart hint under
 * credential-named rows (issue #244).
 */
export function QosSelect({
  value,
  onChange,
  testId,
  disabled,
  className = '',
}: {
  value: MqttQos
  onChange: (q: MqttQos) => void
  testId: string
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value) as MqttQos)}
      aria-label={t('mqtt.qos')}
      data-testid={testId}
      className={`${SELECT_CLS} ${className}`}
    >
      {MQTT_QOS.map((q) => (
        <option key={q} value={q}>
          {t(`mqtt.qos${q}`)}
        </option>
      ))}
    </select>
  )
}

export function UserPropertiesTable({
  rows,
  onChange,
  testId,
}: {
  rows: MqttKeyValue[]
  onChange: (rows: MqttKeyValue[]) => void
  testId: string
}) {
  const { t } = useTranslation()
  return (
    <div data-testid={testId}>
      <KeyValueTable
        rows={rows as KeyValuePair[]}
        onUpdate={(id, patch) =>
          onChange(
            rows.map((r) => (r.id === id ? { ...r, ...(patch as Partial<MqttKeyValue>) } : r)),
          )
        }
        onRemove={(id) => onChange(rows.filter((r) => r.id !== id))}
        onAdd={() => onChange([...rows, { id: makeId(), key: '', value: '', enabled: true }])}
        addLabel={t('mqtt.addUserProperty')}
      />
      <CredentialRowsHint rows={rows as KeyValuePair[]} testId={`${testId}-restart-hint`} />
    </div>
  )
}
