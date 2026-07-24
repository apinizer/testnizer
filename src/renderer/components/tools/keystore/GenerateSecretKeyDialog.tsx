import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import type { GenerateSecretKeyInput } from '../../../stores/keystore.store'
import { LabeledInput, LabeledSelect, Modal, ModalActions } from './dialog-ui'

/**
 * Generate Secret Key dialog (design §9.5). AES only, PKCS12-only — the menu
 * item that opens this is disabled for JKS sessions, and the engine enforces
 * the same constraint defensively. Field set: alias, AES key size.
 *
 * Faz B2 has NO per-entry password field: the secret entry is protected with
 * the store password. Per-entry password protection lands in Faz B4
 * (setEntryPassword + parse-side aliasEntryPasswords threading).
 */

const AES_SIZES = ['128', '192', '256'] as const

export default function GenerateSecretKeyDialog({
  onSubmit,
  onClose,
  error,
}: {
  onSubmit: (opts: GenerateSecretKeyInput) => Promise<boolean>
  onClose: () => void
  error: string | null
}) {
  const { t } = useTranslation()

  const [alias, setAlias] = useState('')
  const [keySize, setKeySize] = useState('256')
  const [busy, setBusy] = useState(false)

  const canSubmit = alias.trim().length > 0 && !busy

  async function submit(): Promise<void> {
    if (!canSubmit) return
    setBusy(true)
    const opts: GenerateSecretKeyInput = {
      alias: alias.trim(),
      keyAlgorithm: 'AES',
      keySize: Number.parseInt(keySize, 10),
    }
    const ok = await onSubmit(opts)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal title={t('tools.keystore.generate.secretKeyTitle')} onClose={onClose}>
      <LabeledInput
        label={t('tools.keystore.generate.alias')}
        value={alias}
        autoFocus
        onChange={setAlias}
        onEnter={() => void submit()}
      />
      <LabeledSelect
        label={t('tools.keystore.generate.keySize')}
        value={keySize}
        onChange={setKeySize}
        options={AES_SIZES.map((s) => [s, `AES-${s} (${s} ${t('tools.keystore.bits')})`])}
      />
      {/* No entry-password field in Faz B2 — the secret entry is protected with
          the store password; per-entry passwords land in Faz B4. */}
      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {t('tools.keystore.generate.secretKeyNote')}
      </p>
      {error && (
        <p className="text-[11px]" style={{ color: '#cc2200' }}>
          {error}
        </p>
      )}
      <ModalActions
        onCancel={onClose}
        confirmLabel={t('tools.keystore.generate.submit')}
        onConfirm={() => void submit()}
        confirmDisabled={!canSubmit}
      />
    </Modal>
  )
}
