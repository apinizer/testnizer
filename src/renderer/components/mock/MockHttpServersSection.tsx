/**
 * "HTTP servers" group of the Mocks panel: the project's HTTP mock servers in
 * the shared `MockServerRow` (issue #140). The panel loads the list; opening
 * a row opens its `mockServer` editor tab.
 */
import { useMemo, useState } from 'react'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import type { MockServer } from '../../types'
import MockGroupHeader from './MockGroupHeader'
import MockServerRow from './MockServerRow'
import { closeMockServerTab, mockServerUrl, openMockServerTab } from './mock-http-tabs'

export default function MockHttpServersSection({
  query,
  onAdd,
  disabled,
}: {
  query: string
  onAdd?: () => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const servers = useMockStore((s) => s.servers)
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
    <section data-testid="mock-http-section">
      <MockGroupHeader
        title={t('mockMcp.httpSectionTitle')}
        count={servers.length}
        addLabel={t('mockNew.addHttp')}
        onAdd={onAdd}
        disabled={disabled}
        testId="mock-http-section-title"
        addTestId="mock-group-add-http"
      />
      {filtered.length === 0 ? (
        <div className="px-4 pb-4 pt-1 text-center text-[12px] text-[var(--muted)]">
          {servers.length === 0 ? t('mockNew.httpEmpty') : t('mock.noMatches')}
        </div>
      ) : (
        filtered.map((s) => {
          const url = mockServerUrl(s)
          return (
            <MockServerRow
              key={s.id}
              kind="http"
              testIdPrefix="mock-http"
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
        itemType={t('mockNew.httpItemType')}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  )
}
