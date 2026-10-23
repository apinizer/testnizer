import { useRequestStore } from '../../stores/request.store'
import KeyValueTable from '../shared/KeyValueTable'
import { useTranslation } from '../../lib/i18n'
import CredentialRowsHint from '../shared/CredentialRowsHint'
import { isCredentialArgName } from '../../../shared/credential-headers'
import PathVariablesTable from './PathVariablesTable'

export default function ParamsTab() {
  const { t } = useTranslation()
  const params = useRequestStore((s) => s.params)
  const pathVariables = useRequestStore((s) => s.pathVariables)
  const updateParam = useRequestStore((s) => s.updateParam)
  const removeParam = useRequestStore((s) => s.removeParam)
  const addParam = useRequestStore((s) => s.addParam)
  const setParams = useRequestStore((s) => s.setParams)
  const updatePathVariable = useRequestStore((s) => s.updatePathVariable)

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
      <CredentialRowsHint
        rows={params}
        testId="params-credential-restart-hint"
        isCredentialName={isCredentialArgName}
        inset
      />
      {/* `:name` segments of the URL path (issue #276) — shown only when the URL has one. */}
      {pathVariables && pathVariables.length > 0 && (
        <div className="mt-4" data-testid="path-variables">
          <div className="mb-2 px-2.5 font-medium" style={{ color: 'var(--text)' }}>
            {t('request.pathVariables')}
          </div>
          <PathVariablesTable rows={pathVariables} onUpdate={updatePathVariable} />
          <CredentialRowsHint
            rows={pathVariables}
            testId="path-variables-credential-restart-hint"
            isCredentialName={isCredentialArgName}
            inset
          />
        </div>
      )}
    </div>
  )
}
