import { useState, useMemo } from 'react'
import { X, Copy, Check, Terminal, Code2, FileCode } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useRequestStore } from '../../stores/request.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import Modal from '../shared/Modal'
import { generateCode, CODE_LANGUAGES } from '../../lib/code-generator'
import type { CodeLanguage } from '../../types'

const LANG_ICONS: Record<string, React.ReactNode> = {
  curl: <Terminal size={14} />,
  'js-fetch': <FileCode size={14} />,
  'js-axios': <FileCode size={14} />,
  'python-requests': <Code2 size={14} />,
  'java-okhttp': <Code2 size={14} />,
  go: <Code2 size={14} />,
  php: <Code2 size={14} />,
  ruby: <Code2 size={14} />,
  swift: <Code2 size={14} />,
  kotlin: <Code2 size={14} />,
  csharp: <Code2 size={14} />,
}

export default function CodeGeneratorModal() {
  const show = useUIStore((s) => s.showCodeGenerator)
  const setShow = useUIStore((s) => s.setShowCodeGenerator)
  const [activeLang, setActiveLang] = useState<CodeLanguage>('curl')
  const [copied, setCopied] = useState(false)

  const method = useRequestStore((s) => s.method)
  const url = useRequestStore((s) => s.url)
  const params = useRequestStore((s) => s.params)
  const headers = useRequestStore((s) => s.headers)
  const body = useRequestStore((s) => s.body)
  const auth = useRequestStore((s) => s.auth)

  const code = useMemo(() => {
    return generateCode(activeLang, { method, url, params, headers, body, auth })
  }, [activeLang, method, url, params, headers, body, auth])

  const monacoLang = CODE_LANGUAGES.find((l) => l.id === activeLang)?.monacoLang ?? 'plaintext'

  if (!show) return null

  function handleCopy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal open={show} onOpenChange={setShow} title="Generate Code" zIndex={500}>
      <div
        className="flex h-[520px] w-[820px] max-w-[95vw] flex-col overflow-hidden rounded-[14px] bg-[var(--white)]"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <div className="font-bold text-[var(--text)]">Generate Code</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
            >
              {copied ? <Check size={13} className="text-[var(--green)]" /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setShow(false)}
              className="cursor-pointer p-1 text-[var(--hint)] hover:text-[var(--text)]"
              style={{ background: 'transparent', border: 'none' }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Language sidebar */}
          <div className="w-[200px] shrink-0 overflow-auto border-r border-[var(--border)] bg-[var(--bg)] py-1">
            {CODE_LANGUAGES.map((lang) => (
              <button
                key={lang.id}
                type="button"
                onClick={() => setActiveLang(lang.id)}
                className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left transition-colors"
                style={{
                  background: activeLang === lang.id ? 'var(--accent-light)' : 'transparent',
                  color: activeLang === lang.id ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: activeLang === lang.id ? 600 : 400,
                  border: 'none',
                  borderLeft:
                    activeLang === lang.id ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                <span style={{ color: activeLang === lang.id ? 'var(--accent)' : 'var(--muted)' }}>
                  {LANG_ICONS[lang.id]}
                </span>
                {lang.label}
              </button>
            ))}
          </div>

          {/* Code pane */}
          <div className="flex-1 overflow-hidden">
            <MonacoWrapper value={code} language={monacoLang} readOnly height="100%" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={() => setShow(false)}
            className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[#555] transition-colors hover:bg-[var(--bg)]"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
