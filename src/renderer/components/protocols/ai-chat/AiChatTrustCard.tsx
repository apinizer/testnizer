import type { ReactElement } from 'react'
import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import type { AiStdioEnvEntry } from '../../../../shared/ai-chat-types'

/** The env block: every variable with its value (trust covers values), masks and danger flags. */
function EnvRows({ env }: { env: AiStdioEnvEntry[] }): ReactElement {
  const { t } = useTranslation()
  const anyDangerous = env.some((e) => e.dangerous)
  return (
    <div className="flex flex-col gap-1" data-testid="ai-stdio-env">
      <p className="text-[var(--muted)]">
        {t('aiChat.trust.env')} — {t('aiChat.trust.envHint')}
      </p>
      {anyDangerous && (
        <p
          className="flex items-start gap-1 font-medium text-[var(--red)]"
          data-testid="ai-stdio-env-dangerous-warning"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {t('aiChat.trust.dangerousWarning')}
        </p>
      )}
      <ul className="flex flex-col gap-0.5 rounded bg-[var(--bg)] p-2 font-mono">
        {env.map((e) => (
          <li
            key={e.name}
            className="whitespace-pre-wrap break-all text-[var(--text)]"
            data-testid="ai-stdio-env-row"
            data-dangerous={e.dangerous ? 'true' : undefined}
          >
            <span className={e.dangerous ? 'font-semibold text-[var(--red)]' : undefined}>
              {e.name}
            </span>
            =
            {e.masked ? (
              <span className="text-[var(--muted)]" title={t('aiChat.trust.masked')}>
                {e.value}
              </span>
            ) : (
              e.value
            )}
            {e.dangerous && (
              <span
                className="ml-2 rounded border border-[var(--red)] px-1 font-sans text-[10.5px] text-[var(--red)]"
                data-testid="ai-stdio-env-dangerous"
              >
                {t('aiChat.trust.dangerous')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Untrusted stdio MCP server (issue #180): the full command line (credential
 * flag values masked) and its env WITH values — trust covers them
 * (`NODE_OPTIONS=--require …` changes what runs) — credential-named values
 * masked, dangerous names flagged; an explicit "Trust and connect". Only this
 * click records trust; Send never does. Older stored turns carry names only.
 */
export default function AiChatTrustCard({
  commandLine,
  envNames,
  env,
  onTrust,
  onSkip,
  status,
}: {
  commandLine: string
  envNames: string[]
  env?: AiStdioEnvEntry[]
  onTrust?: () => void
  onSkip?: () => void
  status?: 'pending' | 'trusted' | 'skipped'
}): ReactElement {
  const { t } = useTranslation()
  const pending = !status || status === 'pending'
  return (
    <div
      role="alert"
      data-testid="ai-stdio-trust-card"
      className="flex flex-col gap-2 rounded-md border px-3 py-2"
      style={{ borderColor: 'var(--orange)', background: 'var(--surface)', fontSize: 12 }}
    >
      <div className="flex items-center gap-1.5 font-medium text-[var(--orange)]">
        <ShieldAlert size={13} />
        {t('aiChat.trust.title')}
      </div>
      <p className="text-[var(--muted)]">{t('aiChat.trust.hint')}</p>
      <code
        className="block whitespace-pre-wrap break-all rounded bg-[var(--bg)] p-2 font-mono text-[var(--text)]"
        data-testid="ai-stdio-command"
      >
        {commandLine}
      </code>
      {env && env.length > 0 && <EnvRows env={env} />}
      {!env && envNames.length > 0 && (
        <p className="text-[var(--muted)]">
          {t('aiChat.trust.env')}: <span className="font-mono">{envNames.join(', ')}</span>
        </p>
      )}
      {pending ? (
        <div className="flex gap-2">
          {onTrust && (
            <button
              type="button"
              onClick={onTrust}
              data-testid="ai-stdio-trust"
              className="cursor-pointer rounded-md border-none px-3 py-1 font-medium text-white"
              style={{ background: 'var(--orange)' }}
            >
              {t('aiChat.trust.trustAndConnect')}
            </button>
          )}
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              data-testid="ai-stdio-skip"
              className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-1 text-[var(--text)]"
            >
              {t('aiChat.trust.skip')}
            </button>
          )}
        </div>
      ) : (
        <p className="text-[var(--muted)]">
          {status === 'trusted' ? t('aiChat.trust.trusted') : t('aiChat.trust.skipped')}
        </p>
      )}
    </div>
  )
}
