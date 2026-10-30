import {
  SIO_CLIENT_VERSIONS,
  SIO_TRANSPORTS,
  type SioClientVersion,
  type SioTransport,
} from '../../../../shared/realtime'
import { useSocketIOStore } from '../../../stores/socketio.store'
import { useTranslation } from '../../../lib/i18n'
import VariableAutocompleteInput from '../../shared/VariableAutocompleteInput'
import { Field, INPUT_CLS, SELECT_CLS } from '../../mock-mcp/ui'
import RealtimeSettingsForm from '../realtime/RealtimeSettingsForm'

const TRANSPORT_KEYS: Record<SioTransport, string> = {
  auto: 'socketio.transport.auto',
  websocket: 'socketio.transport.websocket',
  polling: 'socketio.transport.polling',
}

/**
 * Socket.IO Settings tab (issue #283): the shared realtime settings plus
 * client version, handshake path and transport. v2 connects with the 2.x
 * client; v3 and v4 share the 4.x client (main `protocols/socketio-client.ts`),
 * which the hint says. v2 has no handshake auth, so with v2 the hint also says
 * where the token goes.
 */
export default function SioSettingsTab() {
  const { t } = useTranslation()
  const settings = useSocketIOStore((s) => s.settings)
  const setSettings = useSocketIOStore((s) => s.setSettings)
  const connected = useSocketIOStore((s) => s.connectionState === 'connected')

  return (
    <RealtimeSettingsForm
      settings={settings}
      onChange={setSettings}
      connected={connected}
      testIdPrefix="socketio"
    >
      <Field label={t('socketio.settings.version')}>
        <select
          value={settings.version}
          onChange={(e) => setSettings({ version: e.target.value as SioClientVersion })}
          data-testid="socketio-settings-version"
          className={SELECT_CLS}
        >
          {[...SIO_CLIENT_VERSIONS].reverse().map((v) => (
            <option key={v} value={v}>
              {`v${v}`}
            </option>
          ))}
        </select>
        <span
          data-testid="socketio-settings-version-hint"
          className="text-[11px] text-[var(--muted)]"
        >
          {t(
            settings.version === '2'
              ? 'socketio.settings.versionHintV2'
              : 'socketio.settings.versionHint',
          )}
        </span>
      </Field>
      <Field label={t('socketio.settings.path')}>
        <VariableAutocompleteInput
          value={settings.path}
          onChange={(path) => setSettings({ path })}
          placeholder="/socket.io"
          data-testid="socketio-settings-path"
          className={`${INPUT_CLS} font-mono`}
          spellCheck={false}
        />
      </Field>
      <Field label={t('socketio.settings.transport')}>
        <select
          value={settings.transport}
          onChange={(e) => setSettings({ transport: e.target.value as SioTransport })}
          data-testid="socketio-settings-transport"
          className={SELECT_CLS}
        >
          {SIO_TRANSPORTS.map((tr) => (
            <option key={tr} value={tr}>
              {t(TRANSPORT_KEYS[tr])}
            </option>
          ))}
        </select>
      </Field>
    </RealtimeSettingsForm>
  )
}
