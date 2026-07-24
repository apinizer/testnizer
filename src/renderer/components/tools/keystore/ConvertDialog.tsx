import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import type { ConvertInput } from '../../../stores/keystore.store'
import type { KeystoreType } from '../../../types'
import { LabeledInput, LabeledSelect, Modal, ModalActions } from './dialog-ui'

/**
 * Convert Keystore dialog (design §4.15 / §9.5). Target type defaults to the
 * OPPOSITE of the current type; a new store password is required. An optional
 * entry password unlocks key entries whose password differs from the store
 * password. Main builds a NEW session (the original stays open) — the converted
 * bytes live in memory until Save-As, so the store marks the new session dirty.
 */
export default function ConvertDialog({
  currentType,
  error,
  onSubmit,
  onClose,
}: {
  currentType: KeystoreType
  error: string | null
  onSubmit: (opts: ConvertInput) => Promise<boolean>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const opposite: KeystoreType = currentType === 'JKS' ? 'PKCS12' : 'JKS'
  const [targetType, setTargetType] = useState<KeystoreType>(opposite)
  const [newPassword, setNewPassword] = useState('')
  const [entryPassword, setEntryPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = newPassword.length > 0 && !busy

  async function submit(): Promise<void> {
    if (!valid) return
    setBusy(true)
    const ok = await onSubmit({
      targetType,
      newPassword,
      ...(entryPassword ? { entryPassword } : {}),
    })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal title={t('tools.keystore.convert.title')} onClose={onClose}>
      <LabeledSelect
        label={t('tools.keystore.convert.targetType')}
        value={targetType}
        onChange={(v) => setTargetType(v as KeystoreType)}
        options={[
          ['PKCS12', 'PKCS12'],
          ['JKS', 'JKS'],
        ]}
      />
      <LabeledInput
        label={t('tools.keystore.convert.newPassword')}
        type="password"
        value={newPassword}
        autoFocus
        onChange={setNewPassword}
      />
      <LabeledInput
        label={`${t('tools.keystore.convert.entryPassword')} (${t('tools.keystore.optional')})`}
        type="password"
        value={entryPassword}
        onChange={setEntryPassword}
        onEnter={() => void submit()}
      />
      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {t('tools.keystore.convert.hint')}
      </p>
      {error && (
        <p className="text-[11px]" style={{ color: '#cc2200' }}>
          {error}
        </p>
      )}
      <ModalActions
        onCancel={onClose}
        confirmLabel={t('tools.keystore.convert.submit')}
        onConfirm={() => void submit()}
        confirmDisabled={!valid}
      />
    </Modal>
  )
}
