/**
 * "Server type" in the HTTP mock editor's Settings tab (issue #222): the same
 * segmented switch as the "New mock server" dialog (`MockKindSegmented`),
 * limited to the kinds of the HTTP mock table (HTTP | SSE | AI — Mock MCP is
 * its own table).
 *
 * Changing the type is safe by construction: the kind is presentation only
 * (sidebar section, templates, body types offered, "Open in …" buttons) and
 * the engine never reads it, so nothing is deleted or rewritten — endpoints,
 * responses and their stream settings stay as they are, and a running server
 * keeps serving (the update hot-reloads it; no restart). When some responses
 * use a body type the new kind does not offer, a confirm says so first.
 *
 * The switch shows the STORED kind, so a rejected update leaves it unchanged.
 */
import { useState } from 'react'
import { Shuffle } from 'lucide-react'
import Modal from '../shared/Modal'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import type { MockBodyType, MockServer } from '../../types'
import {
  MOCK_SERVER_KINDS,
  normalizeMockServerKind,
  type MockServerKind,
} from '../../../shared/mock-kind'
import MockKindSegmented from './MockKindSegmented'
import { bodyTypesNotOffered, KIND_BADGE, serverTypeConfirmBody } from './mock-kind-ui'
import { MOCK_KIND_HINT_KEYS } from './new-mock-server'

/** Every response body type of the server, read fresh from main. */
async function serverBodyTypes(serverId: string): Promise<MockBodyType[]> {
  const store = useMockStore.getState()
  await store.loadEndpoints(serverId)
  const endpoints = useMockStore.getState().endpointsByServer[serverId] ?? []
  await Promise.all(endpoints.map((e) => store.loadResponses(e.id)))
  const byEndpoint = useMockStore.getState().responsesByEndpoint
  return endpoints.flatMap((e) => (byEndpoint[e.id] ?? []).map((r) => r.bodyType))
}

interface Pending {
  kind: MockServerKind
  count: number
  types: MockBodyType[]
}

export default function MockServerTypeField({ server }: { server: MockServer }) {
  const { t } = useTranslation()
  const updateServer = useMockStore((s) => s.updateServer)
  const current = normalizeMockServerKind(server.kind)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)

  async function apply(kind: MockServerKind): Promise<void> {
    setPending(null)
    setBusy(true)
    await updateServer(server.id, { kind })
    setBusy(false)
    const stored = useMockStore.getState().servers.find((s) => s.id === server.id)?.kind
    if (normalizeMockServerKind(stored) !== kind) {
      toast.error(t('mock.serverTypeFailed'))
      return
    }
    toast.success(t('mock.serverTypeChanged').replace('{kind}', KIND_BADGE[kind]))
  }

  async function choose(kind: MockServerKind): Promise<void> {
    if (kind === current || busy) return
    setBusy(true)
    const bodyTypes = await serverBodyTypes(server.id)
    setBusy(false)
    const types = bodyTypesNotOffered(kind, bodyTypes)
    if (types.length === 0) return apply(kind)
    const count = bodyTypes.filter((b) => types.includes(b)).length
    setPending({ kind, count, types })
  }

  return (
    <div data-testid="mock-settings-type">
      <MockKindSegmented
        kinds={MOCK_SERVER_KINDS}
        value={current}
        labels={KIND_BADGE}
        ariaLabel={t('mock.serverType')}
        testIdPrefix="mock-settings-type"
        disabled={busy}
        onChange={(k) => void choose(k)}
      />
      <p className="mt-1.5 text-[11px] text-[var(--muted)]">{t(MOCK_KIND_HINT_KEYS[current])}</p>
      <p data-testid="mock-settings-type-hint" className="mt-0.5 text-[11px] text-[var(--hint)]">
        {t('mock.serverTypeHint')}
      </p>
      {pending && (
        <ConfirmTypeChange
          pending={pending}
          onConfirm={() => void apply(pending.kind)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}

function ConfirmTypeChange({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: Pending
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const kind = KIND_BADGE[pending.kind]
  const title = t('mock.serverTypeConfirmTitle').replace('{kind}', kind)
  const body = serverTypeConfirmBody(t, { count: pending.count, kind, types: pending.types })
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onCancel()}
      title={title}
      description={body}
      testId="mock-settings-type-confirm"
    >
      <div className="flex w-[460px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-[var(--border)] bg-[var(--white)] shadow-xl">
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-light)] text-[var(--accent)]">
            <Shuffle size={15} aria-hidden="true" />
          </div>
          <h3 className="min-w-0 flex-1 text-sm font-semibold text-[var(--text)]">{title}</h3>
        </div>
        <p className="px-5 py-4 text-sm leading-relaxed text-[var(--sub)]">{body}</p>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            data-testid="mock-settings-type-cancel"
            onClick={onCancel}
            className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3.5 py-1.5 text-sm font-medium text-[var(--text)] hover:opacity-80"
          >
            {t('mock.cancel')}
          </button>
          <button
            type="button"
            autoFocus
            data-testid="mock-settings-type-confirm-ok"
            onClick={onConfirm}
            className="cursor-pointer rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            {t('mock.serverTypeConfirm')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
