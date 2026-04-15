import { useState } from 'react'
import { useRequestStore } from '../../stores/request.store'
import MonacoWrapper from '../shared/MonacoWrapper'

type ScriptSection = 'pre-request' | 'post-response'

const PRE_REQUEST_PLACEHOLDER = `// Pre-request script runs before the request is sent.
// Use pm.environment.set() / pm.variables.set() to configure.
`

const POST_RESPONSE_PLACEHOLDER = `pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});
`

export default function ScriptsTab() {
  const [activeSection, setActiveSection] = useState<ScriptSection>('post-response')
  const preScript = useRequestStore((s) => s.preScript)
  const setPreScript = useRequestStore((s) => s.setPreScript)
  const postScript = useRequestStore((s) => s.postScript)
  const setPostScript = useRequestStore((s) => s.setPostScript)

  const sections: { key: ScriptSection; label: string }[] = [
    { key: 'pre-request', label: 'Pre-request' },
    { key: 'post-response', label: 'Post-response' },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Section selector — Postman style horizontal pills */}
      <div
        className="flex shrink-0 items-center gap-1 px-3 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {sections.map((s) => {
          const isActive = activeSection === s.key
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setActiveSection(s.key)}
              className="cursor-pointer rounded-md px-3 py-1 font-medium transition-all"
              style={{
                background: isActive ? 'var(--accent-light)' : 'transparent',
                color: isActive ? 'var(--accent-text)' : 'var(--muted)',
                border: 'none',
              }}
              onMouseOver={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--fill-4)'
              }}
              onMouseOut={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              {s.label}
            </button>
          )
        })}

        <div className="flex-1" />

        {/* Snippet helper */}
        <span style={{ color: 'var(--hint)' }}>
          JavaScript (Postman Sandbox)
        </span>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {activeSection === 'pre-request' && (
          <MonacoWrapper
            value={preScript || PRE_REQUEST_PLACEHOLDER}
            onChange={setPreScript}
            language="javascript"
            height="100%"
          />
        )}
        {activeSection === 'post-response' && (
          <MonacoWrapper
            value={postScript || POST_RESPONSE_PLACEHOLDER}
            onChange={setPostScript}
            language="javascript"
            height="100%"
          />
        )}
      </div>
    </div>
  )
}
