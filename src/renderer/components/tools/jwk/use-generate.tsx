/**
 * JWK tool — Generate a key pair tab. Pure move out of `JwkTool.tsx`; behaviour unchanged.
 */
import { useId, useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import { useInvalidateOn } from '../../../lib/use-stale-guard'
import { JWK_ALGORITHMS, generateJwkPair, type Jwk } from '../../../lib/tools/jwk'
import { ErrorLine, Hint, JwkCard, Pane, PemBlock, INPUT_STYLE } from './atoms'
import { type AddKey, type ModePanes } from './shared'

// ─────────────────────────────────────────────────────────────────────────────
// Generate
// ─────────────────────────────────────────────────────────────────────────────

export function useGenerateMode(onAdd: AddKey): ModePanes {
  const { t } = useTranslation()
  const algId = useId()
  const bitsId = useId()
  const [alg, setAlg] = useState<string>('ES256')
  const [bits, setBits] = useState(2048)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pair, setPair] = useState<{
    publicJwk: Jwk
    privateJwk: Jwk
    publicPem: string
    privatePem: string
  } | null>(null)

  const isRsa = alg.startsWith('RS') || alg.startsWith('PS')

  // Generate an ES256 pair, then switch the dropdown to RS256: the ES256 keys
  // used to stay on screen under a control that now said RS256, so the PEM a
  // user copied need not be the algorithm they thought they had picked.
  useInvalidateOn([alg, bits], () => {
    setPair(null)
    setError(null)
  })

  async function run(): Promise<void> {
    setBusy(true)
    setError(null)
    const r = await generateJwkPair(alg, isRsa ? { modulusLength: bits } : undefined)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      setPair(null)
      return
    }
    setPair(r.value)
  }

  const input = (
    <Pane>
      <div className="flex flex-wrap items-center gap-2 p-3">
        <label htmlFor={algId} className="text-xs" style={{ color: 'var(--muted)' }}>
          {t('tools.jwk.algorithm')}
        </label>
        <select
          id={algId}
          value={alg}
          onChange={(e) => setAlg(e.target.value)}
          className="rounded border px-2 py-1 text-xs"
          style={INPUT_STYLE}
        >
          {JWK_ALGORITHMS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        {isRsa ? (
          <>
            <label htmlFor={bitsId} className="text-xs" style={{ color: 'var(--muted)' }}>
              {t('tools.jwk.modulusLength')}
            </label>
            <select
              id={bitsId}
              value={bits}
              onChange={(e) => setBits(Number(e.target.value))}
              className="rounded border px-2 py-1 text-xs"
              style={INPUT_STYLE}
            >
              {[2048, 3072, 4096].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {busy ? t('tools.jwk.generating') : t('tools.jwk.generate')}
        </button>
      </div>
      <div className="px-3 pb-3 text-[11px]" style={{ color: 'var(--hint)' }}>
        {t('tools.jwk.generateHint')}
      </div>
    </Pane>
  )

  const output = (
    <Pane>
      {error ? <ErrorLine text={error} /> : null}
      {pair ? (
        <div className="space-y-3 p-3">
          <JwkCard
            jwk={pair.publicJwk}
            title={t('tools.jwk.publicJwk')}
            onAdd={() => onAdd(pair.publicJwk, 'generated')}
          />
          <JwkCard jwk={pair.privateJwk} title={t('tools.jwk.privateJwk')} />
          <PemBlock title={t('tools.jwk.publicPem')} pem={pair.publicPem} secret={false} />
          <PemBlock title={t('tools.jwk.privatePem')} pem={pair.privatePem} secret />
        </div>
      ) : error ? null : (
        <Hint text={t('tools.jwk.hintGenerate')} />
      )}
    </Pane>
  )

  return { input, output }
}
