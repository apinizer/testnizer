import { useId, useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import { useInvalidateOn } from '../../../lib/use-stale-guard'
import {
  fetchJwksViaMain,
  verifyInMain,
  type JoseClaimChecks,
} from '../../../lib/tools/jose-bridge'
import { Badge, FIELD_STYLE } from './atoms'

/**
 * Verify a token against a JWKS — the #61→#63 bridge (#63).
 *
 * ── Why this whole panel goes through MAIN ──────────────────────────────────
 *
 * A JWKS URL is a cross-origin GET, and `index.html` pins
 * `connect-src 'self'`: the renderer cannot reach an identity provider at all,
 * by design. So both the fetch and the verification run in main
 * (`jose:fetchJwks` / `jose:verify` with `jwksUri`), and only the outcome comes
 * back. The pasted-JWKS arm could technically verify locally, but it goes the
 * same way so that both arms share one algorithm-pinning code path.
 *
 * ── ADDITIVE ────────────────────────────────────────────────────────────────
 *
 * This is one MORE way to verify. The pasted secret / PEM control above it is
 * untouched and remains the default; a user who never opens this panel sees the
 * pre-#63 debugger exactly as it was.
 *
 * ── Algorithm pinning ───────────────────────────────────────────────────────
 *
 * The allowlist is sent explicitly and defaults to the token's own header only
 * as a convenience for the field's initial value — main never derives it. That
 * is what refuses an `alg:'HS256'` forgery signed with the public key from the
 * very JWKS being trusted.
 */
export default function JwksVerifyPanel({
  token,
  algorithm,
}: {
  token: string
  /** Pre-fills the allowlist from the decoded header; the user may override. */
  algorithm: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'url' | 'paste'>('url')
  const [uri, setUri] = useState('')
  const [pasted, setPasted] = useState('')
  const [allowed, setAllowed] = useState(algorithm)
  const [audience, setAudience] = useState('')
  const [issuer, setIssuer] = useState('')
  const [tolerance, setTolerance] = useState('')
  /**
   * Which action is running. One shared `busy` flag meant Load and Verify could
   * not report progress separately — Load's button never changed while it was
   * fetching, so a slow endpoint looked like a dead button.
   */
  const [busyKind, setBusyKind] = useState<'load' | 'verify' | null>(null)
  const busy = busyKind !== null
  const [result, setResult] = useState<
    | { state: 'idle' }
    | { state: 'valid'; header: Record<string, unknown> }
    | { state: 'invalid'; reason: string }
  >({ state: 'idle' })
  /**
   * Outcome of the LAST Load, kept apart from the verification verdict.
   *
   * A failed fetch used to be written into `result` as `{state:'invalid'}`,
   * which renders far down the panel as a red "Invalid: fetch failed" next to
   * the Verify button — so an unreachable JWKS endpoint read as "your token is
   * invalid". They are different questions and now have different answers.
   */
  const [loadState, setLoadState] = useState<
    | { kind: 'idle' }
    | { kind: 'loaded'; count: number; kids: string[] }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  /*
   * The allowlist is seeded from the decoded header, but `useState(algorithm)`
   * only reads that ONCE — paste a token signed with a different alg and the pin
   * silently stayed on the previous one, so verification enforced an algorithm
   * the user could no longer see any reason for. Re-seed when the prop moves;
   * the user's own edits still win until the token changes again.
   */
  useInvalidateOn([algorithm], () => setAllowed(algorithm))

  /*
   * A fetched key set describes ONE endpoint. Editing the URI (or switching to
   * the pasted document) leaves the "Keys fetched (3)" line describing something
   * that was never loaded.
   */
  useInvalidateOn([uri, mode], () => setLoadState({ kind: 'idle' }))

  const uriId = useId()
  const pasteId = useId()
  const algsId = useId()
  const audId = useId()
  const issId = useId()
  const skewId = useId()

  function claimChecks(): JoseClaimChecks | undefined {
    const checks: JoseClaimChecks = {}
    if (audience.trim()) checks.audience = audience.trim()
    if (issuer.trim()) checks.issuer = issuer.trim()
    if (tolerance.trim()) checks.clockTolerance = tolerance.trim()
    return Object.keys(checks).length > 0 ? checks : undefined
  }

  /**
   * Fetch the key set as a PREFLIGHT — it reports what the endpoint serves and
   * nothing more. Verify deliberately re-fetches: caching the set here would let
   * a key rotation between Load and Verify produce a confident "signature
   * invalid" against keys the IdP has already retired.
   */
  async function loadSet(): Promise<void> {
    setBusyKind('load')
    setLoadState({ kind: 'idle' })
    const res = await fetchJwksViaMain(uri.trim())
    setBusyKind(null)
    if (!res.ok) {
      setLoadState({ kind: 'error', message: res.error })
      return
    }
    setLoadState({
      kind: 'loaded',
      count: res.value.keys.length,
      // `kid` is optional in the DOM's JsonWebKey type but is what identifies a
      // key in practice, so it is read defensively and simply omitted when absent.
      kids: res.value.keys
        .map((k) => (k as { kid?: unknown }).kid)
        .filter((k): k is string => typeof k === 'string' && k.length > 0),
    })
    // The previous verification verdict still describes the token, so it stays.
  }

  async function run(): Promise<void> {
    setBusyKind('verify')
    const algorithms = allowed
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)

    let jwks: { keys: JsonWebKey[] } | undefined
    if (mode === 'paste') {
      try {
        const parsed = JSON.parse(pasted) as { keys?: JsonWebKey[] }
        if (!Array.isArray(parsed?.keys)) throw new Error('Expected a {"keys":[…]} document')
        jwks = { keys: parsed.keys }
      } catch (e) {
        setBusyKind(null)
        setResult({
          state: 'invalid',
          reason: `JWKS JSON: ${e instanceof Error ? e.message : String(e)}`,
        })
        return
      }
    }

    const res = await verifyInMain({
      mode: 'jwt',
      token,
      algorithms: algorithms.length > 0 ? algorithms : undefined,
      ...(mode === 'url' ? { jwksUri: uri.trim() } : { jwks }),
      claims: claimChecks(),
    })
    setBusyKind(null)
    if (!res.ok) setResult({ state: 'invalid', reason: res.error })
    else setResult({ state: 'valid', header: res.value.header })
  }

  const canRun = token.trim() !== '' && (mode === 'url' ? uri.trim() !== '' : pasted.trim() !== '')

  return (
    <div className="border-b px-3 pt-3 pb-3" style={{ borderColor: 'var(--border)' }}>
      <div
        className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--text)' }}
      >
        {t('tools.jwt.jwksTitle')}{' '}
        <span className="font-normal" style={{ color: 'var(--muted)' }}>
          ({t('tools.jwt.optional')})
        </span>
      </div>

      <div className="mb-2 flex items-center gap-1.5">
        <Choice active={mode === 'url'} onClick={() => setMode('url')}>
          {t('tools.jwt.jwksFromUrl')}
        </Choice>
        <Choice active={mode === 'paste'} onClick={() => setMode('paste')}>
          {t('tools.jwt.jwksPaste')}
        </Choice>
      </div>

      {mode === 'url' ? (
        <>
          <label htmlFor={uriId} className="mb-1 block text-xs" style={{ color: 'var(--muted)' }}>
            {t('tools.jwt.jwksUrl')}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={uriId}
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="https://idp.example.com/.well-known/jwks.json"
              className="w-full rounded border px-2 py-1 font-mono text-xs"
              style={FIELD_STYLE}
            />
            <button
              onClick={loadSet}
              disabled={busy || uri.trim() === ''}
              className="shrink-0 rounded border px-2 py-1 text-xs disabled:opacity-50"
              style={{ ...FIELD_STYLE, color: 'var(--accentText)' }}
            >
              {busyKind === 'load' ? t('tools.jwt.loading') : t('tools.jwt.jwksLoad')}
            </button>
          </div>
          {/*
            Load's outcome belongs HERE, beside the button that produced it. A
            fetch failure used to be routed into the verification verdict far
            below, where it rendered as "Invalid: fetch failed" — reading as a
            verdict on the token rather than on the endpoint.
          */}
          {loadState.kind === 'error' ? (
            <div role="alert" className="mt-1 text-[10px]" style={{ color: '#cc2200' }}>
              {t('tools.jwt.jwksLoadFailed')}: {loadState.message}
            </div>
          ) : loadState.kind === 'loaded' ? (
            <div
              role="status"
              className="mt-1 text-[10px]"
              style={{ color: 'var(--green, #1a7a4a)' }}
            >
              {t('tools.jwt.jwksLoaded')} ({loadState.count})
              {loadState.kids.length > 0 ? ` · ${loadState.kids.join(', ')}` : ''}
            </div>
          ) : (
            <div className="mt-1 text-[10px]" style={{ color: 'var(--hint)' }}>
              {t('tools.jwt.jwksUrlHint')}
            </div>
          )}
        </>
      ) : (
        <>
          <label htmlFor={pasteId} className="mb-1 block text-xs" style={{ color: 'var(--muted)' }}>
            {t('tools.jwt.jwksDocument')}
          </label>
          <textarea
            id={pasteId}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            placeholder='{"keys":[{"kty":"RSA","kid":"…","n":"…","e":"AQAB"}]}'
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
        </>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Small id={algsId} label={t('tools.jwt.allowedAlgorithms')}>
          <input
            id={algsId}
            value={allowed}
            onChange={(e) => setAllowed(e.target.value)}
            placeholder="RS256"
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
        </Small>
        <Small id={skewId} label={t('tools.jwt.clockTolerance')}>
          <input
            id={skewId}
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
            placeholder="60s"
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
        </Small>
        <Small id={issId} label={t('tools.jwt.expectedIssuer')}>
          <input
            id={issId}
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
        </Small>
        <Small id={audId} label={t('tools.jwt.expectedAudience')}>
          <input
            id={audId}
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
        </Small>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={run}
          disabled={busy || !canRun}
          className="rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {busy ? t('tools.jwt.verifying') : t('tools.jwt.jwksVerifyButton')}
        </button>
        {result.state === 'valid' ? (
          <Badge color="#1a7a4a">
            {t('tools.jwt.signatureVerified')}
            {typeof result.header.kid === 'string' ? ` — kid ${result.header.kid}` : ''}
          </Badge>
        ) : result.state === 'invalid' ? (
          <Badge color="#cc2200">
            {t('tools.jwt.invalid')}: {result.reason}
          </Badge>
        ) : null}
      </div>
      <div className="mt-1 text-[10px]" style={{ color: 'var(--hint)' }}>
        {t('tools.jwt.jwksAlgHint')}
      </div>
    </div>
  )
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="rounded px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: active ? 'var(--accentLight)' : 'transparent',
        color: active ? 'var(--accentText)' : 'var(--muted)',
        border: '1px solid',
        borderColor: active ? 'var(--accentText)' : 'var(--border)',
      }}
    >
      {children}
    </button>
  )
}

function Small({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>
        {label}
      </label>
      {children}
    </div>
  )
}
