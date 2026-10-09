import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import {
  MOCK_MCP_ELICIT_FIELD_TYPES,
  type MockMcpElicitDraft,
  type MockMcpElicitFieldRow,
  type MockMcpElicitFieldType,
} from '../../types/mock-mcp'
import { blankElicitDraft, blankElicitRow, duplicateElicitField } from './mock-mcp-elicit'
import { Checkbox, Field, GhostButton, INPUT_CLS, SectionLabel, SELECT_CLS } from './ui'

const CELL_CLS = `${INPUT_CLS} h-7`

/**
 * A property the table cannot edit (array, non-string enum, …): its type and
 * schema are shown read-only and saved back verbatim (issue #154).
 */
function UnsupportedCells({ row, label }: { row: MockMcpElicitFieldRow; label: string }) {
  const json = JSON.stringify(row.raw ?? {})
  return (
    <>
      <span
        data-testid="mock-mcp-tool-elicit-field-unsupported"
        className="truncate text-[11px] text-[var(--orange)]"
      >
        {label}
      </span>
      <code
        data-testid="mock-mcp-tool-elicit-field-raw"
        title={json}
        className="truncate font-mono text-[11px] text-[var(--muted)]"
      >
        {json}
      </code>
    </>
  )
}

/**
 * Optional per-tool elicitation (issue #152): on 2026-07-28 the first call
 * answers `input_required` asking `message` with the fields below; the
 * retry's answer is `{{input.<field>}}` in the response template. 2025-era
 * clients get a text note instead.
 */
export default function MockMcpElicitSection({
  value,
  onChange,
}: {
  value: MockMcpElicitDraft | undefined
  onChange: (next: MockMcpElicitDraft | undefined) => void
}) {
  const { t } = useTranslation()
  const set = (patch: Partial<MockMcpElicitDraft>): void => {
    if (value) onChange({ ...value, ...patch })
  }
  const setRow = (id: string, patch: Partial<MockMcpElicitFieldRow>): void =>
    set({ fields: (value?.fields ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  const duplicate = value ? duplicateElicitField(value) : null

  return (
    <div data-testid="mock-mcp-tool-elicit" className="flex flex-col gap-2">
      <SectionLabel>{t('mockMcp.elicit.title')}</SectionLabel>
      <Checkbox
        testId="mock-mcp-tool-elicit-enabled"
        checked={!!value}
        onChange={(on) => onChange(on ? blankElicitDraft() : undefined)}
        label={t('mockMcp.elicit.enable')}
      />
      <div
        title={t('mockMcp.elicit.hintTooltip')}
        className="cursor-help text-[11px] text-[var(--hint)]"
      >
        {t('mockMcp.elicit.hint')}
      </div>
      {value && (
        <>
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <Field label={t('mockMcp.elicit.key')}>
              <input
                data-testid="mock-mcp-tool-elicit-key"
                value={value.key}
                onChange={(e) => set({ key: e.target.value })}
                className={`${INPUT_CLS} font-mono`}
              />
            </Field>
            <Field label={t('mockMcp.elicit.message')}>
              <input
                data-testid="mock-mcp-tool-elicit-message"
                value={value.message}
                onChange={(e) => set({ message: e.target.value })}
                className={INPUT_CLS}
              />
            </Field>
          </div>
          <div className="overflow-hidden rounded-md border border-[var(--border)]">
            <div className="grid grid-cols-[1fr_120px_1fr_72px_28px] gap-2 bg-[var(--surface)] px-2 py-1 text-[11px] font-medium text-[var(--muted)]">
              <span>{t('mockMcp.elicit.fieldName')}</span>
              <span>{t('mockMcp.elicit.fieldType')}</span>
              <span>{t('mockMcp.elicit.enumValues')}</span>
              <span>{t('mockMcp.elicit.required')}</span>
              <span />
            </div>
            {value.fields.map((row, i) => (
              <div
                key={row.id}
                data-testid={`mock-mcp-tool-elicit-row-${i}`}
                className="grid grid-cols-[1fr_120px_1fr_72px_28px] items-center gap-2 border-t border-[var(--border)] px-2 py-1"
              >
                <input
                  data-testid="mock-mcp-tool-elicit-field-name"
                  value={row.name}
                  onChange={(e) => setRow(row.id, { name: e.target.value })}
                  className={`${CELL_CLS} font-mono`}
                />
                {row.type === 'unsupported' ? (
                  <UnsupportedCells row={row} label={t('mockMcp.elicit.unsupported')} />
                ) : (
                  <>
                    <select
                      data-testid="mock-mcp-tool-elicit-field-type"
                      value={row.type}
                      onChange={(e) =>
                        setRow(row.id, { type: e.target.value as MockMcpElicitFieldType })
                      }
                      className={SELECT_CLS}
                    >
                      {MOCK_MCP_ELICIT_FIELD_TYPES.map((ft) => (
                        <option key={ft} value={ft}>
                          {ft}
                        </option>
                      ))}
                    </select>
                    <input
                      data-testid="mock-mcp-tool-elicit-field-enum"
                      value={row.enumText}
                      disabled={row.type !== 'enum'}
                      placeholder={row.type === 'enum' ? 'low, normal, high' : ''}
                      onChange={(e) => setRow(row.id, { enumText: e.target.value })}
                      className={`${CELL_CLS} disabled:opacity-40`}
                    />
                  </>
                )}
                <input
                  type="checkbox"
                  data-testid="mock-mcp-tool-elicit-field-required"
                  checked={row.required}
                  onChange={(e) => setRow(row.id, { required: e.target.checked })}
                  className="justify-self-center"
                />
                <button
                  type="button"
                  aria-label={t('mockMcp.elicit.removeField')}
                  onClick={() => set({ fields: value.fields.filter((r) => r.id !== row.id) })}
                  className="flex cursor-pointer items-center justify-center border-none bg-transparent text-[var(--muted)] hover:text-[var(--red)]"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          {duplicate && (
            <div
              data-testid="mock-mcp-tool-elicit-duplicate"
              className="text-[11px] text-[var(--red)]"
            >
              {t('mockMcp.elicit.duplicate').replace('{name}', duplicate)}
            </div>
          )}
          <div>
            <GhostButton
              data-testid="mock-mcp-tool-elicit-add-field"
              onClick={() => set({ fields: [...value.fields, blankElicitRow()] })}
            >
              <Plus size={12} />
              {t('mockMcp.elicit.addField')}
            </GhostButton>
          </div>
          <Field label={t('mockMcp.elicit.responseTemplate')}>
            <input
              data-testid="mock-mcp-tool-elicit-template"
              value={value.responseTemplate}
              placeholder="Hello, {{input.name}}!"
              onChange={(e) => set({ responseTemplate: e.target.value })}
              className={`${INPUT_CLS} font-mono`}
            />
          </Field>
          <div className="text-[11px] text-[var(--hint)]">{t('mockMcp.elicit.templateHint')}</div>
        </>
      )}
    </div>
  )
}
