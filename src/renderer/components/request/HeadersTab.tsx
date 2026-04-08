import { useRequestStore } from '../../stores/request.store'
import KeyValueTable from '../shared/KeyValueTable'

export default function HeadersTab() {
  const headers = useRequestStore((s) => s.headers)
  const updateHeader = useRequestStore((s) => s.updateHeader)
  const removeHeader = useRequestStore((s) => s.removeHeader)
  const addHeader = useRequestStore((s) => s.addHeader)

  return (
    <div>
      <KeyValueTable
        rows={headers}
        onUpdate={updateHeader}
        onRemove={removeHeader}
        onAdd={addHeader}
        addLabel="+ Add Header"
        enableAutocomplete
      />
    </div>
  )
}
