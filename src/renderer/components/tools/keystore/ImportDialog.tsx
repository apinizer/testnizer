import { useMemo, useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import { useKeystoreStore } from '../../../stores/keystore.store'
import { LabeledInput, LabeledSelect, LabeledTextarea, Modal, ModalActions } from './dialog-ui'

/**
 * Import Entry dialog (design §9.5) — a single dialog with a FORMAT selector
 * that swaps the field set:
 *
 *  • PKCS#12          — source file (native picker → path read in MAIN) +
 *                       source password + optional source alias + optional
 *                       target alias. Blank source alias ⇒ import ALL entries.
 *  • PKCS#8 / OpenSSL — target alias + private-key PEM + certificate PEM. Main
 *                       runs the deterministic key-cert match gate before it
 *                       mutates, so a wrong key+cert pair is rejected.
 *  • Pasted PEM       — target alias + one PEM blob (key+cert ⇒ key entry,
 *                       cert-only ⇒ trusted entry — main decides).
 *  • Trusted Cert     — target alias + certificate: paste PEM/DER OR load a
 *                       certificate file. A trusted certificate is PUBLIC
 *                       material, so reading it in the renderer is safe.
 *
 * ADDITIVE-INPUT invariant: the PKCS#12 route uses a FILE (bytes stay in main —
 * the design §3.8 pattern (B) native picker, never a renderer byte round-trip);
 * the three PEM routes take PASTED text. Neither forces the other.
 *
 * No per-entry password field (Faz B4) — imported entries are protected with
 * the store password (see keystore.store.ts).
 */

type ImportFormat = 'pkcs12' | 'keyMaterial' | 'pem' | 'trustedCert'

export default function ImportDialog({
  onClose,
  error,
}: {
  onClose: () => void
  error: string | null
}) {
  const { t } = useTranslation()
  const pickFile = useKeystoreStore((s) => s.pickFile)
  const importPkcs12 = useKeystoreStore((s) => s.importPkcs12)
  const importKeyMaterial = useKeystoreStore((s) => s.importKeyMaterial)
  const importPem = useKeystoreStore((s) => s.importPem)
  const importTrustedCert = useKeystoreStore((s) => s.importTrustedCert)

  const [format, setFormat] = useState<ImportFormat>('pkcs12')
  const [alias, setAlias] = useState('')
  // PKCS#12
  const [sourcePath, setSourcePath] = useState('')
  const [sourceFileName, setSourceFileName] = useState('')
  const [sourcePassword, setSourcePassword] = useState('')
  const [sourceAlias, setSourceAlias] = useState('')
  // PKCS#8 / OpenSSL
  const [privateKeyPem, setPrivateKeyPem] = useState('')
  const [certificatePem, setCertificatePem] = useState('')
  // Pasted PEM
  const [pemContent, setPemContent] = useState('')
  // Trusted certificate
  const [certificateContent, setCertificateContent] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function chooseSourceFile(): Promise<void> {
    const pick = await pickFile()
    if (!pick) return
    setSourcePath(pick.path)
    setSourceFileName(pick.fileName)
  }

  // Trusted certificates are public — reading the file in the renderer does not
  // cross the no-secret boundary. PEM stays text; binary DER is base64-encoded
  // so the single `certificateContent` field carries either form (main accepts
  // "PEM or base64 DER").
  function onCertFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const buf = reader.result
      if (!(buf instanceof ArrayBuffer)) return
      const bytes = new Uint8Array(buf)
      const text = new TextDecoder().decode(bytes)
      if (text.includes('BEGIN CERTIFICATE')) {
        setCertificateContent(text)
      } else {
        let bin = ''
        for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
        setCertificateContent(btoa(bin))
      }
    }
    // Surface a read failure instead of silently swallowing it — the upload path
    // must fail visibly (a locked/deleted file, permission error, etc.).
    reader.onerror = () => setFileError(t('tools.keystore.import.fileReadError'))
    reader.readAsArrayBuffer(file)
    // Allow re-selecting the same file after a clear.
    e.target.value = ''
  }

  const isImportValid = useMemo((): boolean => {
    if (busy) return false
    switch (format) {
      case 'pkcs12':
        return sourcePath.trim().length > 0
      case 'keyMaterial':
        return (
          alias.trim().length > 0 &&
          privateKeyPem.trim().length > 0 &&
          certificatePem.trim().length > 0
        )
      case 'pem':
        return alias.trim().length > 0 && pemContent.trim().length > 0
      case 'trustedCert':
        return alias.trim().length > 0 && certificateContent.trim().length > 0
    }
  }, [
    busy,
    format,
    alias,
    sourcePath,
    privateKeyPem,
    certificatePem,
    pemContent,
    certificateContent,
  ])

  async function submit(): Promise<void> {
    if (!isImportValid) return
    setBusy(true)
    let ok = false
    switch (format) {
      case 'pkcs12':
        ok = await importPkcs12({
          sourcePath: sourcePath.trim(),
          ...(sourcePassword ? { sourcePassword } : {}),
          ...(sourceAlias.trim() ? { sourceAlias: sourceAlias.trim() } : {}),
          ...(alias.trim() ? { alias: alias.trim() } : {}),
        })
        break
      case 'keyMaterial':
        ok = await importKeyMaterial({ alias: alias.trim(), privateKeyPem, certificatePem })
        break
      case 'pem':
        ok = await importPem({ alias: alias.trim(), pemContent })
        break
      case 'trustedCert':
        ok = await importTrustedCert({ alias: alias.trim(), certificateContent })
        break
    }
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal title={t('tools.keystore.import.title')} onClose={onClose} wide>
      <LabeledSelect
        label={t('tools.keystore.import.format')}
        value={format}
        onChange={(v) => {
          // The password belongs to the source the user was importing FROM. It
          // is write-only by design, and leaving it in renderer state after the
          // user has moved to a different format keeps a secret alive for the
          // lifetime of the dialog with no way to see or clear it.
          setSourcePassword('')
          setFormat(v as ImportFormat)
        }}
        options={[
          ['pkcs12', t('tools.keystore.import.format.pkcs12')],
          ['keyMaterial', t('tools.keystore.import.format.keyMaterial')],
          ['pem', t('tools.keystore.import.format.pem')],
          ['trustedCert', t('tools.keystore.import.format.trustedCert')],
        ]}
      />

      {format === 'pkcs12' && (
        <>
          <div>
            <span
              className="mb-0.5 block text-[10px] uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              {t('tools.keystore.import.sourceFile')}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void chooseSourceFile()}
                className="shrink-0 rounded border px-2.5 py-1 text-[11px]"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--white)',
                  color: 'var(--text)',
                }}
              >
                {t('tools.keystore.import.chooseFile')}
              </button>
              <span className="truncate text-xs" style={{ color: 'var(--muted)' }}>
                {sourceFileName || t('tools.keystore.import.noFile')}
              </span>
            </div>
          </div>
          <LabeledInput
            label={`${t('tools.keystore.import.sourcePassword')} (${t('tools.keystore.optional')})`}
            type="password"
            value={sourcePassword}
            onChange={setSourcePassword}
          />
          <LabeledInput
            label={`${t('tools.keystore.import.sourceAlias')} (${t('tools.keystore.optional')})`}
            value={sourceAlias}
            placeholder={t('tools.keystore.import.sourceAliasHint')}
            onChange={setSourceAlias}
          />
          <LabeledInput
            label={`${t('tools.keystore.import.targetAlias')} (${t('tools.keystore.optional')})`}
            value={alias}
            onChange={setAlias}
          />
        </>
      )}

      {format === 'keyMaterial' && (
        <>
          <LabeledInput
            label={t('tools.keystore.import.alias')}
            value={alias}
            autoFocus
            onChange={setAlias}
          />
          <LabeledTextarea
            label={t('tools.keystore.import.privateKeyPem')}
            value={privateKeyPem}
            placeholder={t('tools.keystore.import.privateKeyHint')}
            onChange={setPrivateKeyPem}
            rows={5}
          />
          <LabeledTextarea
            label={t('tools.keystore.import.certificatePem')}
            value={certificatePem}
            placeholder={t('tools.keystore.import.certificateChainHint')}
            onChange={setCertificatePem}
            rows={5}
          />
        </>
      )}

      {format === 'pem' && (
        <>
          <LabeledInput
            label={t('tools.keystore.import.alias')}
            value={alias}
            autoFocus
            onChange={setAlias}
          />
          <LabeledTextarea
            label={t('tools.keystore.import.pemContent')}
            value={pemContent}
            placeholder={t('tools.keystore.import.pemHint')}
            onChange={setPemContent}
            rows={8}
          />
        </>
      )}

      {format === 'trustedCert' && (
        <>
          <LabeledInput
            label={t('tools.keystore.import.alias')}
            value={alias}
            autoFocus
            onChange={setAlias}
          />
          <LabeledTextarea
            label={t('tools.keystore.import.certificateContent')}
            value={certificateContent}
            placeholder={t('tools.keystore.import.certificateContentHint')}
            onChange={setCertificateContent}
            rows={6}
          />
          <label
            className="inline-flex cursor-pointer items-center gap-2 text-[11px]"
            style={{ color: 'var(--accentText)' }}
          >
            <span
              className="rounded border px-2.5 py-1"
              style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
            >
              {t('tools.keystore.import.loadFile')}
            </span>
            <input
              type="file"
              accept=".pem,.crt,.cer,.der,application/x-x509-ca-cert"
              className="hidden"
              onChange={onCertFile}
            />
          </label>
        </>
      )}

      {(fileError || error) && (
        <p className="text-[11px]" style={{ color: '#cc2200' }}>
          {fileError || error}
        </p>
      )}

      <ModalActions
        onCancel={onClose}
        confirmLabel={t('tools.keystore.import.submit')}
        onConfirm={() => void submit()}
        confirmDisabled={!isImportValid}
      />
    </Modal>
  )
}
