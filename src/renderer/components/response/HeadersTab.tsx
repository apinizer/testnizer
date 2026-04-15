import { useResponseStore } from '../../stores/response.store'

/**
 * Postman-style response headers tab — clean 2-column list.
 */
export default function HeadersTab() {
  const response = useResponseStore((s) => s.response)
  const headers = response?.headers || {}
  const keys = Object.keys(headers).sort((a, b) => a.localeCompare(b))

  if (keys.length === 0) {
    return (
      <div className="p-4 text-center" style={{ color: 'var(--hint)' }}>
        No headers in response.
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ background: 'var(--surface)' }}>
            <th
              className="text-left font-medium"
              style={{
                padding: '8px 12px',
                color: 'var(--muted)',
                borderBottom: '1px solid var(--border)',
                width: '35%',
                fontSize: 13,
              }}
            >
              KEY
            </th>
            <th
              className="text-left font-medium"
              style={{
                padding: '8px 12px',
                color: 'var(--muted)',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}
            >
              VALUE
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} style={{ borderBottom: '1px solid var(--border-split)' }}>
              <td
                className="font-mono align-top"
                style={{
                  padding: '7px 12px',
                  color: 'var(--json-key)',
                  wordBreak: 'break-all',
                }}
              >
                {k}
              </td>
              <td
                className="font-mono align-top"
                style={{
                  padding: '7px 12px',
                  color: 'var(--text)',
                  wordBreak: 'break-all',
                }}
              >
                {headers[k]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
