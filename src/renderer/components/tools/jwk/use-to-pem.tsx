/**
 * JWK tool — JWK → PEM tab. Pure move out of `JwkTool.tsx`; behaviour unchanged.
 */
import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import { useInvalidateOn } from '../../../lib/use-stale-guard'
import { jwkToPem, parseJwkText, type Jwk } from '../../../lib/tools/jwk'
import { ErrorLine, Field, Hint, JwkCard, Pane, PemBlock, INPUT_STYLE } from './atoms'
import { SAMPLE_JWK, type AddKey, type ModePanes } from './shared'

// ─────────────────────────────────────────────────────────────────────────────
// JWK → PEM (also the validate / pretty-print surface)
// ─────────────────────────────────────────────────────────────────────────────

export function useToPemMode(onAdd: AddKey): ModePanes {
  const { t } = useTranslation()
  const [text, setText] = useState(SAMPLE_JWK)
  const [error, setError] = useState<string | null>(null)
  const [keys, setKeys] = useState<Jwk[]>([])
  const [pem, setPem] = useState<{ pem: string; kind: 'public' | 'private' } | null>(null)
  /** Explicit outcome of the last Validate — the button had no visible effect. */
  const [verdict, setVerdict] = useState<{ count: number } | null>(null)

  // Editing the JWK invalidates everything derived from the previous one. The
  // PEM was the dangerous one: convert key A, paste key B, press Validate, and
  // B's card sat next to A's PEM with nothing saying they disagreed.
  useInvalidateOn([text], () => {
    setError(null)
    setKeys([])
    setPem(null)
    setVerdict(null)
  })

  function validate(): Jwk[] | null {
    const parsed = parseJwkText(text)
    if (!parsed.ok) {
      setError(parsed.error)
      setKeys([])
      setPem(null)
      setVerdict(null)
      return null
    }
    setError(null)
    setKeys(parsed.value.keys)
    // The PEM on screen was produced from whatever was in the box at the time;
    // re-validating does not re-derive it, so it must not survive.
    setPem(null)
    setVerdict({ count: parsed.value.keys.length })
    return parsed.value.keys
  }

  async function toPem(): Promise<void> {
    const parsed = validate()
    if (!parsed) return
    const r = await jwkToPem(parsed[0])
    if (!r.ok) {
      setError(r.error)
      setPem(null)
      return
    }
    setPem({ pem: r.value.pem, kind: r.value.kind })
  }

  const input = (
    <Pane>
      <Field label={t('tools.jwk.jwkInput')}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          spellCheck={false}
          aria-label={t('tools.jwk.jwkInput')}
          placeholder={t('tools.jwk.pasteJwk')}
          className="w-full rounded border px-2 py-1 font-mono text-xs"
          style={INPUT_STYLE}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
        <button
          type="button"
          onClick={validate}
          className="rounded border px-3 py-1 text-xs"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--white)',
            color: 'var(--text)',
          }}
        >
          {t('tools.jwk.validate')}
        </button>
        <button
          type="button"
          onClick={toPem}
          className="rounded px-3 py-1 text-xs font-medium text-white"
          style={{ background: 'var(--accent)' }}
        >
          {t('tools.jwk.toPem')}
        </button>
      </div>
    </Pane>
  )

  const output = (
    <Pane>
      {error ? <ErrorLine text={error} /> : null}
      {/*
       * Validate used to have no success signal at all: on a valid JWK its only
       * effect was to render the same card "Convert to PEM" already showed, so
       * pressing it looked like nothing happened. Say the answer out loud.
       */}
      {verdict ? (
        <div
          role="status"
          className="px-3 pt-3 text-xs font-medium"
          style={{ color: 'var(--green, #1a7a4a)' }}
        >
          {t('tools.jwk.validLine').replace('{n}', String(verdict.count))}
        </div>
      ) : null}
      {keys.length === 0 && !pem && !error ? <Hint text={t('tools.jwk.hintToPem')} /> : null}
      <div className="space-y-3 p-3">
        {keys.map((k, i) => (
          <JwkCard key={i} jwk={k} onAdd={() => onAdd(k, 'pasted')} />
        ))}
        {pem ? (
          <PemBlock
            title={pem.kind === 'private' ? t('tools.jwk.privatePem') : t('tools.jwk.publicPem')}
            pem={pem.pem}
            secret={pem.kind === 'private'}
          />
        ) : null}
      </div>
    </Pane>
  )

  return { input, output }
}
