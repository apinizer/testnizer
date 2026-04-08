import { useRequestStore } from '../../stores/request.store'
import KeyValueTable from '../shared/KeyValueTable'

export default function ParamsTab() {
  const params = useRequestStore((s) => s.params)
  const updateParam = useRequestStore((s) => s.updateParam)
  const removeParam = useRequestStore((s) => s.removeParam)
  const addParam = useRequestStore((s) => s.addParam)

  return (
    <div>
      <div className="mb-2 text-[0.8125rem] font-medium" style={{ color: 'var(--text)' }}>
        Query Params
      </div>
      <KeyValueTable
        rows={params}
        onUpdate={updateParam}
        onRemove={removeParam}
        onAdd={addParam}
        addLabel="+ Add Parameter"
      />
    </div>
  )
}
