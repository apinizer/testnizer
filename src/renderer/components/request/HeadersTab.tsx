import { useRequestStore } from '../../stores/request.store'
import KeyValueTable from '../shared/KeyValueTable'
import { STANDARD_HTTP_HEADERS } from '../../lib/http-headers'

export default function HeadersTab() {
  const headers = useRequestStore((s) => s.headers)
  const updateHeader = useRequestStore((s) => s.updateHeader)
  const removeHeader = useRequestStore((s) => s.removeHeader)
  const addHeader = useRequestStore((s) => s.addHeader)
  const setHeaders = useRequestStore((s) => s.setHeaders)

  return (
    <div>
      <KeyValueTable
        rows={headers}
        onUpdate={updateHeader}
        onRemove={removeHeader}
        onAdd={addHeader}
        onReplaceAll={setHeaders}
        addLabel="+ Add Header"
        enableAutocomplete
        keyAutocompleteEntries={STANDARD_HTTP_HEADERS}
        flush
      />
    </div>
  )
}
