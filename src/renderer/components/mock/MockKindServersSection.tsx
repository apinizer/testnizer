/**
 * One group of the Mocks panel for a kind of the HTTP mock table — "HTTP
 * servers", "SSE servers", "AI servers" (issues #140, #221): that kind's
 * servers in the shared `MockServerRow`. The panel loads the one list; each
 * group filters it client-side. Opening a row opens its `mockServer` editor
 * tab (the editor adapts to the kind).
 */
import { useMemo, useState } from 'react'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import type { MockServer } from '../../types'
import type { MockServerKind } from '../../../shared/mock-kind'
import { serversOfKind } from './mock-kind-ui'
import MockGroupHeader from './MockGroupHeader'
import MockServerRow from './MockServerRow'
import { closeMockServerTab, mockServerUrl, openMockServerTab } from './mock-http-tabs'

/** Per-kind wording and testid prefix — literal keys for the key-coverage test. */
const SECTION: Record<
  MockServerKind,
  { titleKey: string; addKey: string; emptyKey: string; itemTypeKey: string; prefix: string }
> = {
  http: {
    titleKey: 'mockMcp.httpSectionTitle',
    addKey: 'mockNew.addHttp',
    emptyKey: 'mockNew.httpEmpty',
    itemTypeKey: 'mockNew.httpItemType',
    prefix: 'mock-http',
  },
  sse: {
    titleKey: 'mockSse.sectionTitle',
    addKey: 'mockNew.addSse',
    emptyKey: 'mockNew.sseEmpty',
    itemTypeKey: 'mockNew.sseItemType',
    prefix: 'mock-sse',
  },
  ai: {
    titleKey: 'mockAi.sectionTitle',
    addKey: 'mockNew.addAi',
    emptyKey: 'mockNew.aiEmpty',
    itemTypeKey: 'mockNew.aiItemType',
    prefix: 'mock-ai',
  },
}

export default function MockKindServersSection({
  kind,
  query,
  onAdd,
  disabled,
}: {
  kind: MockServerKind
  query: string
  /** Omitted → no "+" on the group (a kind the dialog does not offer yet). */
  onAdd?: () => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const all = useMockStore((s) => s.servers)
  const servers = useMemo(() => serversOfKind(all, kind), [all, kind])
  const section = SECTION[kind]
  const statusByServer = useMockStore((s) => s.statusByServer)
  const errorByServer = useMockStore((s) => s.errorByServer)
  const startServer = useMockStore((s) => s.startServer)
  const stopServer = useMockStore((s) => s.stopServer)
  const deleteServer = useMockStore((s) => s.deleteServer)
  const [deleteTarget, setDeleteTarget] = useState<MockServer | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? servers.filter((s) => s.name.toLowerCase().includes(q)) : servers
  }, [servers, query])

  async function start(id: string): Promise<void> {
    const err = await startServer(id)
    if (err) toast.error(err)
  }

  async function confirmDelete(): Promise<void> {
    const target = deleteTarget
    setDeleteTarget(null)
    if (!target) return
    await deleteServer(target.id)
    closeMockServerTab(target.id)
  }

  return (
    <section data-testid={`${section.prefix}-section`}>
      <MockGroupHeader
        title={t(section.titleKey)}
        count={servers.length}
        addLabel={t(section.addKey)}
        onAdd={onAdd}
        disabled={disabled}
        testId={`${section.prefix}-section-title`}
        addTestId={`mock-group-add-${kind}`}
      />
      {filtered.length === 0 ? (
        <div className="px-4 pb-4 pt-1 text-center text-[12px] text-[var(--muted)]">
          {servers.length === 0 ? t(section.emptyKey) : t('mock.noMatches')}
        </div>
      ) : (
        filtered.map((s) => {
          const url = mockServerUrl(s)
          return (
            <MockServerRow
              key={s.id}
              kind={kind}
              testIdPrefix={section.prefix}
              id={s.id}
              name={s.name}
              status={statusByServer[s.id] ?? 'stopped'}
              address={`${s.host}:${s.port}`}
              copyText={url}
              errorMessage={errorByServer[s.id]}
              onOpen={() => openMockServerTab(s)}
              onStart={() => void start(s.id)}
              onStop={() => void stopServer(s.id)}
              onDelete={() => setDeleteTarget(s)}
            />
          )
        })
      )}
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        itemName={deleteTarget?.name ?? ''}
        itemType={t(section.itemTypeKey)}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  )
}
