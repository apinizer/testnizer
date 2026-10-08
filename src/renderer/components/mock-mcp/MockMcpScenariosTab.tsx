import { KeyRound } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import type { MockMcpAuthMode, MockMcpDraftUpdater, MockMcpServerDraft } from '../../types/mock-mcp'
import { generateBearerToken } from './mock-mcp-draft'
import MockMcpErrorModeFields from './MockMcpErrorModeFields'
import { Field, GhostButton, INPUT_CLS, IntInput, SectionLabel, SELECT_CLS } from './ui'

/** Scenarios: bearer auth, latency and server-wide error injection. All hot-reload. */
export default function MockMcpScenariosTab({
  draft,
  change,
}: {
  draft: MockMcpServerDraft
  change: MockMcpDraftUpdater
}) {
  const { t } = useTranslation()
  const set = (patch: Partial<MockMcpServerDraft>): void => change((d) => ({ ...d, ...patch }))

  return (
    <div data-testid="mock-mcp-scenarios" className="flex-1 overflow-y-auto p-4">
      <div className="flex max-w-[640px] flex-col gap-3">
        <SectionLabel>{t('mockMcp.scenarios.auth')}</SectionLabel>
        <Field label={t('mockMcp.scenarios.authMode')}>
          <select
            data-testid="mock-mcp-auth-mode"
            value={draft.authMode}
            onChange={(e) => {
              const authMode = e.target.value as MockMcpAuthMode
              // Switching to bearer with no token yet: generate one so the
              // server is immediately usable (an empty token rejects everyone).
              const bearerToken =
                authMode === 'bearer' && !draft.bearerToken
                  ? generateBearerToken()
                  : draft.bearerToken
              set({ authMode, bearerToken })
            }}
            className={SELECT_CLS}
          >
            <option value="none">{t('mockMcp.scenarios.authNone')}</option>
            <option value="bearer">{t('mockMcp.scenarios.authBearer')}</option>
          </select>
        </Field>
        {draft.authMode === 'bearer' && (
          <>
            <Field label={t('mockMcp.scenarios.token')}>
              <div className="flex gap-2">
                <input
                  data-testid="mock-mcp-bearer-token"
                  value={draft.bearerToken}
                  onChange={(e) => set({ bearerToken: e.target.value })}
                  className={`${INPUT_CLS} font-mono`}
                />
                <GhostButton
                  data-testid="mock-mcp-generate-token"
                  onClick={() => set({ bearerToken: generateBearerToken() })}
                >
                  <KeyRound size={12} />
                  {t('mockMcp.scenarios.generate')}
                </GhostButton>
              </div>
            </Field>
            <div className="text-[11px] text-[var(--hint)]">{t('mockMcp.scenarios.authHint')}</div>
          </>
        )}

        <SectionLabel>{t('mockMcp.scenarios.latency')}</SectionLabel>
        <Field label={t('mockMcp.scenarios.latencyMs')}>
          <IntInput
            testId="mock-mcp-latency"
            value={draft.latencyMs}
            min={0}
            max={600000}
            onChange={(latencyMs) => set({ latencyMs })}
          />
        </Field>
        <div className="text-[11px] text-[var(--hint)]">{t('mockMcp.scenarios.latencyHint')}</div>

        <SectionLabel>{t('mockMcp.scenarios.errors')}</SectionLabel>
        <MockMcpErrorModeFields
          testIdPrefix="mock-mcp-error"
          value={draft.errorMode}
          onChange={(mode) => set({ errorMode: mode ?? { kind: 'none' } })}
        />
      </div>
    </div>
  )
}
