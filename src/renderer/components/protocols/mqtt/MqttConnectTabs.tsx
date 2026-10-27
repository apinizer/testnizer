import { useMqttStore } from '../../../stores/mqtt.store'
import { useTranslation } from '../../../lib/i18n'
import { isLiteralCredential } from '../../../lib/credential-withhold'
import VariableAutocompleteInput from '../../shared/VariableAutocompleteInput'
import CredentialRestartHint from '../../shared/CredentialRestartHint'
import { Checkbox, Field, INPUT_CLS, IntInput, OptionalIntInput } from '../../mock-mcp/ui'
import RealtimeSettingsForm from '../realtime/RealtimeSettingsForm'
import { UserPropertiesTable } from './mqtt-ui'

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
        <VariableAutocompleteInput
          type="password"
          value={password}
          onChange={setPassword}
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
