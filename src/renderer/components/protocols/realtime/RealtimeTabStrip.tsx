export interface RealtimeTab<T extends string> {
  id: T
  label: string
  /** Green count badge (enabled header / param rows, listened events). */
  count?: number
  /** Green dot: the tab holds a non-default value (Settings changed). */
  dot?: boolean
}

/**
 * Request tab strip of the WebSocket and Socket.IO editors (issues #282 /
 * #283) — the MCP config strip's anatomy (`mcp/McpConfigTabs.tsx`): base-size
 * labels, 600 active / 400 idle, accent underline, the same count badge and
 * dot. Tab ids become `${testIdPrefix}-tab-${id}`.
 */
export default function RealtimeTabStrip<T extends string>({
  tabs,
  active,
  onSelect,
  testIdPrefix,
}: {
  tabs: readonly RealtimeTab<T>[]
  active: T
  onSelect: (id: T) => void
  testIdPrefix: string
}) {
  return (
    <div role="tablist" className="flex min-w-0 flex-wrap items-center gap-1 px-2">
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`${testIdPrefix}-tab-${tab.id}`}
            onClick={() => onSelect(tab.id)}
            className={`flex cursor-pointer items-center gap-1.5 border-x-0 border-t-0 border-b-2 bg-transparent px-2.5 py-1.5 text-sm transition-colors ${
              selected
                ? 'border-[var(--accent)] font-semibold text-[var(--accent-text)]'
                : 'border-transparent font-normal text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <span>{tab.label}</span>
            {tab.dot && (
              <span
                data-testid={`${testIdPrefix}-tab-${tab.id}-dot`}
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-[var(--green)]"
              />
            )}
            {(tab.count ?? 0) > 0 && (
              <span
                data-testid={`${testIdPrefix}-tab-${tab.id}-count`}
                className="rounded-full bg-[var(--green-bg)] px-[5px] text-[10px] text-[var(--green)]"
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
