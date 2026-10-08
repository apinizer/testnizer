import { useTranslation } from '../../../lib/i18n'
import { testIdSlug, type McpListItem } from '../../../lib/mcp-store-helpers'

function rowTestId(entry: McpListItem): string {
  switch (entry.kind) {
    case 'tool':
      return `mcp-tool-${entry.key}`
    case 'prompt':
      return `mcp-prompt-${entry.key}`
    case 'resource':
      return `mcp-resource-${testIdSlug(entry.key)}`
    case 'template':
      return `mcp-template-${testIdSlug(entry.key)}`
  }
  return 'mcp-row'
}

function secondary(entry: McpListItem): string | undefined {
  if (entry.kind === 'resource') return entry.item.uri
  if (entry.kind === 'template') return entry.item.uriTemplate
  return undefined
}

interface Props {
  entry: McpListItem
  selected: boolean
  showTemplateHeader: boolean
  onSelect: () => void
}

/** One row of the capability list: title (or name), URI for resources, description. */
export default function McpCapabilityRow({ entry, selected, showTemplateHeader, onSelect }: Props) {
  const { t } = useTranslation()
  const title = entry.item.title || entry.item.name
  const uri = secondary(entry)
  return (
    <>
      {showTemplateHeader && (
        <div className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {t('mcp.list.templates')}
        </div>
      )}
      <button
        type="button"
        data-testid={rowTestId(entry)}
        aria-pressed={selected}
        onClick={onSelect}
        title={entry.item.description}
        className={`block w-full cursor-pointer border-x-0 border-t-0 border-b border-[var(--border)] px-3 py-2 text-left text-[12px] ${
          selected
            ? 'bg-[var(--accent-light)] text-[var(--accent-text)]'
            : 'bg-transparent text-[var(--text)] hover:bg-[var(--item-hover)]'
        }`}
      >
        <div className="truncate font-semibold">{title}</div>
        {uri && <div className="truncate font-mono text-[11px] text-[var(--muted)]">{uri}</div>}
        {entry.item.description && (
          <div className="truncate text-[11px] text-[var(--muted)]">{entry.item.description}</div>
        )}
      </button>
    </>
  )
}
