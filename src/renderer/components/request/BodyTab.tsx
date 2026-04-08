import { useRequestStore } from '../../stores/request.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import KeyValueTable from '../shared/KeyValueTable'
import type { BodyType, KeyValuePair } from '../../types'

const BODY_OPTIONS: { value: BodyType; label: string }[] = [
  { value: 'none', label: 'none' },
  { value: 'form-data', label: 'form-data' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'text', label: 'Text' },
  { value: 'binary', label: 'Binary' },
]

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

export default function BodyTab() {
  const body = useRequestStore((s) => s.body)
  const setBody = useRequestStore((s) => s.setBody)

  const handleTypeChange = (type: BodyType) => {
    setBody({ ...body, type })
  }

  const handleContentChange = (content: string) => {
    setBody({ ...body, content })
  }

  const handleFormDataUpdate = (id: string, updates: Partial<KeyValuePair>) => {
    const formData = (body.formData || []).map((item) =>
      item.id === id ? { ...item, ...updates } : item
    )
    setBody({ ...body, formData })
  }

  const handleFormDataRemove = (id: string) => {
    setBody({ ...body, formData: (body.formData || []).filter((item) => item.id !== id) })
  }

  const handleFormDataAdd = () => {
    const newItem: KeyValuePair = { id: makeId(), key: '', value: '', enabled: true }
    setBody({ ...body, formData: [...(body.formData || []), newItem] })
  }

  const handleUrlEncodedUpdate = (id: string, updates: Partial<KeyValuePair>) => {
    const urlEncoded = (body.urlEncoded || []).map((item) =>
      item.id === id ? { ...item, ...updates } : item
    )
    setBody({ ...body, urlEncoded })
  }

  const handleUrlEncodedRemove = (id: string) => {
    setBody({ ...body, urlEncoded: (body.urlEncoded || []).filter((item) => item.id !== id) })
  }

  const handleUrlEncodedAdd = () => {
    const newItem: KeyValuePair = { id: makeId(), key: '', value: '', enabled: true }
    setBody({ ...body, urlEncoded: [...(body.urlEncoded || []), newItem] })
  }

  const monacoLanguage = body.type === 'xml' ? 'xml' : body.type === 'json' ? 'json' : 'plaintext'

  return (
    <div>
      {/* Body type selector — Apidog-style pill/chip buttons */}
      <div
        className="mb-3 flex items-center gap-1"
        style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}
      >
        {BODY_OPTIONS.map((opt) => {
          const isActive = body.type === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleTypeChange(opt.value)}
              className="cursor-pointer rounded-full text-[0.8125rem] font-medium transition-all"
              style={{
                padding: '4px 12px',
                background: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--muted)',
                border: 'none',
              }}
              onMouseOver={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'var(--fill-4)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
                }
              }}
              onMouseOut={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--muted)'
                }
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      {body.type === 'none' && (
        <div className="py-8 text-center text-sm text-[var(--hint)]">
          This request does not have a body.
        </div>
      )}

      {(body.type === 'json' || body.type === 'xml' || body.type === 'text' || body.type === 'html' || body.type === 'javascript') && (
        <div>
          {/* Toolbar row — Apidog style */}
          <div
            className="flex items-center gap-3"
            style={{ marginBottom: 8 }}
          >
            {body.type === 'json' && (
              <span className="text-[0.8rem]" style={{ color: 'var(--hint)' }}>
                application/json
              </span>
            )}
            {body.type === 'xml' && (
              <span className="text-[0.8rem]" style={{ color: 'var(--hint)' }}>
                application/xml
              </span>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--white)]">
            <MonacoWrapper
              value={body.content || ''}
              onChange={handleContentChange}
              language={monacoLanguage}
              height={200}
            />
          </div>
        </div>
      )}

      {body.type === 'form-data' && (
        <KeyValueTable
          rows={body.formData || []}
          onUpdate={handleFormDataUpdate}
          onRemove={handleFormDataRemove}
          onAdd={handleFormDataAdd}
          addLabel="+ Add Field"
        />
      )}

      {body.type === 'urlencoded' && (
        <KeyValueTable
          rows={body.urlEncoded || []}
          onUpdate={handleUrlEncodedUpdate}
          onRemove={handleUrlEncodedRemove}
          onAdd={handleUrlEncodedAdd}
          addLabel="+ Add Field"
        />
      )}

      {body.type === 'binary' && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--white)] p-4 text-center">
          <button
            type="button"
            className="cursor-pointer rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-4 py-2 text-sm text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Select File
          </button>
          {body.binaryPath && (
            <div className="mt-2 text-sm text-[var(--muted)]">{body.binaryPath}</div>
          )}
        </div>
      )}
    </div>
  )
}
