import { Info } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { MCP_AUTH_TYPES } from '../../../stores/mcp-auth.slice'
import type { McpAuthType } from '../../../types/mcp'
import { useTranslation } from '../../../lib/i18n'
import McpOAuthSection from './McpOAuthSection'
import { McpApiKeyAuthFields, McpBasicAuthFields, McpBearerAuthFields } from './McpAuthFields'
import { sentAsPreview } from './config-ui'

const TYPE_KEYS: Record<McpAuthType, string> = {
  none: 'mcp.auth.type.none',
  basic: 'mcp.auth.type.basic',
  bearer: 'mcp.auth.type.bearer',
  'api-key': 'mcp.auth.type.apiKey',
  oauth2: 'mcp.auth.type.oauth2',
}

const DESC_KEYS: Record<McpAuthType, string> = {
  none: 'mcp.auth.desc.none',
  basic: 'mcp.auth.desc.basic',
  bearer: 'mcp.auth.desc.bearer',
  'api-key': 'mcp.auth.desc.apiKey',
  oauth2: 'mcp.auth.desc.oauth2',
}

/**
 * Authorization panel of the MCP config tab strip — Postman's MCP
 * "Authorization" tab: No Auth, Basic, Bearer, API Key, or the OAuth 2.1
 * debugger inline. Values may hold `{{var}}` (resolved at Connect); main
 * builds the header / query param unless a custom header row of the same
 * name is set (that row wins, as in HTTP), and an OAuth session token wins
 * over both. stdio has no HTTP layer — a note says
 * so and nothing is sent.
 */
export default function McpAuthSection() {
  const { t } = useTranslation()
  const auth = useMcpStore((s) => s.auth)
  const setAuth = useMcpStore((s) => s.setAuth)
  const transport = useMcpStore((s) => s.transport)
  const isStdio = transport === 'stdio'
  const preview = sentAsPreview(auth)

  return (
    <div
      data-testid="mcp-auth-section"
      className="flex flex-col gap-3 md:grid md:grid-cols-[220px_minmax(0,1fr)] md:gap-5"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="flex flex-col gap-1 text-[11px] text-[var(--muted)]">
          {t('mcp.auth.type')}
          <select
            value={auth.type}
            onChange={(e) => setAuth({ ...auth, type: e.target.value as McpAuthType })}
            data-testid="mcp-auth-type"
            className="h-8 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            {MCP_AUTH_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(TYPE_KEYS[type])}
              </option>
            ))}
          </select>
        </label>
        {auth.type !== 'none' && (
          <p data-testid="mcp-auth-description" className="m-0 text-[12px] text-[var(--muted)]">
            {t(DESC_KEYS[auth.type])}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        {isStdio ? (
          <div
            data-testid="mcp-auth-stdio-note"
            className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[12px] text-[var(--text)]"
          >
            <Info size={14} className="mt-px shrink-0 text-[var(--muted)]" />
            {t('mcp.auth.stdio')}
          </div>
        ) : (
          <>
            {auth.type === 'none' && (
              <div
                data-testid="mcp-auth-none"
                className="flex min-h-12 items-center text-[12px] text-[var(--hint)]"
              >
                {t('mcp.auth.desc.none')}
              </div>
            )}
            {auth.type === 'basic' && <McpBasicAuthFields auth={auth} onChange={setAuth} />}
            {auth.type === 'bearer' && <McpBearerAuthFields auth={auth} onChange={setAuth} />}
            {auth.type === 'api-key' && <McpApiKeyAuthFields auth={auth} onChange={setAuth} />}
            {auth.type === 'oauth2' && <McpOAuthSection embedded />}
            {preview && (
              <div data-testid="mcp-auth-preview" className="text-[11px] text-[var(--hint)]">
                {t('mcp.auth.sentAs')}:{' '}
                <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[var(--text)]">
                  {preview}
                </code>{' '}
                {t('mcp.auth.precedence')}
              </div>
            )}
            {auth.type === 'api-key' && auth.apiKey?.in === 'query' && transport === 'sse' && (
              <p data-testid="mcp-auth-sse-query" className="m-0 text-[11px] text-[var(--hint)]">
                {t('mcp.auth.sseQuery')}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
