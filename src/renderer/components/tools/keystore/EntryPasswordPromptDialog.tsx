import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import { LabeledInput, Modal, ModalActions } from './dialog-ui'

/**
 * Entry Password prompt (FIX 1 / design §3.1). Shown when an open failed because
 * one or more KEY entries are protected with a password ≠ the store password —
 * the JKS/PKCS12 store password validated, but the individual keys could not be
 * decrypted. Each locked alias gets its own password input; on submit the map is
 * handed back to `retryOpenWithEntryPasswords`, which re-invokes open with the
 * same source + store password. The passwords are forwarded straight to the IPC
 * layer and never retained in renderer state (no-leak invariant).
 */
export default function EntryPasswordPromptDialog({
  aliases,
  error,
  onSubmit,
  onClose,
}: {
  aliases: string[]
  error: string | null
  onSubmit: (map: Record<string, string>) => Promise<boolean>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const valid = aliases.every((a) => (values[a] ?? '').length > 0) && !busy

  async function submit(): Promise<void> {
    if (!valid) return
    setBusy(true)
    // On success the store clears `pendingEntryPasswordOpen` → this dialog
    // unmounts; on a repeat recovery failure the prompt stays open with an error.
    await onSubmit(values)
    setBusy(false)
  }

  return (
    <Modal title={t('tools.keystore.entryPasswordPrompt.title')} onClose={onClose}>
      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {t('tools.keystore.entryPasswordPrompt.hint')}
      </p>
      {aliases.map((alias, i) => (
        <LabeledInput
          key={alias}
          label={`${t('tools.keystore.entryPasswordPrompt.entryPasswordFor')} ${alias}`}
          type="password"
          value={values[alias] ?? ''}
          autoFocus={i === 0}
          onChange={(v) => setValues((prev) => ({ ...prev, [alias]: v }))}
          onEnter={() => void submit()}
        />
      ))}
      {error && (
        <p className="text-[11px]" style={{ color: '#cc2200' }}>
          {error}
        </p>
      )}
      <ModalActions
        onCancel={onClose}
        confirmLabel={t('tools.keystore.entryPasswordPrompt.submit')}
        onConfirm={() => void submit()}
        confirmDisabled={!valid}
      />
    </Modal>
  )
}
