import { useState } from 'react'
import { useRequestStore } from '../../stores/request.store'
import MonacoWrapper from '../shared/MonacoWrapper'

type ScriptSection = 'pre-request' | 'post-response'

// Example snippets surfaced via the "Insert example" button when the relevant
// script field is empty. Important: these are NEVER passed as the editor's
// `value` prop — doing that would *display* the example without ever writing
// it back into the store via `onChange`, so the runner branch in
// `sendRequest()` would skip the script and the Test Results tab would show
// "No tests were run for this request" even though the user can clearly see
// a `pm.test(...)` call in the editor.
const PRE_REQUEST_EXAMPLE = `// Pre-request script runs before the request is sent.
// Both \`pm\` (Postman-compatible) and \`t\` (Testnizer alias) are available.
// Examples:
//   pm.environment.set('token', 'abc');
//   t.variables.set('userId', '42');
`

const POST_RESPONSE_EXAMPLE = `// \`pm\` (Postman-compatible) and \`t\` (Testnizer alias) are interchangeable.
pm.test("Status code is 200", function () {
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

  const showInsertExample =
    (activeSection === 'pre-request' && !preScript) ||
    (activeSection === 'post-response' && !postScript)

  function handleInsertExample(): void {
    if (activeSection === 'pre-request') setPreScript(PRE_REQUEST_EXAMPLE)
    else setPostScript(POST_RESPONSE_EXAMPLE)
  }

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

        {showInsertExample && (
          <button
            type="button"
            onClick={handleInsertExample}
            className="cursor-pointer rounded px-2 py-0.5"
            style={{
              background: 'transparent',
              border: '1px solid var(--border2)',
              color: 'var(--accent-text)',
              fontSize: 12,
            }}
          >
            + Insert example
          </button>
        )}

        {/* Snippet helper */}
        <span style={{ color: 'var(--hint)' }}>JavaScript</span>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {activeSection === 'pre-request' && (
          <MonacoWrapper
            value={preScript}
            onChange={setPreScript}
            language="javascript"
            height="100%"
          />
        )}
        {activeSection === 'post-response' && (
          <MonacoWrapper
            value={postScript}
            onChange={setPostScript}
            language="javascript"
            height="100%"
          />
        )}
      </div>
    </div>
  )
}
