import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import type { ExportCertificateInput } from '../../../stores/keystore.store'
import type { KeystoreWriteResult } from '../../../types'
import { LabeledSelect, Modal, ModalActions } from './dialog-ui'

/**
 * Export Certificate dialog (design §4.14 / §6.12 / §9.5). Picks the encoding —
 * PEM/DER export the leaf only, PKCS#7/PKI Path export the whole chain — then
 * hands off to the store which triggers a native save dialog in MAIN and writes
 * the PUBLIC certificate bytes disk-to-disk (never a private key). The renderer
 * only ever learns the resulting `{path}` (surfaced as a toast) or `{canceled}`.
 */
export default function ExportCertificateDialog({
  alias,
  error,
  onExport,
  onClose,
}: {
  alias: string
  error: string | null
  onExport: (opts: ExportCertificateInput) => Promise<KeystoreWriteResult | null>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [format, setFormat] = useState('PEM')
  const [busy, setBusy] = useState(false)

  async function submit(): Promise<void> {
    if (busy) return
    setBusy(true)
    const result = await onExport({ alias, format })
    setBusy(false)
    // `null` = engine/validation error (kept open to show it). A written path OR
    // a cancelled dialog both close cleanly (cancel is a no-op).
    if (result !== null) onClose()
  }

  return (
    <Modal title={`${t('tools.keystore.export.title')} · ${alias}`} onClose={onClose}>
      <LabeledSelect
        label={t('tools.keystore.export.format')}
        value={format}
        onChange={setFormat}
        options={[
          ['PEM', t('tools.keystore.export.format.pem')],
          ['DER', t('tools.keystore.export.format.der')],
          ['PKCS7', t('tools.keystore.export.format.pkcs7')],
          ['PKIPATH', t('tools.keystore.export.format.pkipath')],
        ]}
      />
      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {t('tools.keystore.export.formatHint')}
      </p>
      {error && (
        <p className="text-[11px]" style={{ color: '#cc2200' }}>
          {error}
        </p>
      )}
      <ModalActions
        onCancel={onClose}
        confirmLabel={t('tools.keystore.export.submit')}
        onConfirm={() => void submit()}
        confirmDisabled={busy}
      />
    </Modal>
  )
}
