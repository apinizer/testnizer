import { useEffect, useState } from 'react'
import { KeyRound, ShieldAlert } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

/**
 * Issue #239 — values marked secret are encrypted at rest with the OS
 * keychain (main: `secret-at-rest.ts`). Two states the user has to see:
 *
 *  - `SecretStorageUnencryptedNote`: the keychain is unavailable (headless
 *    Linux, no libsecret, `basic_text`) — secrets work but are stored
 *    unencrypted. Asks main once per mount (`secureStorage:status`); renders
 *    nothing while unknown or when encryption works.
 *  - `SecretLockedNote`: a stored value this computer cannot decrypt
 *    (keychain reset, profile restored elsewhere) — main hands it out as ''
 *    and keeps the stored value until the user enters a new one.
 */
function useSecretStorageEncrypted(): boolean | null {
  const [encrypted, setEncrypted] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    const status = window.api?.secureStorage?.status
    if (!status) return
    status()
      .then((res) => {
        if (alive && res?.success && res.data) setEncrypted(res.data.encrypted)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return encrypted
}

export function SecretStorageUnencryptedNote({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  const encrypted = useSecretStorageEncrypted()
  if (encrypted !== false) return null
  return (
    <div
      data-testid="secret-storage-unencrypted"
      role="note"
      className={`flex items-start gap-1.5 text-[11px] text-[var(--orange)] ${className}`}
    >
      <ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {t('secret.storedUnencrypted')}{' '}
        {/* What to do about it (review #22): the values still work, locally. */}
        <span data-testid="secret-storage-unencrypted-fix" className="text-[var(--muted)]">
          {t('secret.storedUnencryptedFix')}
        </span>
      </span>
    </div>
  )
}

export function SecretLockedNote({
  testId,
  className = '',
}: {
  testId: string
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid={testId}
      role="note"
      className={`flex items-center gap-1.5 text-[11px] text-[var(--red)] ${className}`}
    >
      <KeyRound size={12} className="shrink-0" aria-hidden="true" />
      <span>{t('env.decryptFailed')}</span>
    </div>
  )
}
