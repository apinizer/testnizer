import { useId, useMemo, useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import KeyMaterialField from '../../shared/KeyMaterialField'
import type { KeyMaterialSelection } from '../../shared/KeyMaterialPicker'
import type { MaterialSource } from '../../../types'
import {
  JWE_CONTENT_ENCRYPTIONS,
  JWE_KEY_ALGORITHMS,
  isSymmetricJweAlgorithm,
  parseJoseHeader,
} from '../../../lib/tools/jwt'
import { decryptInMain, encryptInMain, type JoseKeyInput } from '../../../lib/tools/jose-bridge'
import { Badge, ColorizedJwt, FIELD_STYLE, PanelHeader, CopyButton } from './atoms'

/**
 * JWE encrypt / decrypt (#63).
 *
 * ── Where the crypto runs ───────────────────────────────────────────────────
 *
 * Always in MAIN, via `jose:encrypt` / `jose:decrypt`. Unlike the JWS screens —
 * whose pasted-key path predates #63 and stays in the renderer byte-for-byte —
 * JWE is entirely new, so there is no legacy renderer path to preserve and no
 * reason to build a second one. That also means the keystore arm is not a
 * special case here: `{inline}` and `{source}` are the same union either way,
 * and a provider-backed private key is never materialized in the renderer.
 *
 * ── Key shape follows the algorithm ─────────────────────────────────────────
 *
 * `dir`, the AES key-wrap families and PBES2 take a shared SECRET; everything
 * else takes the recipient's public key to encrypt and the matching private key
 * to decrypt. The form re-labels itself from `isSymmetricJweAlgorithm`, and
 * main re-decides it authoritatively before touching any key.
 */
export default function JweBody(): React.JSX.Element {
  const { t } = useTranslation()
  const [alg, setAlg] = useState<string>('RSA-OAEP-256')
  const [enc, setEnc] = useState<string>('A256GCM')
  const [plaintext, setPlaintext] = useState('{"card":"4111111111111111"}')
  const [jwe, setJwe] = useState('')
  const [secret, setSecret] = useState('')
  const [publicPem, setPublicPem] = useState('')
  const [privatePem, setPrivatePem] = useState('')
  const [keySource, setKeySource] = useState<MaterialSource | null>(null)
  const [keyLabel, setKeyLabel] = useState<string | null>(null)
  const [decrypted, setDecrypted] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const algId = useId()
  const encId = useId()
  const secretId = useId()
  const pubId = useId()
  const privId = useId()

  const symmetric = isSymmetricJweAlgorithm(alg)
  const inspected = useMemo(() => (jwe.trim() === '' ? null : parseJoseHeader(jwe)), [jwe])

  /**
   * Mirror a pasted token's alg/enc into the selects.
   *
   * Decryption PINS the key-management algorithm to what is selected here — the
   * token's header must never be what silently decides how it gets decrypted.
   * Reflecting it into the visible controls keeps that pin honest: the user can
   * see and override what will be enforced, instead of hitting an opaque
   * "algorithm not allowed" because a dropdown was left on a stale value.
   *
   * Done on edit rather than in an effect so the selects stay plain controlled
   * inputs — a later manual change must not be snapped back by a re-render.
   */
  function onJweChanged(next: string): void {
    setJwe(next)
    const parsed = parseJoseHeader(next)
    if (parsed.kind !== 'jwe' || !('header' in parsed)) return
    if (typeof parsed.header.alg === 'string') setAlg(parsed.header.alg)
    if (typeof parsed.header.enc === 'string') setEnc(parsed.header.enc)
  }

  /** The keystore arm is offered only where a key PAIR is meaningful. */
  function encryptKey(): JoseKeyInput {
    if (symmetric) return { inline: { secret } }
    if (keySource) return { source: keySource }
    return { inline: { certPem: publicPem } }
  }
  function decryptKey(): JoseKeyInput {
    if (symmetric) return { inline: { secret } }
    if (keySource) return { source: keySource }
    return { inline: { privateKeyPem: privatePem } }
  }

  async function runEncrypt(): Promise<void> {
    setError(null)
    setBusy(true)
    const res = await encryptInMain({ alg, enc, plaintext, key: encryptKey() })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setJwe(res.value)
  }

  async function runDecrypt(): Promise<void> {
    setError(null)
    setBusy(true)
    setDecrypted('')
    const res = await decryptInMain({ alg, enc, jwe: jwe.trim(), key: decryptKey() })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setDecrypted(res.value.plaintext)
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: algorithm + key + plaintext */}
      <div
        className="flex min-w-0 flex-1 flex-col overflow-auto border-r"
        style={{ borderColor: 'var(--border)' }}
      >
        <PanelHeader title={t('tools.jwt.jweSettings')} />
        <div className="grid grid-cols-2 gap-2 px-3 py-2">
          <div>
            <label
              htmlFor={algId}
              className="mb-0.5 block text-[11px]"
              style={{ color: 'var(--muted)' }}
            >
              {t('tools.jwt.jweAlg')}
            </label>
            <select
              id={algId}
              value={alg}
              onChange={(e) => setAlg(e.target.value)}
              className="w-full rounded border px-2 py-1 text-xs"
              style={FIELD_STYLE}
            >
              {JWE_KEY_ALGORITHMS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor={encId}
              className="mb-0.5 block text-[11px]"
              style={{ color: 'var(--muted)' }}
            >
              {t('tools.jwt.jweEnc')}
            </label>
            <select
              id={encId}
              value={enc}
              onChange={(e) => setEnc(e.target.value)}
              className="w-full rounded border px-2 py-1 text-xs"
              style={FIELD_STYLE}
            >
              {JWE_CONTENT_ENCRYPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="px-3 pb-2">
          {symmetric ? (
            <>
              <label
                htmlFor={secretId}
                className="mb-1 block text-xs"
                style={{ color: 'var(--muted)' }}
              >
                {t('tools.jwt.jweSecret')}
              </label>
              <textarea
                id={secretId}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                rows={2}
                placeholder="a 32-byte secret for A256GCM"
                className="w-full rounded border px-2 py-1 font-mono text-xs"
                style={FIELD_STYLE}
              />
              <div className="mt-1 text-[10px]" style={{ color: 'var(--hint)' }}>
                {t('tools.jwt.jweSecretHint')}
              </div>
            </>
          ) : (
            <>
              <label
                htmlFor={pubId}
                className="mb-1 block text-xs"
                style={{ color: 'var(--muted)' }}
              >
                {t('tools.jwt.jweRecipientKey')}
              </label>
              <textarea
                id={pubId}
                value={publicPem}
                onChange={(e) => setPublicPem(e.target.value)}
                rows={4}
                disabled={!!keySource}
                placeholder="-----BEGIN CERTIFICATE-----"
                className="w-full rounded border px-2 py-1 font-mono text-xs disabled:opacity-50"
                style={FIELD_STYLE}
              />
              <label
                htmlFor={privId}
                className="mt-2 mb-1 block text-xs"
                style={{ color: 'var(--muted)' }}
              >
                {t('tools.jwt.jwePrivateKey')}
              </label>
              <textarea
                id={privId}
                value={privatePem}
                onChange={(e) => setPrivatePem(e.target.value)}
                rows={4}
                disabled={!!keySource}
                placeholder="-----BEGIN PRIVATE KEY-----"
                className="w-full rounded border px-2 py-1 font-mono text-xs disabled:opacity-50"
                style={FIELD_STYLE}
              />
              <div className="mt-2">
                <KeyMaterialField
                  value={keySource}
                  label={keyLabel}
                  hint={t('tools.jwt.keySourceHint')}
                  onChange={(sel: KeyMaterialSelection | null) => {
                    setKeySource(sel ? sel.source : null)
                    setKeyLabel(sel ? sel.label : null)
                  }}
                />
              </div>
            </>
          )}
        </div>

        <PanelHeader
          title={t('tools.jwt.jwePlaintext')}
          actions={<CopyButton text={plaintext} />}
        />
        <div className="px-3 py-2">
          <textarea
            value={plaintext}
            onChange={(e) => setPlaintext(e.target.value)}
            rows={5}
            aria-label={t('tools.jwt.jwePlaintext')}
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={runEncrypt}
              disabled={busy || plaintext === ''}
              className="rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {t('tools.jwt.jweEncryptButton')}
            </button>
            <button
              onClick={runDecrypt}
              disabled={busy || jwe.trim() === ''}
              className="rounded border px-3 py-1 text-xs font-medium disabled:opacity-50"
              style={{ ...FIELD_STYLE, color: 'var(--accentText)' }}
            >
              {t('tools.jwt.jweDecryptButton')}
            </button>
            {error ? (
              <Badge color="#cc2200">
                {t('tools.common.error')}: {error}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      {/* Right: the compact JWE + what came back out of it */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <PanelHeader title={t('tools.jwt.jweToken')} actions={<CopyButton text={jwe} />} />
        <div className="px-3 py-2">
          <textarea
            value={jwe}
            onChange={(e) => onJweChanged(e.target.value)}
            rows={6}
            aria-label={t('tools.jwt.jweToken')}
            placeholder={t('tools.jwt.jweHint')}
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
          {jwe ? (
            <div className="mt-2">
              <ColorizedJwt token={jwe} />
            </div>
          ) : null}
          {inspected ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge color={inspected.kind === 'jwe' ? '#7c1fa6' : '#b35a00'}>
                {inspected.kind.toUpperCase()} — {inspected.segments} segments
              </Badge>
              {'header' in inspected ? (
                <span className="font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
                  alg={String(inspected.header.alg)} enc={String(inspected.header.enc)}
                </span>
              ) : (
                <Badge color="#cc2200">{inspected.error}</Badge>
              )}
            </div>
          ) : null}
        </div>

        <PanelHeader
          title={t('tools.jwt.jweDecrypted')}
          actions={<CopyButton text={decrypted} />}
        />
        <pre
          className="m-0 flex-1 px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all"
          style={{ background: 'var(--white)', color: 'var(--text)' }}
        >
          {decrypted || ''}
        </pre>
      </div>
    </div>
  )
}
