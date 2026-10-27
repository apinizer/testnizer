import { useMqttStore } from '../../../stores/mqtt.store'
import { useTranslation } from '../../../lib/i18n'
import { isLiteralCredential } from '../../../lib/credential-withhold'
import { MQTT_CONTENT_TYPES } from '../../../../shared/mqtt'
import VariableAutocompleteInput from '../../shared/VariableAutocompleteInput'
import CredentialRestartHint from '../../shared/CredentialRestartHint'
import { Checkbox, Field, INPUT_CLS, IntInput, OptionalIntInput } from '../../mock-mcp/ui'
import ContentTypeSelect from '../realtime/ContentTypeSelect'
import RealtimeSettingsForm from '../realtime/RealtimeSettingsForm'
import MqttMessagePropsForm from './MqttMessagePropsForm'
import { QosSelect, UserPropertiesTable } from './mqtt-ui'

const U32 = 4_294_967_295

/** MQTT 5-only tab content on a 3.1.1 request: not sent, said once. */
function V5Note() {
  const { t } = useTranslation()
  const v5 = useMqttStore((s) => s.version === 5)
  if (v5) return null
  return (
    <p data-testid="mqtt-v5-note" className="m-0 text-[11px] text-[var(--muted)]">
      {t('mqtt.v5Only')}
    </p>
  )
}

/**
 * Authorization tab (issue #284): Postman's MQTT Basic auth — user name and
 * password sent in CONNECT. The password never reaches the tab snapshot
 * (issue #244): the restart hint says so while it holds a literal value.
 */
export function MqttAuthTab() {
  const { t } = useTranslation()
  const username = useMqttStore((s) => s.username)
  const password = useMqttStore((s) => s.password)
  const setUsername = useMqttStore((s) => s.setUsername)
  const setPassword = useMqttStore((s) => s.setPassword)
  return (
    <div data-testid="mqtt-auth" className="grid max-w-[36rem] gap-3">
      <Field label={t('mqtt.auth.username')}>
        <VariableAutocompleteInput
          value={username}
          onChange={setUsername}
          data-testid="mqtt-username"
          className={INPUT_CLS}
          spellCheck={false}
          autoComplete="off"
        />
      </Field>
      <Field label={t('mqtt.auth.password')}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="mqtt-password"
          aria-describedby="mqtt-password-hint-text"
          autoComplete="off"
          className={INPUT_CLS}
        />
      </Field>
      {isLiteralCredential(password) && (
        <CredentialRestartHint id="mqtt-password-hint-text" testId="mqtt-password-hint" />
      )}
    </div>
  )
}

/** Properties tab: MQTT 5 CONNECT properties. Empty = not sent. */
export function MqttPropertiesTab() {
  const { t } = useTranslation()
  const p = useMqttStore((s) => s.properties)
  const set = useMqttStore((s) => s.setProperties)
  return (
    <div data-testid="mqtt-properties" className="flex flex-col gap-3">
      <V5Note />
      <div className="grid max-w-[48rem] grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        <Field label={t('mqtt.props.sessionExpiry')}>
          <OptionalIntInput
            value={p.sessionExpiryInterval ?? undefined}
            min={0}
            max={U32}
            onChange={(n) => set({ sessionExpiryInterval: n ?? null })}
            testId="mqtt-props-session-expiry"
          />
        </Field>
        <Field label={t('mqtt.props.receiveMaximum')}>
          <OptionalIntInput
            value={p.receiveMaximum ?? undefined}
            min={1}
            max={65_535}
            onChange={(n) => set({ receiveMaximum: n ?? null })}
            testId="mqtt-props-receive-maximum"
          />
        </Field>
        <Field label={t('mqtt.props.maximumPacketSize')}>
          <OptionalIntInput
            value={p.maximumPacketSize ?? undefined}
            min={1}
            max={U32}
            onChange={(n) => set({ maximumPacketSize: n ?? null })}
            testId="mqtt-props-max-packet"
          />
        </Field>
      </div>
      <Checkbox
        checked={p.requestResponseInformation}
        onChange={(requestResponseInformation) => set({ requestResponseInformation })}
        label={t('mqtt.props.requestResponseInfo')}
        testId="mqtt-props-request-response"
      />
      <div>
        <span className="mb-1 block text-[11px] font-medium text-[var(--muted)]">
          {t('mqtt.props.userProperties')}
        </span>
        <UserPropertiesTable
          rows={p.userProperties}
          onChange={(userProperties) => set({ userProperties })}
          testId="mqtt-props-user-properties"
        />
      </div>
    </div>
  )
}

/** Last Will tab: sent only when the topic is set; MQTT 5 will properties under it. */
export function MqttWillTab() {
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

/**
 * Settings tab: Postman's MQTT settings — certificate verification,
 * connection timeout, keep-alive, clean session, auto reconnect — on the
 * shared realtime settings form (locked while connected).
 */
export function MqttSettingsTab() {
  const { t } = useTranslation()
  const s = useMqttStore((st) => st.settings)
  const set = useMqttStore((st) => st.setSettings)
  const connected = useMqttStore(
    (st) => st.connectionState !== 'disconnected' && st.connectionState !== 'error',
  )
  return (
    <RealtimeSettingsForm
      settings={{ strictSSL: s.strictSSL }}
      onChange={(p) => p.strictSSL !== undefined && set({ strictSSL: p.strictSSL })}
      connected={connected}
      testIdPrefix="mqtt"
      hint={t('mqtt.settings.hint')}
      checks={
        <>
          <Checkbox
            checked={s.cleanSession}
            onChange={(cleanSession) => set({ cleanSession })}
            label={t('mqtt.settings.cleanSession')}
            testId="mqtt-settings-clean-session"
          />
          <Checkbox
            checked={s.autoReconnect}
            onChange={(autoReconnect) => set({ autoReconnect })}
            label={t('mqtt.settings.autoReconnect')}
            testId="mqtt-settings-auto-reconnect"
          />
        </>
      }
    >
      <Field label={t('mqtt.settings.connectionTimeout')}>
        <IntInput
          value={s.connectionTimeout}
          min={1}
          max={600_000}
          onChange={(connectionTimeout) => set({ connectionTimeout })}
          testId="mqtt-settings-connection-timeout"
        />
      </Field>
      <Field label={t('mqtt.settings.keepAlive')}>
        <IntInput
          value={s.keepAlive}
          min={0}
          max={65_535}
          onChange={(keepAlive) => set({ keepAlive })}
          testId="mqtt-settings-keep-alive"
        />
      </Field>
    </RealtimeSettingsForm>
  )
}
