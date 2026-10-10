import { useRequestStore } from '../../stores/request.store'
import KeyValueTable from '../shared/KeyValueTable'
import { useTranslation } from '../../lib/i18n'

export default function ParamsTab() {
  const { t } = useTranslation()
  const params = useRequestStore((s) => s.params)
  const updateParam = useRequestStore((s) => s.updateParam)
  const removeParam = useRequestStore((s) => s.removeParam)
  const addParam = useRequestStore((s) => s.addParam)
  const setParams = useRequestStore((s) => s.setParams)

  return (
    <div>
      <div className="mb-2 px-2.5 font-medium" style={{ color: 'var(--text)' }}>
        {t('request.queryParams')}
      </div>
      <KeyValueTable
        rows={params}
        onUpdate={updateParam}
        onRemove={removeParam}
        onAdd={addParam}
        onReplaceAll={setParams}
        addLabel={t('kv.addParameter')}
        flush
        resizable
      />
    </div>
  )
}
