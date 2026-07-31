import { useCallback, useId, useState, type ReactNode } from 'react'
import ToolShell from './ToolShell'
import KeyMaterialField from '../shared/KeyMaterialField'
import CopyButton from '../shared/CopyButton'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { useInvalidateOn } from '../../lib/use-stale-guard'
import type { MaterialSource } from '../../types'
import { stripSourceSecrets } from '../../lib/key-material'
import {
  JWK_ALGORITHMS,
  buildPublicJwks,
  generateJwkPair,
  isJwksAcceptable,
  isPrivateJwk,
  jwkToPem,
  parseJwkText,
  pemToJwk,
  prettyJwk,
  prettyJwkSet,
  summarizeJwk,
  toPublicJwk,
  type Jwk,
  type JwkSummary,
} from '../../lib/tools/jwk'

/**
 * Tools → JWK (#61, Faz D1).
 *
 * ── ADDITIVE ────────────────────────────────────────────────────────────────
 *
 * Pasting is the DEFAULT and the only path that runs by itself: every
 * conversion here is pure renderer code (`lib/tools/jwk.ts`) operating on text
 * the user supplied — their own PEM, their own JWK — and nothing crosses IPC.
 * "Use from keystore / Security" is ONE added button. When it is used MAIN
 * resolves the opaque `MaterialSource` and returns a PUBLIC JWK document; the
 * renderer never receives (and this component never asks for) a private half.
 *
 * ── PUBLIC / PRIVATE IS ALWAYS VISIBLE ──────────────────────────────────────
 *
 * Every rendered key carries a badge, and a private one is additionally framed
 * in red with an explicit "never publish this" line. The "Copy public JWKS"
 * affordance runs `buildPublicJwks`, which strips every private member and
 * refuses symmetric keys — the same rules `src/main/lib/jwks.ts` applies to a
 * document that will really be served.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 *
 * Each tab is a hook returning the two `ToolShell` panes (controls left, result
 * right). All four run every render — that is what keeps the hook order stable
 * while only one tab's panes are mounted.
 */

type Mode = 'fromPem' | 'toPem' | 'generate' | 'set'

type Origin = 'pasted' | 'generated' | 'keystore'

interface KeyEntry {
  id: string
  jwk: Jwk
  origin: Origin
  label: string
}

interface ModePanes {
  input: ReactNode
  output: ReactNode
}

type AddKey = (jwk: Jwk, origin: Origin) => void

const RED = '#cc2200'
const GREEN = '#1a7a4a'

let entrySeq = 0
function nextId(): string {
  entrySeq += 1
  return `jwk-${entrySeq}`
}

/**
 * Are these the same key?
 *
 * Compared on canonical JSON — key order in a JWK carries no meaning, so two
 * documents that differ only in field order describe one key and must not both
 * end up in the set.
 */
function sameJwk(a: Jwk, b: Jwk): boolean {
  const canon = (j: Jwk): string =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(j as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1)),
      ),
    )
  return canon(a) === canon(b)
}

const SAMPLE_JWK = `{
  "kty": "EC",
  "crv": "P-256",
  "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
  "alg": "ES256"
}`

export default function JwkTool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('fromPem')
  const [entries, setEntries] = useState<KeyEntry[]>([])

  /*
   * "Add to set" used to append in silence, from a tab that does not show the
   * set — so pressing it changed nothing the user could see, and pressing it
   * twice produced two identical members of a JWKS with no hint that anything
   * was wrong. Both are answered here: the same key is recognised and reported
   * instead of duplicated, and every outcome says what happened.
   */
  const addKey = useCallback<AddKey>(
    (jwk, origin) => {
      setEntries((list) => {
        if (list.some((e) => sameJwk(e.jwk, jwk))) {
          toast.info(t('tools.jwk.alreadyInSet').replace('{name}', describe(jwk)))
          return list
        }
        const next = [...list, { id: nextId(), jwk, origin, label: describe(jwk) }]
        toast.success(
          t('tools.jwk.addedToSet')
            .replace('{name}', describe(jwk))
            .replace('{n}', String(next.length)),
        )
        return next
      })
    },
    [t],
  )

  const fromPem = useFromPemMode(addKey)
  const toPem = useToPemMode(addKey)
  const generate = useGenerateMode(addKey)
  const set = useSetMode(entries, setEntries, addKey)

  const panes: ModePanes =
    mode === 'fromPem' ? fromPem : mode === 'toPem' ? toPem : mode === 'generate' ? generate : set

  return (
    <ToolShell
      title={t('tools.jwk.title')}
      toolbar={
        <div
          className="flex items-center rounded-full p-0.5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <ModePill active={mode === 'fromPem'} onClick={() => setMode('fromPem')}>
            {t('tools.jwk.tabFromPem')}
          </ModePill>
          <ModePill active={mode === 'toPem'} onClick={() => setMode('toPem')}>
            {t('tools.jwk.tabToPem')}
          </ModePill>
          <ModePill active={mode === 'generate'} onClick={() => setMode('generate')}>
            {t('tools.jwk.tabGenerate')}
          </ModePill>
          <ModePill active={mode === 'set'} onClick={() => setMode('set')}>
            {`${t('tools.jwk.tabSet')} (${entries.length})`}
          </ModePill>
        </div>
      }
      inputPane={panes.input}
      outputPane={panes.output}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PEM → JWK
// ─────────────────────────────────────────────────────────────────────────────

function useFromPemMode(onAdd: AddKey): ModePanes {
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

// ─────────────────────────────────────────────────────────────────────────────
// JWK → PEM (also the validate / pretty-print surface)
// ─────────────────────────────────────────────────────────────────────────────

function useToPemMode(onAdd: AddKey): ModePanes {
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

// ─────────────────────────────────────────────────────────────────────────────
// Generate
// ─────────────────────────────────────────────────────────────────────────────

function useGenerateMode(onAdd: AddKey): ModePanes {
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

// ─────────────────────────────────────────────────────────────────────────────
// JWK Set
// ─────────────────────────────────────────────────────────────────────────────

function useSetMode(
  entries: KeyEntry[],
  setEntries: React.Dispatch<React.SetStateAction<KeyEntry[]>>,
  onAdd: AddKey,
): ModePanes {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  function addPasted(): void {
    const parsed = parseJwkText(text)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    for (const key of parsed.value.keys) onAdd(key, 'pasted')
    setText('')
  }

  const built = buildPublicJwks(entries.map((e) => e.jwk))
  const body = prettyJwkSet(built.jwks)
  const acceptable = isJwksAcceptable(built.jwks)

  const input = (
    <Pane>
      <Field label={t('tools.jwk.jwkInput')}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
          aria-label={t('tools.jwk.jwkInput')}
          placeholder={t('tools.jwk.pasteJwk')}
          className="w-full rounded border px-2 py-1 font-mono text-xs"
          style={INPUT_STYLE}
        />
      </Field>
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={addPasted}
          disabled={text.trim() === ''}
          className="rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {t('tools.jwk.addKeys')}
        </button>
      </div>

      {error ? <ErrorLine text={error} /> : null}

      <div className="border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
        {entries.length === 0 ? (
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {t('tools.jwk.setEmpty')}
          </div>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                style={{
                  borderColor: isPrivateJwk(entry.jwk) ? RED : 'var(--border)',
                  background: 'var(--white)',
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <KindBadge secret={isPrivateJwk(entry.jwk)} />
                  <span className="truncate font-mono text-[11px]" style={{ color: 'var(--text)' }}>
                    {entry.label}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--hint)' }}>
                    {t(`tools.jwk.origin.${entry.origin}`)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setEntries((list) => list.filter((e) => e.id !== entry.id))}
                  className="rounded border px-1.5 py-0.5 text-[11px]"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--white)',
                    color: 'var(--muted)',
                  }}
                  title={t('tools.jwk.remove')}
                  aria-label={`${t('tools.jwk.remove')} ${entry.label}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Pane>
  )

  const output = (
    <Pane>
      <div
        className="flex flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <span
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--muted)' }}
        >
          {t('tools.jwk.publicJwks')}
        </span>
        <KindBadge secret={false} />
        <CopyButton
          text={body}
          label={t('tools.jwk.copyJwks')}
          ariaLabel={t('tools.jwk.copyJwks')}
        />
      </div>

      <div className="space-y-1 px-3 py-2 text-[11px]" style={{ color: 'var(--muted)' }}>
        <div>{t('tools.jwk.setKeys').replace('{n}', String(built.jwks.keys.length))}</div>
        {built.stripped > 0 ? (
          <div style={{ color: GREEN }}>
            {t('tools.jwk.stripped').replace('{n}', String(built.stripped))}
          </div>
        ) : null}
        {built.omittedOct > 0 ? (
          <div style={{ color: RED }}>
            {t('tools.jwk.omittedOct').replace('{n}', String(built.omittedOct))}
          </div>
        ) : null}
        {built.deduped > 0 ? (
          <div>{t('tools.jwk.deduped').replace('{n}', String(built.deduped))}</div>
        ) : null}
        <div style={{ color: acceptable.ok ? GREEN : RED }}>
          {acceptable.ok ? t('tools.jwk.acceptable') : t('tools.jwk.notAcceptable')}
        </div>
      </div>

      <pre
        className="m-0 flex-1 overflow-auto px-3 pb-3 font-mono text-xs whitespace-pre-wrap break-all"
        style={{ color: 'var(--text)' }}
        data-testid="jwks-body"
      >
        {body}
      </pre>
    </Pane>
  )

  return { input, output }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared atoms
// ─────────────────────────────────────────────────────────────────────────────

const INPUT_STYLE = {
  background: 'var(--white)',
  borderColor: 'var(--border)',
  color: 'var(--text)',
} as const

/** Short, human label for a key — thumbprint first, then what it is. */
function describe(jwk: Jwk): string {
  const s: JwkSummary = summarizeJwk(jwk)
  const size = s.crv ?? (s.bits ? `${s.bits}-bit` : '')
  return [s.kid ?? '(no kid)', s.kty, size, s.alg].filter(Boolean).join(' · ')
}

function Pane({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col overflow-auto">{children}</div>
}

function Hint({ text }: { text: string }) {
  return (
    <div className="p-4 text-xs" style={{ color: 'var(--muted)' }}>
      {text}
    </div>
  )
}

function JwkCard({
  jwk,
  title,
  note,
  onAdd,
}: {
  jwk: Jwk
  title?: string
  note?: string
  onAdd?: () => void
}) {
  const { t } = useTranslation()
  const secret = isPrivateJwk(jwk)
  const summary = summarizeJwk(jwk)
  const json = prettyJwk(jwk)
  const publicJson = prettyJwk(toPublicJwk(jwk))

  return (
    <div
      className="rounded border"
      style={{ borderColor: secret ? RED : 'var(--border)', background: 'var(--white)' }}
      data-testid={secret ? 'jwk-card-private' : 'jwk-card-public'}
    >
      <div
        className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <KindBadge secret={secret} />
        {title ? (
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
            {title}
          </span>
        ) : null}
        <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
          {summary.kty}
          {summary.crv ? ` · ${summary.crv}` : summary.bits ? ` · ${summary.bits}-bit` : ''}
          {summary.alg ? ` · ${summary.alg}` : ''}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {/*
           * The accessible name has to say WHICH half this copies. On a private
           * card the generic "Copy" sat right next to "Copy public half" and put
           * the private key on the clipboard without saying so.
           */}
          <CopyButton
            text={json}
            label={t('tools.common.copy')}
            ariaLabel={secret ? t('tools.jwk.copyPrivateJwk') : t('tools.jwk.copyPublicJwk')}
          />
          {secret ? (
            <CopyButton
              text={publicJson}
              label={t('tools.jwk.copyPublic')}
              ariaLabel={t('tools.jwk.copyPublicJwk')}
            />
          ) : null}
          {onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="rounded border px-1.5 py-0.5 text-[11px]"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--white)',
                color: 'var(--accent-text)',
              }}
            >
              {t('tools.jwk.addToSet')}
            </button>
          ) : null}
        </span>
      </div>

      {summary.kid ? (
        <div className="px-2 pt-1.5 text-[11px]" style={{ color: 'var(--muted)' }}>
          {`${t('tools.jwk.kid')}: `}
          <span className="font-mono" style={{ color: 'var(--text)' }}>
            {summary.kid}
          </span>
        </div>
      ) : null}

      {secret ? (
        <div className="px-2 pt-1.5 text-[11px]" style={{ color: RED }}>
          {t('tools.jwk.privateWarning')}
        </div>
      ) : null}
      {note ? (
        <div className="px-2 pt-1.5 text-[11px]" style={{ color: GREEN }}>
          {note}
        </div>
      ) : null}

      <pre
        className="m-0 max-h-64 overflow-auto px-2 py-2 font-mono text-xs whitespace-pre-wrap break-all"
        style={{ color: 'var(--text)' }}
      >
        {json}
      </pre>
    </div>
  )
}

function PemBlock({ title, pem, secret }: { title: string; pem: string; secret: boolean }) {
  const { t } = useTranslation()
  return (
    <div
      className="rounded border"
      style={{ borderColor: secret ? RED : 'var(--border)', background: 'var(--white)' }}
    >
      <div
        className="flex items-center gap-2 border-b px-2 py-1.5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <KindBadge secret={secret} />
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
          {title}
        </span>
        <span className="ml-auto">
          <CopyButton
            text={pem}
            label={t('tools.common.copy')}
            ariaLabel={t('tools.jwk.copyPem')}
          />
        </span>
      </div>
      <pre
        className="m-0 max-h-56 overflow-auto px-2 py-2 font-mono text-xs whitespace-pre-wrap break-all"
        style={{ color: 'var(--text)' }}
      >
        {pem}
      </pre>
    </div>
  )
}

function KindBadge({ secret }: { secret: boolean }) {
  const { t } = useTranslation()
  const color = secret ? RED : GREEN
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: `${color}15`, color, border: `1px solid ${color}40` }}
    >
      {secret ? t('tools.jwk.privateBadge') : t('tools.jwk.publicBadge')}
    </span>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-3 pt-3 pb-2">
      <div
        className="mb-1 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function ErrorLine({ text }: { text: string }) {
  return (
    <div className="px-3 py-2 text-[11px]" style={{ color: RED }} role="alert">
      {text}
    </div>
  )
}

function ModePill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1 text-xs font-semibold"
      style={{
        background: active ? 'var(--white)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--muted)',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
      }}
    >
      {children}
    </button>
  )
}
