/**
 * JWK tool — Build a JWK Set tab. Pure move out of `JwkTool.tsx`; behaviour unchanged.
 */
import { useState } from 'react'
import CopyButton from '../../shared/CopyButton'
import { useTranslation } from '../../../lib/i18n'
import {
  buildPublicJwks,
  isJwksAcceptable,
  isPrivateJwk,
  parseJwkText,
  prettyJwkSet,
} from '../../../lib/tools/jwk'
import { ErrorLine, Field, KindBadge, Pane, INPUT_STYLE } from './atoms'
import { GREEN, RED, type AddKey, type KeyEntry, type ModePanes } from './shared'

// ─────────────────────────────────────────────────────────────────────────────
// JWK Set
// ─────────────────────────────────────────────────────────────────────────────

export function useSetMode(
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
