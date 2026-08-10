import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import type { RenameAliasInput } from '../../../stores/keystore.store'
import { LabeledInput, Modal, ModalActions } from './dialog-ui'

/**
 * Rename Alias dialog (design §4.10 / §9.5). A key entry whose password differs
 * from the store password needs its `entryPassword` to be re-protected under the
 * new alias — that field shows only for key entries. Certificate entries take the
 * `setCertificateEntry` path in main and need no password.
 */
export default function RenameAliasDialog({
  alias,
  isKeyEntry,
  error,
  onSubmit,
  onClose,
}: {
  alias: string
  isKeyEntry: boolean
  error: string | null
  onSubmit: (opts: RenameAliasInput) => Promise<boolean>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [newAlias, setNewAlias] = useState(alias)
  const [entryPassword, setEntryPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = newAlias.trim().length > 0 && !busy

  async function submit(): Promise<void> {
    if (!valid) return
    setBusy(true)
    const ok = await onSubmit({
      alias,
      newAlias: newAlias.trim(),
      ...(isKeyEntry && entryPassword ? { entryPassword } : {}),
    })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal title={t('tools.keystore.rename.title')} onClose={onClose}>
      <LabeledInput
        label={t('tools.keystore.rename.newAlias')}
        value={newAlias}
        autoFocus
        onChange={setNewAlias}
        onEnter={() => void submit()}
      />
      {isKeyEntry && (
        <>
          <LabeledInput
            label={`${t('tools.keystore.rename.entryPassword')} (${t('tools.keystore.optional')})`}
            type="password"
            value={entryPassword}
            onChange={setEntryPassword}
            onEnter={() => void submit()}
          />
          <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {t('tools.keystore.rename.entryPasswordHint')}
          </p>
        </>
      )}
      {error && (
        <p className="text-[11px]" style={{ color: '#cc2200' }}>
          {error}
        </p>
      )}
      <ModalActions
        onCancel={onClose}
        confirmLabel={t('tools.keystore.rename.submit')}
        onConfirm={() => void submit()}
        confirmDisabled={!valid}
      />
    </Modal>
  )
}
