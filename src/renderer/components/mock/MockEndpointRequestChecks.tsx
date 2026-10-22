/**
 * The endpoint's request checks — "Auth override" and "JSON schema
 * validation" — per server kind (PM review 1.6.0 #17).
 *
 * The engine applies both on EVERY kind (`src/main/mock/server.ts`: auth
 * check, then schema check, before the response; it never reads the kind),
 * so they are not removed for SSE / AI servers — an AI mock can demand its
 * own key per endpoint, and an SSE endpoint can be a POST with a body. But
 * on those kinds they are rarely wanted and two empty JSON boxes above the
 * stream / reply settings read as "HTTP leftovers". So:
 *
 *  - HTTP: shown as before.
 *  - SSE / AI with neither set: one small "Request checks" link that opens
 *    them (closed by default).
 *  - SSE / AI with either set: shown, like HTTP — a rule the engine enforces
 *    is never hidden (a server whose type changed from HTTP keeps its rules).
 */
import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { normalizeMockServerKind } from '../../../shared/mock-kind'

/** Whether the two boxes are visible without asking (see the file comment). */
function requestChecksOpenByDefault(kind: unknown, configured: boolean): boolean {
  return normalizeMockServerKind(kind) === 'http' || configured
}

export default function MockEndpointRequestChecks({
  kind,
  configured,
  children,
}: {
  kind: unknown
  /** The endpoint has an auth override or a schema rule. */
  configured: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const id = useId()
  // Starts open when a rule was set at mount: clearing it then does not
  // fold the boxes away under the user's cursor.
  const [open, setOpen] = useState(configured)
  if (requestChecksOpenByDefault(kind, configured)) return <>{children}</>
  return (
    <div className="mt-3" data-testid="mock-endpoint-request-checks">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        data-testid="mock-endpoint-request-checks-toggle"
        className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[11px] text-[var(--accent-text)] hover:underline"
      >
        <ChevronRight
          size={12}
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-90' : ''}`}
        />
        {t('mock.requestChecks')}
      </button>
      {!open && (
        <p className="m-0 mt-0.5 text-[11px] text-[var(--hint)]">{t('mock.requestChecksHint')}</p>
      )}
      <div id={id} hidden={!open}>
        {open && children}
      </div>
    </div>
  )
}
