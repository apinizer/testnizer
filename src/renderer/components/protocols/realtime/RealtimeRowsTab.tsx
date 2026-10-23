import type { KeyValuePair } from '../../../types'
import { useTranslation } from '../../../lib/i18n'
import KeyValueTable from '../../shared/KeyValueTable'
import CredentialRowsHint from '../../shared/CredentialRowsHint'
import { STANDARD_HTTP_HEADERS } from '../../../lib/http-headers'
import { isCredentialArgName, isCredentialHeaderName } from '../../../../shared/credential-headers'

/**
 * Params / Headers tab of the WebSocket and Socket.IO editors (issues #282 /
 * #283): the HTTP editor's key/value table (`{{var}}` autocomplete), with the
 * restart hint under credential-named rows (issue #244) — headers by the
 * header rule, params by the argument rule. Params stay in step with the URL
 * (`lib/url-query-sync.ts`).
 */
export default function RealtimeRowsTab({
  kind,
  rows,
  onUpdate,
  onRemove,
  onAdd,
  testIdPrefix,
}: {
  kind: 'params' | 'headers'
  rows: KeyValuePair[]
  onUpdate: (id: string, patch: Partial<KeyValuePair>) => void
  onRemove: (id: string) => void
  onAdd: () => void
  testIdPrefix: string
}) {
  const { t } = useTranslation()
  const headers = kind === 'headers'
  return (
    <div data-testid={`${testIdPrefix}-${kind}`}>
      <KeyValueTable
        rows={rows}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onAdd={onAdd}
        addLabel={headers ? t('kv.addHeader') : t('kv.addParameter')}
        keyAutocompleteEntries={headers ? STANDARD_HTTP_HEADERS : undefined}
      />
      <CredentialRowsHint
        rows={rows}
        testId={`${testIdPrefix}-${kind}-restart-hint`}
        isCredentialName={headers ? isCredentialHeaderName : isCredentialArgName}
      />
    </div>
  )
}
