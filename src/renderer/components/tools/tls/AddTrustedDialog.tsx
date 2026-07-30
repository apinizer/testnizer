/**
 * TLS Inspector — "Add as trusted" dialog. Pure move out of
 * `TlsInspectorTool.tsx`.
 */
import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import { toast } from '../../../lib/toast'
import { useKeystoreStore } from '../../../stores/keystore.store'
import type { KeystoreLibraryEntry, TlsCertificateInfo } from '../../../types'
import { trustedAliasFor } from '../../../lib/tools/tls-inspect'
import { Caption, DialogBtn, RED } from './atoms'

export default function AddTrustedDialog({
  cert,
  host,
  onClose,
}: {
  cert: TlsCertificateInfo
  host: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const sessionId = useKeystoreStore((s) => s.sessionId)
  const fileName = useKeystoreStore((s) => s.fileName)
  const library = useKeystoreStore((s) => s.library)
  const [busy, setBusy] = useState(false)
  /** Failure shown INSIDE this dialog — it stays open when an action fails. */
  const [err, setErr] = useState<string | null>(null)

  async function doImport(): Promise<void> {
    setBusy(true)
    const ok = await useKeystoreStore
      .getState()
      .importTrustedCert({ alias: trustedAliasFor(host, cert), certificateContent: cert.pem })
    setBusy(false)
    if (ok) {
      toast.success(t('tools.tlsInspect.trustAdded'))
      onClose()
    } else {
      const message = useKeystoreStore.getState().error ?? t('tools.tlsInspect.trustFailed')
      setErr(message)
      toast.error(message)
    }
  }

  /**
   * Create a fresh store and put the certificate in it.
   *
   * This used to call `createNew({ type: 'PKCS12' })` with NO password, which
   * the engine rejected — and the failure went nowhere: the store recorded it in
   * its global `error`, this function ignored the `false`, and the dialog just
   * sat there. Two consequences, both reported: the button appeared to do
   * nothing, and the orphaned message later surfaced as a red banner on the
   * Keystore Studio screen the user opened next.
   *
   * A truststore holds no keys, so an empty PKCS#12 password is legitimate here
   * (see `createEmpty`); what was missing is saying so — and reporting failure.
   */
  async function createThenImport(): Promise<void> {
    setBusy(true)
    const ok = await useKeystoreStore.getState().createNew({ type: 'PKCS12', password: '' })
    setBusy(false)
    if (ok) {
      await doImport()
      return
    }
    setErr(useKeystoreStore.getState().error ?? t('tools.tlsInspect.trustFailed'))
  }

  async function openThenImport(entry: KeystoreLibraryEntry): Promise<void> {
    setBusy(true)
    const ok = await useKeystoreStore.getState().openFromLibrary({ id: entry.id, name: entry.name })
    setBusy(false)
    if (ok) {
      await doImport()
      return
    }
    setErr(useKeystoreStore.getState().error ?? t('tools.tlsInspect.trustFailed'))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-lg p-4 shadow-xl"
        style={{ background: 'var(--white)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
          {t('tools.tlsInspect.addTrusted')}
        </h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {cert.subjectDN}
        </p>
        {err && (
          <p role="alert" className="m-0 text-[11px]" style={{ color: RED }}>
            {err}
          </p>
        )}

        {sessionId ? (
          <>
            <p className="text-xs" style={{ color: 'var(--text)' }}>
              {t('tools.tlsInspect.trustIntoOpen').replace(
                '{name}',
                fileName ?? t('tools.tlsInspect.untitledStore'),
              )}
            </p>
            <div className="flex justify-end gap-2">
              <DialogBtn onClick={onClose}>{t('tools.common.cancel')}</DialogBtn>
              <DialogBtn primary disabled={busy} onClick={() => void doImport()}>
                {t('tools.tlsInspect.addTrusted')}
              </DialogBtn>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs" style={{ color: 'var(--text)' }}>
              {t('tools.tlsInspect.noKeystoreOpen')}
            </p>
            {library.length > 0 && (
              <div className="flex flex-col gap-1">
                <Caption>{t('tools.tlsInspect.openFromLibrary')}</Caption>
                {library.map((e) => (
                  <button
                    key={e.id}
                    disabled={busy || !e.remembered}
                    onClick={() => void openThenImport(e)}
                    className="rounded border px-2.5 py-1.5 text-left text-xs disabled:opacity-40"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'var(--white)',
                      color: 'var(--text)',
                    }}
                    title={e.remembered ? '' : t('tools.tlsInspect.libraryNeedsPassword')}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <DialogBtn onClick={onClose}>{t('tools.common.cancel')}</DialogBtn>
              <DialogBtn primary disabled={busy} onClick={() => void createThenImport()}>
                {t('tools.tlsInspect.createAndAdd')}
              </DialogBtn>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── primitives ───────────────────────────────────────────────────────────────
