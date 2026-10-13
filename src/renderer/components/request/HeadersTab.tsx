import { useRequestStore } from '../../stores/request.store'
import KeyValueTable from '../shared/KeyValueTable'
import { STANDARD_HTTP_HEADERS } from '../../lib/http-headers'
import { useTranslation } from '../../lib/i18n'
import { useTabsStore } from '../../stores/tabs.store'
import AutoHeadersSection from './AutoHeadersSection'

export default function HeadersTab() {
  const { t } = useTranslation()
  const headers = useRequestStore((s) => s.headers)
  const updateHeader = useRequestStore((s) => s.updateHeader)
  const removeHeader = useRequestStore((s) => s.removeHeader)
  const addHeader = useRequestStore((s) => s.addHeader)
  const setHeaders = useRequestStore((s) => s.setHeaders)
  // The auto-generated preview mirrors the HTTP engine only — SoapEditor
  // reuses this tab and its engine adds different headers (issue #204).
  const isHttp = useTabsStore((s) => {
    const tab = s.tabs.find((x) => x.id === s.activeTabId)
    return !tab || tab.protocol === 'http'
  })

  return (
    <div>
      <KeyValueTable
        rows={headers}
        onUpdate={updateHeader}
        onRemove={removeHeader}
        onAdd={addHeader}
        onReplaceAll={setHeaders}
        addLabel={t('kv.addHeader')}
        enableAutocomplete
        keyAutocompleteEntries={STANDARD_HTTP_HEADERS}
        flush
        resizable
      />
      {isHttp && <AutoHeadersSection />}
    </div>
  )
}
