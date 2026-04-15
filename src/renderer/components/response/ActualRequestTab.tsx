import { useResponseStore } from '../../stores/response.store'

export default function ActualRequestTab() {
  const response = useResponseStore((s) => s.response)
  const actual = response?.actualRequest

  if (!actual) {
    return (
      <div className="p-4 text-center text-[var(--hint)]">
        Send a request to see the actual request details.
      </div>
    )
  }

  return (
    <div className="p-3.5">
      <pre className="m-0 font-mono leading-[1.85]">
        <span className="text-[var(--blue)]">{actual.method}</span>{' '}
        <span className="text-[var(--text)]">{actual.url}</span>{' '}
        <span className="text-[var(--muted)]">HTTP/1.1</span>
        {'\n'}
        {Object.entries(actual.headers).map(([key, value]) => (
          <span key={key}>
            <span className="text-[var(--orange)]">{key}</span>
            <span className="text-[var(--text)]">: {value}</span>
            {'\n'}
          </span>
        ))}
        {actual.body && (
          <>
            {'\n'}
            <span className="text-[var(--text)]">{actual.body}</span>
          </>
        )}
      </pre>
    </div>
  )
}
