/**
 * JWK tool — PEM → JWK tab. Pure move out of `JwkTool.tsx`; behaviour unchanged.
 */
import { useId, useState } from 'react'
import KeyMaterialField from '../../shared/KeyMaterialField'
import { useTranslation } from '../../../lib/i18n'
import { useInvalidateOn } from '../../../lib/use-stale-guard'
import type { MaterialSource } from '../../../types'
import { stripSourceSecrets } from '../../../lib/key-material'
import {
  JWK_ALGORITHMS,
  parseJwkText,
  pemToJwk,
  toPublicJwk,
  type Jwk,
} from '../../../lib/tools/jwk'
import { ErrorLine, Field, Hint, JwkCard, Pane, INPUT_STYLE } from './atoms'
import { type AddKey, type ModePanes, type Origin } from './shared'

// ─────────────────────────────────────────────────────────────────────────────
// PEM → JWK
// ─────────────────────────────────────────────────────────────────────────────

export function useFromPemMode(onAdd: AddKey): ModePanes {
  const { t } = useTranslation()
  const algId = useId()
  const [pem, setPem] = useState('')
  const [alg, setAlg] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ jwk: Jwk; origin: Origin; note?: string } | null>(null)
  const [source, setSource] = useState<MaterialSource | null>(null)
  const [sourceLabel, setSourceLabel] = useState<string | null>(null)

  // Convert PEM A, then paste PEM B: A's JWK card used to stay. Worse for the
  // keystore arm — clearing the selection left the card and its "from keystore"
  // note on screen, still describing a key that was no longer selected.
  useInvalidateOn([pem, alg, source], () => {
    setResult(null)
    setError(null)
  })

  async function convert(): Promise<void> {
    setBusy(true)
    setError(null)
    const r = await pemToJwk(pem, alg || undefined)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      setResult(null)
      return
    }
    setResult({ jwk: r.value.jwk, origin: 'pasted' })
  }

  /**
   * The ADDED option. Main resolves the source through `jwks:build`, which reads
   * `publicJwk` only and re-strips every private member before serializing — so
   * what arrives here is publishable by construction. The pasted PEM textarea is
   * left exactly as the user typed it; clearing the selection returns to the
   * untouched default path.
   */
  async function loadFromSource(picked: MaterialSource, label: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const api = (window as Window & typeof globalThis).api
      const res = await api.jwks.build({ sources: [picked] })
      if (!res.success || !res.data) {
        throw new Error(res.error || t('tools.jwk.keystoreFailed'))
      }
      const parsed = parseJwkText(res.data.body)
      if (!parsed.ok) throw new Error(parsed.error)
      const first = parsed.value.keys[0]
      if (!first) throw new Error(t('tools.jwk.keystoreFailed'))
      // Defence in depth: main already resolves `publicJwk` only and re-strips
      // before serializing, but a provider-backed key must not be able to reach
      // this window in private form through ANY future change upstream. The
      // renderer therefore refuses to hold what it was promised not to receive.
      const jwk = toPublicJwk(first)
      // The picker's store/entry passwords are WRITE-ONLY: they rode the IPC
      // call above and must not linger in renderer state for the tab's
      // lifetime. Keep only the opaque reference.
      setSource(stripSourceSecrets(picked) as MaterialSource)
      setSourceLabel(label)
      setResult({ jwk, origin: 'keystore', note: t('tools.jwk.fromKeystore') })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  const input = (
    <Pane>
      <Field label={t('tools.jwk.pemInput')}>
        <textarea
          value={pem}
          onChange={(e) => setPem(e.target.value)}
          rows={10}
          spellCheck={false}
          aria-label={t('tools.jwk.pemInput')}
          placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
          className="w-full rounded border px-2 py-1 font-mono text-xs"
          style={INPUT_STYLE}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
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
          <option value="">{t('tools.jwk.autoDetect')}</option>
          {JWK_ALGORITHMS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={convert}
          disabled={busy || pem.trim() === ''}
          className="rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {t('tools.jwk.convert')}
        </button>
      </div>

      <div className="border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
        <KeyMaterialField
          value={source}
          label={sourceLabel}
          // The resolver must be able to OPEN the alias as a key entry; only the
          // PUBLIC half of what it finds ever comes back across the bridge.
          filter="privateKey"
          hint={t('tools.jwk.keystoreHint')}
          onChange={(sel) => {
            if (!sel) {
              setSource(null)
              setSourceLabel(null)
              return
            }
            void loadFromSource(sel.source, sel.label)
          }}
        />
      </div>
    </Pane>
  )

  const output = (
    <Pane>
      {error ? <ErrorLine text={error} /> : null}
      {result ? (
        <div className="p-3">
          <JwkCard
            jwk={result.jwk}
            note={result.note}
            onAdd={() => onAdd(result.jwk, result.origin)}
          />
        </div>
      ) : error ? null : (
        <Hint text={t('tools.jwk.hintFromPem')} />
      )}
    </Pane>
  )

  return { input, output }
}
