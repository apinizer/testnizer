import { useCallback, useState } from 'react'
import ToolShell from '../ToolShell'
import { useTranslation } from '../../../lib/i18n'
import { toast } from '../../../lib/toast'
import { ModePill, describe } from './atoms'
import { nextId, sameJwk, type AddKey, type KeyEntry, type Mode, type ModePanes } from './shared'
import { useFromPemMode } from './use-from-pem'
import { useToPemMode } from './use-to-pem'
import { useGenerateMode } from './use-generate'
import { useSetMode } from './use-set'

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
