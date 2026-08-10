import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import type { ChangeStorePasswordInput } from '../../../stores/keystore.store'
import { LabeledInput, Modal, ModalActions } from './dialog-ui'

/**
 * Change Store Password dialog (design §4.11 / §9.5). New password + confirm.
 * Main re-encrypts every key entry under the new password (atomic — verified
 * recoverable first). A key entry whose password differs from the store password
 * surfaces the §8 "Cannot recover key entry …" error verbatim; the user then
 * rotates that entry's password first (Set Entry Password) or reopens with it.
 */
export default function ChangeStorePasswordDialog({
  error,
  onSubmit,
  onClose,
}: {
  error: string | null
  onSubmit: (opts: ChangeStorePasswordInput) => Promise<boolean>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const mismatch = confirm.length > 0 && confirm !== newPassword
  const valid = newPassword.length > 0 && !mismatch && !busy

  async function submit(): Promise<void> {
    if (!valid) return
    setBusy(true)
    const ok = await onSubmit({ newPassword })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal title={t('tools.keystore.changePw.title')} onClose={onClose}>
      <LabeledInput
        label={t('tools.keystore.changePw.newPassword')}
        type="password"
        value={newPassword}
        autoFocus
        onChange={setNewPassword}
      />
      <LabeledInput
        label={t('tools.keystore.changePw.confirmPassword')}
        type="password"
        value={confirm}
        onChange={setConfirm}
        onEnter={() => void submit()}
      />
      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {t('tools.keystore.changePw.hint')}
      </p>
      {mismatch && (
        <p className="text-[11px]" style={{ color: '#cc2200' }}>
          {t('tools.keystore.changePw.mismatch')}
        </p>
      )}
      {error && (
        <p className="text-[11px]" style={{ color: '#cc2200' }}>
          {error}
        </p>
      )}
      <ModalActions
        onCancel={onClose}
        confirmLabel={t('tools.keystore.changePw.submit')}
        onConfirm={() => void submit()}
        confirmDisabled={!valid}
      />
    </Modal>
  )
}
