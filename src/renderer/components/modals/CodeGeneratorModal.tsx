import { useState } from 'react'
import { X, Copy, Check, Terminal, Code2, FileCode } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import MonacoWrapper from '../shared/MonacoWrapper'
import Modal from '../shared/Modal'
import { CODE_LANGUAGES, curlMonacoLanguage } from '../../lib/code-generator'
import { useGeneratedCode } from '../shared/use-generated-code'
import IncludeSecretsToggle from '../shared/IncludeSecretsToggle'
import CurlVariantPicker from '../shared/CurlVariantPicker'
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
  const { t } = useTranslation()
  const show = useUIStore((s) => s.showCodeGenerator)
  const setShowCodeGenerator = useUIStore((s) => s.setShowCodeGenerator)
  const [activeLang, setActiveLang] = useState<CodeLanguage>('curl')
  const [copied, setCopied] = useState(false)

  // Session-only opt-in: a secret variable stays `{{name}}` in the snippet.
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const { code } = useGeneratedCode(activeLang, includeSecrets)
  // The modal stays mounted while hidden — the opt-in must not outlive one opening.
  function setShow(open: boolean): void {
    if (!open) setIncludeSecrets(false)
    setShowCodeGenerator(open)
  }

  const curlDialect = useUIStore((s) => s.curlSnippet.dialect)
  const monacoLang =
    activeLang === 'curl'
      ? curlMonacoLanguage(curlDialect)
      : (CODE_LANGUAGES.find((l) => l.id === activeLang)?.monacoLang ?? 'plaintext')

  if (!show) return null

  function handleCopy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal
      open={show}
      onOpenChange={setShow}
      title={t('codeGen.title')}
      testId="code-generator-modal"
    >
      <div
        className="flex h-[520px] w-[820px] max-w-[95vw] flex-col overflow-hidden rounded-[14px] bg-[var(--white)]"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <div className="font-bold text-[var(--text)]">{t('codeGen.title')}</div>
          <div className="flex items-center gap-3">
            <IncludeSecretsToggle checked={includeSecrets} onChange={setIncludeSecrets} />
            <button
              type="button"
              onClick={handleCopy}
              data-testid="code-generator-copy"
              className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
            >
              {copied ? <Check size={13} className="text-[var(--green)]" /> : <Copy size={13} />}
              {copied ? t('codeGen.copied') : t('codeGen.copy')}
            </button>
            <button
              type="button"
              aria-label={t('a11y.closeDialog')}
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
          <div
            role="group"
            aria-label={t('codeGen.languages')}
            className="w-[200px] shrink-0 overflow-auto border-r border-[var(--border)] bg-[var(--bg)] py-1"
          >
            {CODE_LANGUAGES.map((lang) => (
              <button
                key={lang.id}
                type="button"
                aria-pressed={activeLang === lang.id}
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
          <div className="flex flex-1 flex-col overflow-hidden">
            {activeLang === 'curl' && (
              <div className="shrink-0 border-b border-[var(--border)] px-3 py-1.5">
                <CurlVariantPicker />
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              <MonacoWrapper value={code} language={monacoLang} readOnly height="100%" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={() => setShow(false)}
            data-testid="code-generator-close"
            className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3.5 py-1.5 font-medium text-[var(--text)] hover:opacity-80"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
