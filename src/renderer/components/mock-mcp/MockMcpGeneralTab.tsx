import { useTranslation } from '../../lib/i18n'
import {
  MOCK_MCP_LEGACY_MODES,
  MOCK_MCP_MODERN_VERSION,
  MOCK_MCP_PROTOCOL_VERSIONS,
  type MockMcpDraftUpdater,
  type MockMcpLegacyMode,
  type MockMcpServerDraft,
} from '../../types/mock-mcp'
import { Checkbox, Field, INPUT_CLS, IntInput, SectionLabel, SELECT_CLS } from './ui'

const LEGACY_MODE_KEYS: Record<MockMcpLegacyMode, string> = {
  stateless: 'mockMcp.general.legacyStateless',
  reject: 'mockMcp.general.legacyReject',
}

/** Upper bound of the cache TTL (the backend's `MAX_CACHE_TTL_MS`, one day). */
const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** General: identity + where the server listens + protocol pin / eras. */
export default function MockMcpGeneralTab({
  draft,
  change,
}: {
  draft: MockMcpServerDraft
  change: MockMcpDraftUpdater
}) {
  const { t } = useTranslation()
  const set = (patch: Partial<MockMcpServerDraft>): void => change((d) => ({ ...d, ...patch }))

  return (
    <div data-testid="mock-mcp-general" className="flex-1 overflow-y-auto p-4">
      <div className="flex max-w-[640px] flex-col gap-3">
        <SectionLabel>{t('mockMcp.general.identity')}</SectionLabel>
        <Field label={t('mockMcp.general.name')}>
          <input
            data-testid="mock-mcp-name"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>
        <Field label={t('mockMcp.general.description')}>
          <textarea
            data-testid="mock-mcp-description"
            value={draft.description}
            rows={2}
            onChange={(e) => set({ description: e.target.value })}
            className={`${INPUT_CLS} h-auto py-1`}
          />
        </Field>

        <SectionLabel>{t('mockMcp.general.listen')}</SectionLabel>
        <div className="grid grid-cols-[1fr_120px_1fr] gap-3">
          <Field label={t('mockMcp.general.host')}>
            <input
              data-testid="mock-mcp-host"
              value={draft.host}
              onChange={(e) => set({ host: e.target.value })}
              className={INPUT_CLS}
            />
          </Field>
          <Field label={t('mockMcp.general.port')}>
            <IntInput
              testId="mock-mcp-port"
              value={draft.port}
              min={0}
              max={65535}
              onChange={(port) => set({ port })}
            />
          </Field>
          <Field label={t('mockMcp.general.path')}>
            <input
              data-testid="mock-mcp-path"
              value={draft.path}
              placeholder="/mcp"
              onChange={(e) => set({ path: e.target.value })}
              className={INPUT_CLS}
            />
          </Field>
        </div>
        <div className="text-[11px] text-[var(--hint)]">{t('mockMcp.general.portHint')}</div>
        <Checkbox
          testId="mock-mcp-legacy-sse"
          checked={draft.legacySse}
          onChange={(legacySse) => set({ legacySse })}
          label={t('mockMcp.general.legacySse')}
        />
        <div className="text-[11px] text-[var(--hint)]">{t('mockMcp.general.restartHint')}</div>

        <SectionLabel>{t('mockMcp.general.protocol')}</SectionLabel>
        <Field label={t('mockMcp.general.protocolPin')}>
          <select
            data-testid="mock-mcp-protocol-pin"
            value={draft.protocolPin ?? ''}
            onChange={(e) => set({ protocolPin: e.target.value || null })}
            className={SELECT_CLS}
          >
            <option value="">{t('mockMcp.general.protocolAny')}</option>
            {MOCK_MCP_PROTOCOL_VERSIONS.map((v) => (
              <option key={v} value={v}>
                {v === MOCK_MCP_MODERN_VERSION ? `${v} ${t('mockMcp.general.modernOnly')}` : v}
              </option>
            ))}
          </select>
        </Field>
        <div className="text-[11px] text-[var(--hint)]">{t('mockMcp.general.protocolHint')}</div>
        <div className="grid grid-cols-[1fr_200px] gap-3">
          <Field label={t('mockMcp.general.legacyMode')}>
            <select
              data-testid="mock-mcp-legacy-mode"
              value={draft.legacyMode}
              onChange={(e) => set({ legacyMode: e.target.value as MockMcpLegacyMode })}
              className={SELECT_CLS}
            >
              {MOCK_MCP_LEGACY_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(LEGACY_MODE_KEYS[m])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('mockMcp.general.cacheTtl')}>
            <IntInput
              testId="mock-mcp-cache-ttl"
              value={draft.cacheTtlMs}
              min={0}
              max={MAX_CACHE_TTL_MS}
              onChange={(cacheTtlMs) => set({ cacheTtlMs })}
            />
          </Field>
        </div>
        <div className="text-[11px] text-[var(--hint)]">
          {draft.legacyMode === 'reject'
            ? t('mockMcp.general.legacyRejectHint')
            : t('mockMcp.general.legacyStatelessHint')}
        </div>
        <div className="text-[11px] text-[var(--hint)]">{t('mockMcp.general.cacheTtlHint')}</div>
      </div>
    </div>
  )
}
