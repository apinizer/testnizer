import { useState } from 'react'
import { Shield, Key, FileWarning } from 'lucide-react'
import { verifySignature, decryptEnvelope } from '../../lib/tools/wsse'
import { openWsSecurityToolWith } from '../../lib/tools-bridge'
import MonacoWrapper from '../shared/MonacoWrapper'

interface VerifyResult {
  valid: boolean
  reason?: string
  signedReferences: string[]
  certInfo?: {
    subject?: string
    issuer?: string
    notAfter?: string
    notBefore?: string
  }
}

const TEXTAREA =
  'w-full min-h-[80px] rounded border border-[var(--border)] bg-[var(--white)] px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]'

interface Props {
  body: string
}

/**
 * SOAP response WS-Security panel.
 *
 * Lets the user paste a verifying certificate / decrypting key and inspect the
 * response: signature validity, signed elements, encrypted content, certificate
 * details. Power-user shortcut: "Open in WS-Security Tool" jumps to a tool tab
 * with the body pre-filled.
 */
export default function WsseResponsePanel({ body }: Props) {
  const [verifyCert, setVerifyCert] = useState('')
  const [decryptKey, setDecryptKey] = useState('')
  const [decryptPass, setDecryptPass] = useState('')
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const [decrypted, setDecrypted] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasSignature = /<(?:ds:)?Signature[\s>]/.test(body)
  const hasEncryption = /<(?:xenc:)?EncryptedData[\s>]/.test(body)

  async function handleVerify() {
    setError(null)
    try {
      const r = await verifySignature(body, verifyCert)
      setVerifyResult(r)
    } catch (e) {
      setVerifyResult(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDecrypt() {
    setError(null)
    try {
      const r = await decryptEnvelope(body, decryptKey, decryptPass || undefined)
      setDecrypted(r)
    } catch (e) {
      setDecrypted(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!body) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
        No response body.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      {/* Detection summary */}
      <div className="mb-3 flex items-center gap-3 text-sm">
        <div className="flex items-center gap-1.5">
          <Shield
            size={14}
            className={hasSignature ? 'text-[var(--green)]' : 'text-[var(--muted)]'}
          />
          <span style={{ color: hasSignature ? 'var(--green)' : 'var(--muted)' }}>
            {hasSignature ? 'Signed' : 'No signature'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Key
            size={14}
            className={hasEncryption ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}
          />
          <span style={{ color: hasEncryption ? 'var(--accent-text)' : 'var(--muted)' }}>
            {hasEncryption ? 'Encrypted' : 'Not encrypted'}
          </span>
        </div>
        <button
          onClick={() => openWsSecurityToolWith(body, 'WS-Security')}
          className="ml-auto rounded border px-2 py-0.5 text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--accent-text)' }}
        >
          Open in WS-Security Tool
        </button>
      </div>

      {/* Verify */}
      {hasSignature && (
        <fieldset className="mb-4 rounded border border-[var(--border)] p-3">
          <legend className="px-1 text-xs font-medium text-[var(--accent-text)]">
            Verify Signature
          </legend>
          <textarea
            value={verifyCert}
            onChange={(e) => setVerifyCert(e.target.value)}
            placeholder="Public certificate (PEM) used to verify"
            className={TEXTAREA}
          />
          <button
            onClick={handleVerify}
            disabled={!verifyCert}
            className="mt-2 rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Verify
          </button>
          {verifyResult && (
            <div
              className="mt-2 rounded p-2 text-xs"
              style={{
                background: verifyResult.valid ? '#e8f9f1' : '#fff0f0',
                color: verifyResult.valid ? 'var(--green)' : 'var(--red)',
              }}
            >
              {verifyResult.valid ? (
                <>
                  <div className="font-semibold">✓ Signature valid</div>
                  <div className="mt-1 text-[var(--muted)]">
                    {verifyResult.signedReferences.length} signed reference
                    {verifyResult.signedReferences.length === 1 ? '' : 's'}
                  </div>
                  {verifyResult.certInfo && (
                    <div className="mt-1 text-[var(--muted)]">
                      <div>Subject: {verifyResult.certInfo.subject ?? '—'}</div>
                      <div>Issuer: {verifyResult.certInfo.issuer ?? '—'}</div>
                      <div>Valid until: {verifyResult.certInfo.notAfter ?? '—'}</div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="font-semibold flex items-center gap-1">
                    <FileWarning size={12} /> Signature INVALID
                  </div>
                  {verifyResult.reason && <div className="mt-1">{verifyResult.reason}</div>}
                </>
              )}
            </div>
          )}
        </fieldset>
      )}

      {/* Decrypt */}
      {hasEncryption && (
        <fieldset className="mb-4 rounded border border-[var(--border)] p-3">
          <legend className="px-1 text-xs font-medium text-[var(--accent-text)]">Decrypt</legend>
          <textarea
            value={decryptKey}
            onChange={(e) => setDecryptKey(e.target.value)}
            placeholder="Private key (PEM)"
            className={TEXTAREA}
          />
          <input
            type="password"
            value={decryptPass}
            onChange={(e) => setDecryptPass(e.target.value)}
            placeholder="Passphrase (optional)"
            className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-xs text-[var(--text)] outline-none"
          />
          <button
            onClick={handleDecrypt}
            disabled={!decryptKey}
            className="mt-2 rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Decrypt
          </button>
          {decrypted && (
            <div
              className="mt-2 overflow-hidden rounded border border-[var(--border)]"
              style={{ height: 200 }}
            >
              <MonacoWrapper value={decrypted} language="xml" readOnly />
            </div>
          )}
        </fieldset>
      )}

      {!hasSignature && !hasEncryption && (
        <div className="rounded border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          This response has no XML signature or encrypted data. Use the standalone WS-Security tool
          to inspect or transform arbitrary payloads.
        </div>
      )}

      {error && (
        <div
          className="mt-2 rounded p-2 text-xs"
          style={{ background: '#fff0f0', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
