import type { ReactNode } from 'react'
import type { RtSettingsBase } from '../../../../shared/realtime'
import { useTranslation } from '../../../lib/i18n'
import { Checkbox, Field, IntInput } from '../../mock-mcp/ui'

/**
 * Settings tab of the WebSocket and Socket.IO editors (issues #282 / #283),
 * Postman's list: server certificate verification, handshake timeout,
 * reconnection attempts and interval, plus `maxPayload` (WebSocket only, MB,
 * 0 = unlimited) and the protocol's own fields in `children` (Socket.IO
 * client version, handshake path, transport). Like Postman, it is read-only
 * while connected (`<fieldset disabled>`): the values apply on the next
 * Connect. Test ids: `${testIdPrefix}-settings-<field>`.
 */
export default function RealtimeSettingsForm({
  settings,
  maxPayload,
  onChange,
  onMaxPayloadChange,
  connected,
  testIdPrefix,
  children,
}: {
  settings: RtSettingsBase
  /** WebSocket only. */
  maxPayload?: number
  onChange: (patch: Partial<RtSettingsBase>) => void
  onMaxPayloadChange?: (mb: number) => void
  connected: boolean
  testIdPrefix: string
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const id = (f: string): string => `${testIdPrefix}-settings-${f}`
  return (
    <fieldset
      disabled={connected}
      data-testid={id('form')}
      className="m-0 flex min-w-0 flex-col gap-3 border-none p-0 disabled:opacity-70"
    >
      {connected && (
        <p data-testid={id('locked')} className="m-0 text-[11px] text-[var(--muted)]">
          {t('rt.settings.locked')}
        </p>
      )}
      <Checkbox
        checked={settings.strictSSL}
        onChange={(strictSSL) => onChange({ strictSSL })}
        label={t('rt.settings.strictSSL')}
        testId={id('strict-ssl')}
      />
      <div className="grid max-w-[36rem] grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        <Field label={t('rt.settings.handshakeTimeout')}>
          <IntInput
            value={settings.handshakeTimeout}
            min={1}
            max={600_000}
            onChange={(handshakeTimeout) => onChange({ handshakeTimeout })}
            testId={id('handshake-timeout')}
          />
        </Field>
        <Field label={t('rt.settings.retryCount')}>
          <IntInput
            value={settings.retryCount}
            min={0}
            max={100}
            onChange={(retryCount) => onChange({ retryCount })}
            testId={id('retry-count')}
          />
        </Field>
        <Field label={t('rt.settings.retryDelay')}>
          <IntInput
            value={settings.retryDelay}
            min={0}
            max={600_000}
            onChange={(retryDelay) => onChange({ retryDelay })}
            testId={id('retry-delay')}
          />
        </Field>
        {maxPayload !== undefined && onMaxPayloadChange && (
          <Field label={t('rt.settings.maxPayload')}>
            <IntInput
              value={maxPayload}
              min={0}
              max={4096}
              onChange={onMaxPayloadChange}
              testId={id('max-payload')}
            />
          </Field>
        )}
        {children}
      </div>
      <p className="m-0 text-[11px] text-[var(--muted)]">{t('rt.settings.hint')}</p>
    </fieldset>
  )
}
