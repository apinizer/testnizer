import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import type { SetEntryPasswordInput } from '../../../stores/keystore.store'
import { LabeledInput, Modal, ModalActions } from './dialog-ui'

/**
 * Set Entry Password dialog (design §4.12 / §9.5) — rotates a single KEY entry's
 * password. The current entry password is optional (blank ⇒ the store password);
 * the new password is confirmed client-side before the call. Main rejects a
 * certificate entry, an empty new password, or a wrong current password with the
 * verbatim §8 string.
 */
export default function SetEntryPasswordDialog({
  alias,
  error,
  onSubmit,
  onClose,
}: {
  alias: string
  error: string | null
  onSubmit: (opts: SetEntryPasswordInput) => Promise<boolean>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [entryPassword, setEntryPassword] = useState('')
  const [newEntryPassword, setNewEntryPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const mismatch = confirm.length > 0 && confirm !== newEntryPassword
  const valid = newEntryPassword.length > 0 && !mismatch && !busy

  async function submit(): Promise<void> {
    if (!valid) return
    setBusy(true)
    const ok = await onSubmit({
      alias,
      ...(entryPassword ? { entryPassword } : {}),
      newEntryPassword,
    })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal title={`${t('tools.keystore.setEntryPw.title')} · ${alias}`} onClose={onClose}>
      <LabeledInput
        label={`${t('tools.keystore.setEntryPw.currentPassword')} (${t('tools.keystore.optional')})`}
        type="password"
        value={entryPassword}
        onChange={setEntryPassword}
      />
      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {t('tools.keystore.setEntryPw.currentPasswordHint')}
      </p>
      <LabeledInput
        label={t('tools.keystore.setEntryPw.newPassword')}
        type="password"
        value={newEntryPassword}
        autoFocus
        onChange={setNewEntryPassword}
      />
      <LabeledInput
        label={t('tools.keystore.setEntryPw.confirmPassword')}
        type="password"
        value={confirm}
        onChange={setConfirm}
        onEnter={() => void submit()}
      />
      {mismatch && (
        <p className="text-[11px]" style={{ color: '#cc2200' }}>
          {t('tools.keystore.setEntryPw.mismatch')}
        </p>
      )}
      {error && (
        <p className="text-[11px]" style={{ color: '#cc2200' }}>
          {error}
        </p>
      )}
      <ModalActions
        onCancel={onClose}
        confirmLabel={t('tools.keystore.setEntryPw.submit')}
        onConfirm={() => void submit()}
        confirmDisabled={!valid}
      />
    </Modal>
  )
}
