import { Trash2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import MonacoWrapper from '../shared/MonacoWrapper'
import {
  MOCK_MCP_RESPONSE_KINDS,
  type MockMcpResponseKind,
  type MockMcpToolDraft,
} from '../../types/mock-mcp'
import { parseSchemaText } from './mock-mcp-draft'
import MockMcpErrorModeFields from './MockMcpErrorModeFields'
import MockMcpTemplateHint from './MockMcpTemplateHint'
import { Checkbox, Field, GhostButton, INPUT_CLS, OptionalIntInput, SectionLabel } from './ui'

const KIND_KEYS: Record<MockMcpResponseKind, string> = {
  text: 'mockMcp.tools.kindText',
  json: 'mockMcp.tools.kindJson',
  template: 'mockMcp.tools.kindTemplate',
}

const SCHEMA_PROBLEM_KEYS = {
  json: 'mockMcp.validation.schemaJsonShort',
  notObject: 'mockMcp.validation.schemaNotObjectShort',
  typeObject: 'mockMcp.validation.schemaTypeShort',
} as const

/** One tool: identity, input schema (JSON), canned response, delay, error override. */
export default function MockMcpToolForm({
  tool,
  onChange,
  onDelete,
}: {
  tool: MockMcpToolDraft
  onChange: (fn: (t: MockMcpToolDraft) => MockMcpToolDraft) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const set = (patch: Partial<MockMcpToolDraft>): void => onChange((x) => ({ ...x, ...patch }))
  const setResponse = (patch: Partial<MockMcpToolDraft['response']>): void =>
    onChange((x) => ({ ...x, response: { ...x.response, ...patch } }))
  const schema = parseSchemaText(tool.schemaText)

  return (
    <div data-testid="mock-mcp-tool-form" className="min-w-0 flex-1 overflow-y-auto p-4">
      <div className="flex max-w-[760px] flex-col gap-3">
        <SectionLabel
          right={
            <GhostButton
              data-testid="mock-mcp-tool-delete"
              onClick={onDelete}
              className="text-[var(--red)]"
            >
              <Trash2 size={12} />
              {t('mockMcp.tools.delete')}
            </GhostButton>
          }
        >
          {t('mockMcp.tools.tool')}
        </SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('mockMcp.tools.name')}>
            <input
              data-testid="mock-mcp-tool-name"
              value={tool.name}
              onChange={(e) => set({ name: e.target.value })}
              className={`${INPUT_CLS} font-mono`}
            />
          </Field>
          <Field label={t('mockMcp.tools.title')}>
            <input
              data-testid="mock-mcp-tool-title"
              value={tool.title ?? ''}
              onChange={(e) => set({ title: e.target.value })}
              className={INPUT_CLS}
            />
          </Field>
        </div>
        <Field label={t('mockMcp.tools.description')}>
          <input
            data-testid="mock-mcp-tool-description"
            value={tool.description ?? ''}
            onChange={(e) => set({ description: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>

        <SectionLabel>{t('mockMcp.tools.inputSchema')}</SectionLabel>
        <div className="h-[200px] overflow-hidden rounded-md border border-[var(--border)]">
          <MonacoWrapper
            value={tool.schemaText}
            language="json"
            height="100%"
            onChange={(schemaText) => set({ schemaText })}
          />
        </div>
        {schema.problem && (
          <div data-testid="mock-mcp-tool-schema-error" className="text-[11px] text-[var(--red)]">
            {t(SCHEMA_PROBLEM_KEYS[schema.problem])}
            {schema.detail ? ` — ${schema.detail}` : ''}
          </div>
        )}

        <SectionLabel>{t('mockMcp.tools.response')}</SectionLabel>
        <div className="grid grid-cols-[160px_1fr] items-end gap-3">
          <Field
            label={t('mockMcp.tools.responseKind')}
            hint={tool.response.kind === 'template' ? <MockMcpTemplateHint /> : undefined}
          >
            <select
              data-testid="mock-mcp-tool-response-kind"
              value={tool.response.kind}
              onChange={(e) => setResponse({ kind: e.target.value as MockMcpResponseKind })}
              className={INPUT_CLS}
            >
              {MOCK_MCP_RESPONSE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(KIND_KEYS[k])}
                </option>
              ))}
            </select>
          </Field>
          <div className="pb-1 text-[11px] text-[var(--hint)]">
            {tool.response.kind === 'json'
              ? t('mockMcp.tools.kindJsonHint')
              : tool.response.kind === 'template'
                ? t('mockMcp.tools.kindTemplateHint')
                : t('mockMcp.tools.kindTextHint')}
          </div>
        </div>
        <div className="h-[140px] overflow-hidden rounded-md border border-[var(--border)]">
          <MonacoWrapper
            value={tool.response.body}
            language={tool.response.kind === 'json' ? 'json' : 'plaintext'}
            height="100%"
            onChange={(body) => setResponse({ body })}
          />
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          <Checkbox
            testId="mock-mcp-tool-is-error"
            checked={!!tool.response.isError}
            onChange={(isError) => setResponse({ isError })}
            label={t('mockMcp.tools.isError')}
          />
          <Field label={t('mockMcp.tools.delayMs')}>
            <OptionalIntInput
              testId="mock-mcp-tool-delay"
              value={tool.delayMs}
              min={0}
              max={600000}
              placeholder="0"
              onChange={(delayMs) => set({ delayMs })}
            />
          </Field>
        </div>

        <SectionLabel>{t('mockMcp.tools.errorOverride')}</SectionLabel>
        <MockMcpErrorModeFields
          allowInherit
          testIdPrefix="mock-mcp-tool-error"
          value={tool.error}
          onChange={(error) => set({ error })}
        />
      </div>
    </div>
  )
}
