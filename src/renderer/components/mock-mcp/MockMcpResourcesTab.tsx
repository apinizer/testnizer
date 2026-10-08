import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import type { MockMcpDraftUpdater, MockMcpResource, MockMcpServerDraft } from '../../types/mock-mcp'
import { Field, GhostButton, INPUT_CLS, SectionLabel } from './ui'
import { ListItem } from './ui-display'

function ResourceForm({
  resource,
  onChange,
  onDelete,
}: {
  resource: MockMcpResource
  onChange: (patch: Partial<MockMcpResource>) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const isTemplate = resource.uriTemplate !== undefined
  return (
    <div data-testid="mock-mcp-resource-form" className="min-w-0 flex-1 overflow-y-auto p-4">
      <div className="flex max-w-[680px] flex-col gap-3">
        <SectionLabel
          right={
            <GhostButton
              data-testid="mock-mcp-resource-delete"
              onClick={onDelete}
              className="text-[var(--red)]"
            >
              <Trash2 size={12} />
              {t('mockMcp.resources.delete')}
            </GhostButton>
          }
        >
          {t('mockMcp.resources.resource')}
        </SectionLabel>
        <Field label={t('mockMcp.resources.kind')}>
          <select
            data-testid="mock-mcp-resource-kind"
            value={isTemplate ? 'template' : 'static'}
            onChange={(e) => {
              const current = resource.uri ?? resource.uriTemplate ?? ''
              onChange(
                e.target.value === 'template'
                  ? { uri: undefined, uriTemplate: current }
                  : { uri: current, uriTemplate: undefined },
              )
            }}
            className={INPUT_CLS}
          >
            <option value="static">{t('mockMcp.resources.static')}</option>
            <option value="template">{t('mockMcp.resources.template')}</option>
          </select>
        </Field>
        <Field label={isTemplate ? t('mockMcp.resources.uriTemplate') : t('mockMcp.resources.uri')}>
          <input
            data-testid="mock-mcp-resource-uri"
            value={(isTemplate ? resource.uriTemplate : resource.uri) ?? ''}
            placeholder={isTemplate ? 'mock://users/{id}' : 'mock://readme'}
            onChange={(e) =>
              onChange(isTemplate ? { uriTemplate: e.target.value } : { uri: e.target.value })
            }
            className={`${INPUT_CLS} font-mono`}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('mockMcp.resources.name')}>
            <input
              data-testid="mock-mcp-resource-name"
              value={resource.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className={INPUT_CLS}
            />
          </Field>
          <Field label={t('mockMcp.resources.mimeType')}>
            <input
              data-testid="mock-mcp-resource-mime"
              value={resource.mimeType ?? ''}
              placeholder="text/plain"
              onChange={(e) => onChange({ mimeType: e.target.value })}
              className={INPUT_CLS}
            />
          </Field>
        </div>
        <Field label={t('mockMcp.resources.description')}>
          <input
            value={resource.description ?? ''}
            onChange={(e) => onChange({ description: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>
        <Field label={t('mockMcp.resources.text')}>
          <textarea
            data-testid="mock-mcp-resource-text"
            value={resource.text ?? ''}
            rows={10}
            onChange={(e) => onChange({ text: e.target.value })}
            className={`${INPUT_CLS} h-auto py-1 font-mono`}
          />
        </Field>
        {isTemplate && (
          <div className="text-[11px] text-[var(--hint)]">
            {t('mockMcp.resources.templateHint')}
          </div>
        )}
      </div>
    </div>
  )
}

/** Resources: static URIs and RFC 6570 `{var}` templates with text bodies. */
export default function MockMcpResourcesTab({
  draft,
  change,
}: {
  draft: MockMcpServerDraft
  change: MockMcpDraftUpdater
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, draft.resources.length - 1)
  const resource = index >= 0 ? draft.resources[index] : undefined

  const add = (): void => {
    const n = draft.resources.length + 1
    const res: MockMcpResource = {
      uri: `mock://resource-${n}`,
      name: `resource-${n}`,
      mimeType: 'text/plain',
      text: '',
    }
    change((d) => ({ ...d, resources: [...d.resources, res] }))
    setSelected(draft.resources.length)
  }
  const patchAt = (i: number, patch: Partial<MockMcpResource>): void =>
    change((d) => ({
      ...d,
      resources: d.resources.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    }))

  return (
    <div data-testid="mock-mcp-resources" className="flex min-h-0 flex-1">
      <div className="flex w-[220px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--white)]">
        <div className="border-b border-[var(--border)] p-2">
          <GhostButton
            data-testid="mock-mcp-resource-add"
            onClick={add}
            className="w-full justify-center"
          >
            <Plus size={12} />
            {t('mockMcp.resources.add')}
          </GhostButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {draft.resources.length === 0 && (
            <div className="p-3 text-[12px] text-[var(--hint)]">{t('mockMcp.resources.empty')}</div>
          )}
          {draft.resources.map((r, i) => (
            <ListItem key={i} active={i === index} onClick={() => setSelected(i)}>
              <span className="truncate font-mono">{r.uri ?? r.uriTemplate ?? r.name}</span>
            </ListItem>
          ))}
        </div>
      </div>
      {resource ? (
        <ResourceForm
          resource={resource}
          onChange={(patch) => patchAt(index, patch)}
          onDelete={() =>
            change((d) => ({ ...d, resources: d.resources.filter((_, j) => j !== index) }))
          }
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--hint)]">
          {t('mockMcp.resources.selectOrAdd')}
        </div>
      )}
    </div>
  )
}
