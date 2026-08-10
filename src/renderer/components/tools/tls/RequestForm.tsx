/**
 * TLS Inspector — connection form (left pane). Pure move out of
 * `TlsInspectorTool.tsx`; the only additions are the min/max-version guard's
 * companions, which live in `lib/tools/tls-inspect`.
 */
import { useId } from 'react'
import { useTranslation } from '../../../lib/i18n'
import {
  CIPHER_PRESETS,
  TLS_VERSIONS,
  type TlsInspectFormState,
} from '../../../lib/tools/tls-inspect'
import { FileRow, Labeled, SelectInput, TextInput, AMBER, AMBER_BG } from './atoms'

export default function RequestForm({
  form,
  patch,
  legacy,
  onPickFile,
}: {
  form: TlsInspectFormState
  patch: (p: Partial<TlsInspectFormState>) => void
  legacy: boolean
  onPickFile: (field: 'certPath' | 'keyPath' | 'pfxPath') => void
}) {
  const { t } = useTranslation()
  const ids = {
    host: useId(),
    port: useId(),
    sni: useId(),
    min: useId(),
    max: useId(),
    cipher: useId(),
    ca: useId(),
  }
  const cc = form.clientCert

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Labeled id={ids.host} label={t('tools.tlsInspect.host')}>
          <TextInput
            id={ids.host}
            value={form.host}
            placeholder="example.com"
            onChange={(v) => patch({ host: v })}
          />
        </Labeled>
        <Labeled id={ids.port} label={t('tools.tlsInspect.port')}>
          <TextInput
            id={ids.port}
            value={form.port}
            placeholder="443"
            width="w-20"
            onChange={(v) => patch({ port: v })}
          />
        </Labeled>
      </div>

      <Labeled id={ids.sni} label={t('tools.tlsInspect.sni')}>
        <TextInput
          id={ids.sni}
          value={form.servername}
          placeholder={t('tools.tlsInspect.sniHint')}
          onChange={(v) => patch({ servername: v })}
        />
      </Labeled>

      <div className="grid grid-cols-2 gap-2">
        <Labeled id={ids.min} label={t('tools.tlsInspect.versionMin')}>
          <SelectInput
            id={ids.min}
            value={form.minVersion}
            onChange={(v) => patch({ minVersion: v })}
            options={[
              ['', t('tools.tlsInspect.auto')],
              ...TLS_VERSIONS.map((v) => [v, v] as [string, string]),
            ]}
          />
        </Labeled>
        <Labeled id={ids.max} label={t('tools.tlsInspect.versionMax')}>
          <SelectInput
            id={ids.max}
            value={form.maxVersion}
            onChange={(v) => patch({ maxVersion: v })}
            options={[
              ['', t('tools.tlsInspect.auto')],
              ...TLS_VERSIONS.map((v) => [v, v] as [string, string]),
            ]}
          />
        </Labeled>
      </div>

      {legacy && (
        <div
          className="rounded px-2.5 py-1.5 text-[11px]"
          style={{ background: AMBER_BG, color: AMBER }}
        >
          {t('tools.tlsInspect.legacyWarning')}
        </div>
      )}

      <Labeled id={ids.cipher} label={t('tools.tlsInspect.cipherPreset')}>
        <SelectInput
          id={ids.cipher}
          value={form.cipherPreset}
          onChange={(v) => patch({ cipherPreset: v })}
          options={[
            ['', t('tools.tlsInspect.auto')],
            ...CIPHER_PRESETS.map(
              (c) => [c, t(`tools.tlsInspect.cipher.${c}`)] as [string, string],
            ),
          ]}
        />
      </Labeled>

      <Labeled id={ids.ca} label={t('tools.tlsInspect.caCerts')}>
        <textarea
          id={ids.ca}
          value={form.caCerts}
          onChange={(e) => patch({ caCerts: e.target.value })}
          placeholder={'-----BEGIN CERTIFICATE-----\n…'}
          className="h-20 w-full resize-y rounded border p-2 font-mono text-[11px]"
          style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)' }}
        />
        <p className="mt-1 text-[10px]" style={{ color: 'var(--muted)' }}>
          {t('tools.tlsInspect.caHint')}
        </p>
      </Labeled>

      {/* mTLS client cert — ADDITIVE, default OFF */}
      <div className="rounded border" style={{ borderColor: 'var(--border)' }}>
        <label
          className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium"
          style={{ color: 'var(--text)' }}
        >
          <input
            type="checkbox"
            checked={cc.enabled}
            onChange={(e) => patch({ clientCert: { ...cc, enabled: e.target.checked } })}
          />
          {t('tools.tlsInspect.clientCert')}
        </label>

        {cc.enabled && (
          <div
            className="space-y-3 border-t px-3 py-3"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <div className="flex gap-1">
              {(['inline', 'file'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => patch({ clientCert: { ...cc, mode: m } })}
                  className="rounded px-2 py-0.5 text-[11px]"
                  style={{
                    background: cc.mode === m ? 'var(--accentLight)' : 'var(--white)',
                    border: '1px solid',
                    borderColor: cc.mode === m ? 'var(--accentText)' : 'var(--border)',
                    color: 'var(--text)',
                  }}
                >
                  {t(m === 'inline' ? 'tools.tlsInspect.inlinePem' : 'tools.tlsInspect.fromFile')}
                </button>
              ))}
              {/*
                A real disabled BUTTON, not a styled span: only the former is
                announced as unavailable, and only the former is reachable by
                keyboard to read the explanation in its title.
              */}
              <button
                type="button"
                disabled
                className="ml-auto inline-flex items-center rounded px-2 py-0.5 text-[10px] disabled:cursor-not-allowed"
                style={{ background: 'var(--white)', color: 'var(--muted)' }}
                title={t('tools.tlsInspect.fromKeystoreHint')}
              >
                {t('tools.tlsInspect.fromKeystore')}
              </button>
            </div>

            {cc.mode === 'inline' ? (
              <>
                <textarea
                  value={cc.certPem}
                  onChange={(e) => patch({ clientCert: { ...cc, certPem: e.target.value } })}
                  placeholder={t('tools.tlsInspect.certPemPlaceholder')}
                  className="h-16 w-full resize-y rounded border p-2 font-mono text-[11px]"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--white)',
                    color: 'var(--text)',
                  }}
                />
                <textarea
                  value={cc.keyPem}
                  onChange={(e) => patch({ clientCert: { ...cc, keyPem: e.target.value } })}
                  placeholder={t('tools.tlsInspect.keyPemPlaceholder')}
                  className="h-16 w-full resize-y rounded border p-2 font-mono text-[11px]"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--white)',
                    color: 'var(--text)',
                  }}
                />
              </>
            ) : (
              <div className="space-y-2">
                <FileRow
                  label={t('tools.tlsInspect.certFile')}
                  value={cc.certPath}
                  onPick={() => onPickFile('certPath')}
                />
                <FileRow
                  label={t('tools.tlsInspect.keyFile')}
                  value={cc.keyPath}
                  onPick={() => onPickFile('keyPath')}
                />
                <FileRow
                  label={t('tools.tlsInspect.pfxFile')}
                  value={cc.pfxPath}
                  onPick={() => onPickFile('pfxPath')}
                />
              </div>
            )}

            <input
              type="password"
              value={cc.passphrase}
              onChange={(e) => patch({ clientCert: { ...cc, passphrase: e.target.value } })}
              placeholder={t('tools.tlsInspect.passphrase')}
              className="w-full rounded border p-1.5 text-xs"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--white)',
                color: 'var(--text)',
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── result pane (right) ──────────────────────────────────────────────────────
