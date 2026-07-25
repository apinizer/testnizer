import { useEffect, useId, useMemo, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import KeyMaterialField from '../shared/KeyMaterialField'
import type { KeyMaterialSelection } from '../shared/KeyMaterialPicker'
import type { MaterialSource } from '../../types'
import {
  decodeJwt,
  verifyJwt,
  signJwt,
  isExpired,
  isNotYetValid,
  humanReadableClaims,
  generateSampleJwt,
  isAsymmetric,
  claimsToTable,
  applyClaimEdits,
  claimEditsFromPayload,
  JWT_ALGORITHMS,
  type JwtAlgorithm,
  type ClaimRow,
  type ClaimEdits,
} from '../../lib/tools/jwt'
import { signInMain } from '../../lib/tools/jose-bridge'
import { useTranslation } from '../../lib/i18n'
import ClaimsEditor from './jwt/ClaimsEditor'
import JwksVerifyPanel from './jwt/JwksVerifyPanel'
import JweBody from './jwt/JweBody'
import {
  Badge,
  ClearButton,
  ColorizedJwt,
  CopyButton,
  ModePill,
  PanelHeader,
  ViewToggle,
  colorizeJson,
  rowsToText,
  type View,
} from './jwt/atoms'

const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.KMUFsIDTnFmyG3nMiGM6H9FNFUROf3wh7SmqJp-QV30'
const SAMPLE_HS256_SECRET = 'a-string-secret-at-least-256-bits-long'

/** `jwe` is ADDED by #63; `decode`/`encode` behave exactly as they always have. */
type Mode = 'decode' | 'encode' | 'jwe'

type Verification =
  | { state: 'idle' }
  | { state: 'verifying' }
  | { state: 'valid' }
  | { state: 'invalid'; reason: string }
  | { state: 'error'; message: string }

export default function JwtTool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('decode')

  // ── Decoder state ─────────────────────────────────────────────────
  const [token, setToken] = useState(SAMPLE_JWT)
  const [verifySecret, setVerifySecret] = useState(SAMPLE_HS256_SECRET)
  const [verifyAlgorithm, setVerifyAlgorithm] = useState<JwtAlgorithm>('HS256')
  const [headerView, setHeaderView] = useState<View>('json')
  const [payloadView, setPayloadView] = useState<View>('json')
  const [verification, setVerification] = useState<Verification>({ state: 'idle' })

  // ── Encoder state ─────────────────────────────────────────────────
  const [encAlgorithm, setEncAlgorithm] = useState<JwtAlgorithm>('HS256')
  const [encHeader, setEncHeader] = useState('{\n  "alg": "HS256",\n  "typ": "JWT"\n}')
  const [encPayload, setEncPayload] = useState(
    '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "admin": true,\n  "iat": 1516239022\n}',
  )
  const [encSecret, setEncSecret] = useState(SAMPLE_HS256_SECRET)
  const [encOutput, setEncOutput] = useState('')
  const [encError, setEncError] = useState<string | null>(null)
  /**
   * Claim editor + keystore source — both ADDED by #63 and both inert by
   * default: `{}` edits change nothing, and with no `keySource` the signing
   * path is byte-for-byte the pre-#63 renderer one.
   */
  const [claimEdits, setClaimEdits] = useState<ClaimEdits>({})
  const [encKeySource, setEncKeySource] = useState<MaterialSource | null>(null)
  const [encKeyLabel, setEncKeyLabel] = useState<string | null>(null)

  // ── Decoder derivations ──────────────────────────────────────────
  const decoded = useMemo(() => (token.trim() === '' ? null : decodeJwt(token)), [token])
  const decodeError = decoded && !decoded.ok ? decoded.error : null
  const jwt = decoded && decoded.ok ? decoded.jwt : null
  const expired = jwt ? isExpired(jwt.payload) : false
  const notYet = jwt ? isNotYetValid(jwt.payload) : false

  // Auto-pick verify algorithm from header.alg whenever a fresh JWT is decoded.
  useEffect(() => {
    if (!jwt) return
    const alg = jwt.header.alg
    if (typeof alg === 'string' && (JWT_ALGORITHMS as string[]).includes(alg)) {
      setVerifyAlgorithm(alg as JwtAlgorithm)
    }
  }, [jwt])

  // ── Verify on demand (button) ────────────────────────────────────
  async function runVerify() {
    if (!jwt) return
    setVerification({ state: 'verifying' })
    const r = await verifyJwt(token, verifySecret, verifyAlgorithm)
    if (!r.ok) setVerification({ state: 'error', message: r.error })
    else if (r.valid) setVerification({ state: 'valid' })
    else setVerification({ state: 'invalid', reason: r.reason })
  }

  /**
   * The payload as it would be signed — the JSON the user typed, with the claim
   * editor's registered claims merged on top. With no edits this is the parsed
   * JSON unchanged, which is what keeps the pre-#63 encoder byte-for-byte.
   */
  const encPayloadPreview = useMemo(() => {
    try {
      const parsed = JSON.parse(encPayload) as Record<string, unknown>
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
      return applyClaimEdits(parsed, claimEdits)
    } catch {
      return {}
    }
  }, [encPayload, claimEdits])

  // ── Sign (encoder) ───────────────────────────────────────────────
  async function runSign() {
    setEncError(null)
    let payloadObj: Record<string, unknown>
    let headerObj: Record<string, unknown>
    try {
      payloadObj = JSON.parse(encPayload)
      if (typeof payloadObj !== 'object' || payloadObj === null || Array.isArray(payloadObj)) {
        throw new Error('Payload must be a JSON object')
      }
    } catch (e) {
      setEncError(`Payload JSON: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    try {
      headerObj = JSON.parse(encHeader)
      if (typeof headerObj !== 'object' || headerObj === null || Array.isArray(headerObj)) {
        throw new Error('Header must be a JSON object')
      }
    } catch (e) {
      setEncError(`Header JSON: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    // Registered-claim edits are applied here, not in the payload editor, so the
    // relative offsets ('15m') resolve against the instant of signing.
    payloadObj = applyClaimEdits(payloadObj, claimEdits)

    // ONE added arm: a keystore-backed key signs IN MAIN — the private key must
    // never reach this process. Everything else keeps the original local path.
    if (encKeySource) {
      const r = await signInMain({
        mode: 'jwt',
        alg: encAlgorithm,
        payload: payloadObj,
        header: headerObj,
        key: { source: encKeySource },
      })
      if (!r.ok) {
        setEncError(r.error)
        setEncOutput('')
        return
      }
      setEncOutput(r.value)
      return
    }

    const r = await signJwt(payloadObj, encSecret, encAlgorithm, headerObj)
    if (!r.ok) {
      setEncError(r.error)
      setEncOutput('')
      return
    }
    setEncOutput(r.token)
  }

  // ── Generate example for current mode ────────────────────────────
  async function loadSample(alg: JwtAlgorithm) {
    const r = await generateSampleJwt(alg)
    if (!r.ok) {
      if (mode === 'encode') setEncError(r.error)
      else setVerification({ state: 'error', message: r.error })
      return
    }
    const s = r.sample
    if (mode === 'decode') {
      setToken(s.token)
      setVerifyAlgorithm(alg)
      setVerifySecret(s.secret ?? s.publicKey ?? '')
      setVerification({ state: 'idle' })
    } else {
      setEncAlgorithm(alg)
      setEncHeader(`{\n  "alg": "${alg}",\n  "typ": "JWT"\n}`)
      setEncSecret(s.secret ?? s.privateKey ?? '')
      setEncOutput(s.token)
      setEncError(null)
    }
  }

  // ── Sync header.alg in encoder when algorithm dropdown changes ───
  useEffect(() => {
    try {
      const h = JSON.parse(encHeader)
      if (typeof h === 'object' && h !== null && !Array.isArray(h) && h.alg !== encAlgorithm) {
        setEncHeader(JSON.stringify({ ...h, alg: encAlgorithm }, null, 2))
      }
    } catch {
      // header invalid JSON; leave alone, user will fix it
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encAlgorithm])

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2"
        style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
      >
        <h2 className="m-0 text-base font-semibold" style={{ color: 'var(--heading)' }}>
          {t('tools.jwt.title')}
        </h2>

        <div
          className="flex items-center rounded-full p-0.5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <ModePill active={mode === 'decode'} onClick={() => setMode('decode')}>
            {t('tools.jwt.tabDecoder')}
          </ModePill>
          <ModePill active={mode === 'encode'} onClick={() => setMode('encode')}>
            {t('tools.jwt.tabEncoder')}
          </ModePill>
          <ModePill active={mode === 'jwe'} onClick={() => setMode('jwe')}>
            {t('tools.jwt.tabJwe')}
          </ModePill>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
            {t('tools.jwt.generateExample')}
          </span>
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value as JwtAlgorithm
              if (v) loadSample(v)
              e.target.value = ''
            }}
            className="rounded border px-2 py-1 text-xs"
            style={{
              background: 'var(--white)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
              minWidth: 180,
            }}
          >
            <option value="">{t('tools.jwt.selectAlgorithm')}</option>
            {JWT_ALGORITHMS.filter((a) => a !== 'none').map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      {mode === 'decode' ? (
        <DecoderBody
          token={token}
          setToken={setToken}
          decodeError={decodeError}
          jwt={jwt}
          expired={expired}
          notYet={notYet}
          headerView={headerView}
          setHeaderView={setHeaderView}
          payloadView={payloadView}
          setPayloadView={setPayloadView}
          verifyAlgorithm={verifyAlgorithm}
          setVerifyAlgorithm={setVerifyAlgorithm}
          verifySecret={verifySecret}
          setVerifySecret={setVerifySecret}
          verification={verification}
          runVerify={runVerify}
          t={t}
        />
      ) : mode === 'jwe' ? (
        <JweBody />
      ) : (
        <EncoderBody
          algorithm={encAlgorithm}
          setAlgorithm={setEncAlgorithm}
          header={encHeader}
          setHeader={setEncHeader}
          payload={encPayload}
          setPayload={setEncPayload}
          secret={encSecret}
          setSecret={setEncSecret}
          output={encOutput}
          error={encError}
          runSign={runSign}
          claimEdits={claimEdits}
          setClaimEdits={setClaimEdits}
          claimPreview={encPayloadPreview}
          keySource={encKeySource}
          keyLabel={encKeyLabel}
          onKeySource={(sel) => {
            setEncKeySource(sel ? sel.source : null)
            setEncKeyLabel(sel ? sel.label : null)
          }}
          t={t}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Decoder body
// ─────────────────────────────────────────────────────────────────
function DecoderBody(props: {
  token: string
  setToken: (s: string) => void
  decodeError: string | null
  jwt: {
    header: Record<string, unknown>
    payload: Record<string, unknown>
    signature: string
  } | null
  expired: boolean
  notYet: boolean
  headerView: View
  setHeaderView: (v: View) => void
  payloadView: View
  setPayloadView: (v: View) => void
  verifyAlgorithm: JwtAlgorithm
  setVerifyAlgorithm: (a: JwtAlgorithm) => void
  verifySecret: string
  setVerifySecret: (s: string) => void
  verification: Verification
  runVerify: () => void
  t: (k: string) => string
}) {
  const {
    token,
    setToken,
    decodeError,
    jwt,
    expired,
    notYet,
    headerView,
    setHeaderView,
    payloadView,
    setPayloadView,
    verifyAlgorithm,
    setVerifyAlgorithm,
    verifySecret,
    setVerifySecret,
    verification,
    runVerify,
    t,
  } = props

  const claims = jwt ? humanReadableClaims(jwt.payload) : null
  const headerRows = jwt ? claimsToTable(jwt.header) : []
  const payloadRows = jwt ? claimsToTable(jwt.payload) : []
  const asymmetric = isAsymmetric(verifyAlgorithm)
  const algorithmId = useId()
  const secretId = useId()

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: encoded token */}
      <div
        className="flex min-w-0 flex-1 flex-col border-r"
        style={{ borderColor: 'var(--border)' }}
      >
        <PanelHeader
          title={t('tools.jwt.encodedToken')}
          actions={
            <>
              <CopyButton text={token} />
              <ClearButton onClick={() => setToken('')} />
            </>
          }
        />
        <div className="flex-1 min-h-0">
          <MonacoWrapper value={token} onChange={setToken} language="plaintext" wordWrap />
        </div>
        <div
          className="shrink-0 border-t px-3 py-2 text-xs"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          {decodeError ? (
            <Badge color="#cc2200">
              {t('tools.common.error')}: {decodeError}
            </Badge>
          ) : !jwt ? (
            <span style={{ color: 'var(--muted)' }}>{t('tools.jwt.pasteHint')}</span>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge color="#1a7a4a">{t('tools.jwt.validJwt')}</Badge>
              {expired ? <Badge color="#cc2200">{t('tools.jwt.expired')}</Badge> : null}
              {notYet ? <Badge color="#b35a00">{t('tools.jwt.notYetValid')}</Badge> : null}
              {verification.state === 'valid' ? (
                <Badge color="#1a7a4a">{t('tools.jwt.signatureVerified')}</Badge>
              ) : null}
              {verification.state === 'invalid' ? (
                <Badge color="#cc2200">
                  {t('tools.jwt.invalid')}: {verification.reason}
                </Badge>
              ) : null}
              {verification.state === 'error' ? (
                <Badge color="#cc2200">
                  {t('tools.common.error')}: {verification.message}
                </Badge>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Right: decoded sections */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        {decodeError || !jwt ? (
          <div className="p-4 text-sm" style={{ color: 'var(--muted)' }}>
            {decodeError ? `${t('tools.common.error')}: ${decodeError}` : t('tools.jwt.pasteHint')}
          </div>
        ) : (
          <>
            <Section
              title={t('tools.jwt.decodedHeader')}
              view={headerView}
              setView={setHeaderView}
              json={JSON.stringify(jwt.header, null, 2)}
              rows={headerRows}
            />
            <Section
              title={t('tools.jwt.decodedPayload')}
              view={payloadView}
              setView={setPayloadView}
              json={JSON.stringify(claims, null, 2)}
              rows={payloadRows}
            />
            <div className="border-b px-3 pt-3 pb-2" style={{ borderColor: 'var(--border)' }}>
              <div
                className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text)' }}
              >
                {t('tools.jwt.signatureVerification')}{' '}
                <span className="font-normal" style={{ color: 'var(--muted)' }}>
                  ({t('tools.jwt.optional')})
                </span>
              </div>

              <div className="mb-2 flex items-center gap-2">
                <label
                  htmlFor={algorithmId}
                  className="text-xs"
                  style={{ color: 'var(--muted)', minWidth: 80 }}
                >
                  {t('tools.jwt.algorithm')}
                </label>
                <select
                  id={algorithmId}
                  value={verifyAlgorithm}
                  onChange={(e) => setVerifyAlgorithm(e.target.value as JwtAlgorithm)}
                  className="rounded border px-2 py-1 text-xs"
                  style={{
                    background: 'var(--white)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                >
                  {JWT_ALGORITHMS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              <label
                htmlFor={secretId}
                className="mb-1 block text-xs"
                style={{ color: 'var(--muted)' }}
              >
                {asymmetric ? t('tools.jwt.publicKey') : t('tools.jwt.secret')}
              </label>
              <textarea
                id={secretId}
                value={verifySecret}
                onChange={(e) => setVerifySecret(e.target.value)}
                rows={asymmetric ? 6 : 2}
                placeholder={
                  asymmetric
                    ? '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----'
                    : 'shared secret'
                }
                className="w-full rounded border px-2 py-1 font-mono text-xs"
                style={{
                  background: 'var(--white)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
              />

              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={runVerify}
                  disabled={verifyAlgorithm !== 'none' && verifySecret.trim() === ''}
                  className="rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {verification.state === 'verifying'
                    ? t('tools.jwt.verifying')
                    : t('tools.jwt.verifyButton')}
                </button>
                {verification.state === 'valid' ? (
                  <Badge color="#1a7a4a">{t('tools.jwt.signatureVerified')}</Badge>
                ) : verification.state === 'invalid' ? (
                  <Badge color="#cc2200">
                    {t('tools.jwt.invalid')}: {verification.reason}
                  </Badge>
                ) : verification.state === 'error' ? (
                  <Badge color="#cc2200">
                    {t('tools.common.error')}: {verification.message}
                  </Badge>
                ) : null}
              </div>
            </div>

            {/*
              ADDED by #63: one MORE way to verify. The pasted secret/PEM block
              above is untouched and remains the default path — this panel is
              inert until the user fills it in.
            */}
            <JwksVerifyPanel token={token} algorithm={verifyAlgorithm} />
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Encoder body
// ─────────────────────────────────────────────────────────────────
function EncoderBody(props: {
  algorithm: JwtAlgorithm
  setAlgorithm: (a: JwtAlgorithm) => void
  header: string
  setHeader: (s: string) => void
  payload: string
  setPayload: (s: string) => void
  secret: string
  setSecret: (s: string) => void
  output: string
  error: string | null
  runSign: () => void
  claimEdits: ClaimEdits
  setClaimEdits: (e: ClaimEdits) => void
  claimPreview: Record<string, unknown>
  keySource: MaterialSource | null
  keyLabel: string | null
  onKeySource: (sel: KeyMaterialSelection | null) => void
  t: (k: string) => string
}) {
  const {
    algorithm,
    setAlgorithm,
    header,
    setHeader,
    payload,
    setPayload,
    secret,
    setSecret,
    output,
    error,
    runSign,
    claimEdits,
    setClaimEdits,
    claimPreview,
    keySource,
    keyLabel,
    onKeySource,
    t,
  } = props
  /**
   * One instant for the whole editing session. Reading the clock during render
   * would make the expiry preview drift on every keystroke and would say
   * something different from what the eventual sign actually writes.
   */
  const [nowSeconds] = useState(() => Math.floor(Date.now() / 1000))

  const algId = useId()
  const signSecretId = useId()
  const headerValid = useMemo(() => {
    try {
      const v = JSON.parse(header)
      return typeof v === 'object' && v !== null && !Array.isArray(v)
    } catch {
      return false
    }
  }, [header])
  const payloadValid = useMemo(() => {
    try {
      const v = JSON.parse(payload)
      return typeof v === 'object' && v !== null && !Array.isArray(v)
    } catch {
      return false
    }
  }, [payload])
  const asymmetric = isAsymmetric(algorithm)

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: header / payload / secret */}
      <div
        className="flex min-w-0 flex-1 flex-col overflow-auto border-r"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="border-b" style={{ borderColor: 'var(--border)' }}>
          <PanelHeader
            title={t('tools.jwt.headerLabel')}
            actions={
              <>
                <CopyButton text={header} />
                <ClearButton onClick={() => setHeader('{\n  "alg": "HS256",\n  "typ": "JWT"\n}')} />
              </>
            }
          />
          <div style={{ height: 140 }}>
            <MonacoWrapper value={header} onChange={setHeader} language="json" />
          </div>
          <div className="px-3 py-1.5 text-xs">
            {headerValid ? (
              <Badge color="#1a7a4a">{t('tools.jwt.validHeader')}</Badge>
            ) : (
              <Badge color="#cc2200">{t('tools.jwt.invalidJson')}</Badge>
            )}
          </div>
        </div>

        <div className="border-b" style={{ borderColor: 'var(--border)' }}>
          <PanelHeader
            title={t('tools.jwt.payloadLabel')}
            actions={
              <>
                <CopyButton text={payload} />
                <ClearButton onClick={() => setPayload('{\n  \n}')} />
              </>
            }
          />
          <div style={{ height: 220 }}>
            <MonacoWrapper value={payload} onChange={setPayload} language="json" />
          </div>
          <div className="px-3 py-1.5 text-xs">
            {payloadValid ? (
              <Badge color="#1a7a4a">{t('tools.jwt.validPayload')}</Badge>
            ) : (
              <Badge color="#cc2200">{t('tools.jwt.invalidJson')}</Badge>
            )}
          </div>
        </div>

        {/* ADDED by #63 — registered claims merged over the payload JSON above. */}
        <div className="border-b" style={{ borderColor: 'var(--border)' }}>
          <ClaimsEditor
            edits={claimEdits}
            onChange={setClaimEdits}
            previewPayload={claimPreview}
            nowSeconds={nowSeconds}
          />
          <div className="px-3 pb-2">
            <button
              onClick={() => {
                try {
                  const parsed = JSON.parse(payload) as Record<string, unknown>
                  setClaimEdits(claimEditsFromPayload(parsed, nowSeconds))
                } catch {
                  /* invalid JSON — the payload panel already says so */
                }
              }}
              disabled={!payloadValid}
              className="rounded border px-2 py-0.5 text-[11px] disabled:opacity-50"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--muted)',
                background: 'var(--white)',
              }}
            >
              {t('tools.jwt.claimsSeed')}
            </button>
          </div>
        </div>

        <div>
          <div
            className="flex items-center justify-between border-b px-3 py-2"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <span
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              {t('tools.jwt.signJwt')}
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor={algId} className="sr-only">
                {t('tools.jwt.algorithm')}
              </label>
              <select
                id={algId}
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value as JwtAlgorithm)}
                className="rounded border px-2 py-1 text-xs"
                style={{
                  background: 'var(--white)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
              >
                {JWT_ALGORITHMS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="px-3 py-2">
            <label
              htmlFor={signSecretId}
              className="mb-1 block text-xs"
              style={{ color: 'var(--muted)' }}
            >
              {algorithm === 'none'
                ? t('tools.jwt.noKeyNeeded')
                : asymmetric
                  ? t('tools.jwt.privateKey')
                  : t('tools.jwt.secret')}
            </label>
            {algorithm !== 'none' && (
              <textarea
                id={signSecretId}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                rows={asymmetric ? 6 : 2}
                disabled={!!keySource}
                placeholder={
                  asymmetric
                    ? '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'
                    : 'shared secret'
                }
                className="w-full rounded border px-2 py-1 font-mono text-xs disabled:opacity-50"
                style={{
                  background: 'var(--white)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
              />
            )}

            {/*
              ADDED by #63. Pasting a key above stays the DEFAULT: picking
              nothing here leaves the signing path exactly as it was. Choosing a
              source moves the signature into MAIN — the private key is resolved
              there and the renderer only ever receives the finished token.
            */}
            {asymmetric && (
              <div className="mt-2">
                <KeyMaterialField
                  value={keySource}
                  label={keyLabel}
                  hint={t('tools.jwt.keySourceHint')}
                  onChange={onKeySource}
                />
              </div>
            )}

            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={runSign}
                disabled={!headerValid || !payloadValid}
                className="rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {t('tools.jwt.signButton')}
              </button>
              {error ? (
                <Badge color="#cc2200">
                  {t('tools.common.error')}: {error}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Right: encoded JWT */}
      <div className="flex min-w-0 flex-1 flex-col">
        <PanelHeader title={t('tools.jwt.encodedJwt')} actions={<CopyButton text={output} />} />
        <div className="flex-1 overflow-auto p-3" style={{ background: 'var(--white)' }}>
          {output ? (
            <ColorizedJwt token={output} />
          ) : (
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {t('tools.jwt.signHint')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Decoded sections
//
// The presentational atoms (PanelHeader/Badge/CopyButton/…) moved to
// ./jwt/atoms when #63 added the claim editor, the JWKS panel and the JWE
// screen — same markup, so these views render exactly as before.
// ─────────────────────────────────────────────────────────────────
function Section({
  title,
  view,
  setView,
  json,
  rows,
}: {
  title: string
  view: View
  setView: (v: View) => void
  json: string
  rows: ClaimRow[]
}) {
  return (
    <div className="border-b" style={{ borderColor: 'var(--border)' }}>
      <div
        className="flex items-center justify-between border-b px-3 py-1.5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <span
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--muted)' }}
        >
          {title}
        </span>
        <div className="flex items-center gap-1">
          <ViewToggle active={view === 'json'} onClick={() => setView('json')}>
            JSON
          </ViewToggle>
          <ViewToggle active={view === 'table'} onClick={() => setView('table')}>
            Table
          </ViewToggle>
          <CopyButton text={view === 'json' ? json : rowsToText(rows)} />
        </div>
      </div>
      {view === 'json' ? (
        <pre
          className="m-0 px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all"
          style={{ background: 'var(--white)', color: 'var(--text)' }}
        >
          {colorizeJson(json)}
        </pre>
      ) : (
        <ClaimTable rows={rows} />
      )}
    </div>
  )
}

function ClaimTable({ rows }: { rows: ClaimRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="px-3 py-3 text-xs" style={{ color: 'var(--muted)' }}>
        —
      </div>
    )
  }
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr style={{ background: 'var(--surface)' }}>
            <th
              className="border-b px-3 py-1.5 text-left font-semibold"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              Claim
            </th>
            <th
              className="border-b px-3 py-1.5 text-left font-semibold"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              Value
            </th>
            <th
              className="border-b px-3 py-1.5 text-left font-semibold"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              Description
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td
                className="border-b px-3 py-1.5 align-top font-mono"
                style={{ borderColor: 'var(--border)', color: 'var(--blue, #0066cc)' }}
              >
                {r.key}
              </td>
              <td
                className="border-b px-3 py-1.5 align-top font-mono break-all"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                {r.value}
                {r.iso ? <div style={{ color: 'var(--muted)' }}>{r.iso}</div> : null}
              </td>
              <td
                className="border-b px-3 py-1.5 align-top"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                {r.description ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
