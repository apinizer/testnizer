import { useState } from 'react'
import { X, Copy, Check, Terminal, Code2 } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import MonacoWrapper from '../shared/MonacoWrapper'
import Modal from '../shared/Modal'
import { CODEGEN_LANGUAGES } from '../../../shared/codegen'
import { useGeneratedCode } from '../shared/use-generated-code'
import { useCodegenSelection } from '../shared/use-codegen-selection'
import IncludeSecretsToggle from '../shared/IncludeSecretsToggle'
import CodegenVariantRow from '../shared/CodegenVariantRow'
import CodegenUnavailable from '../shared/CodegenUnavailable'
import CodegenWsseNote from '../shared/CodegenWsseNote'

/** Shell-like languages get the terminal icon, the rest the code icon. */
const SHELL_LANGS = new Set(['curl', 'shell', 'http', 'powershell'])

export default function CodeGeneratorModal() {
  const { t } = useTranslation()
  const show = useUIStore((s) => s.showCodeGenerator)
  const setShowCodeGenerator = useUIStore((s) => s.setShowCodeGenerator)
  const selection = useCodegenSelection()
  const [copied, setCopied] = useState(false)

  // Session-only opt-in: a secret variable stays `{{name}}` in the snippet.
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const { code, unavailableProtocol, wsSecurityNote } = useGeneratedCode(
    selection.variant.id,
    includeSecrets,
    selection.options,
  )
  // The modal stays mounted while hidden — the opt-in must not outlive one opening.
  function setShow(open: boolean): void {
    if (!open) setIncludeSecrets(false)
    setShowCodeGenerator(open)
  }

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
      <div className="flex h-[560px] w-[860px] max-w-[95vw] flex-col overflow-hidden rounded-[14px] bg-[var(--white)] shadow-[var(--shadow-modal)]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <div className="font-bold text-[var(--text)]">{t('codeGen.title')}</div>
          <div className="flex items-center gap-3">
            <IncludeSecretsToggle checked={includeSecrets} onChange={setIncludeSecrets} />
            <button
              type="button"
              onClick={handleCopy}
              disabled={!!unavailableProtocol}
              data-testid="code-generator-copy"
              className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? <Check size={13} className="text-[var(--green)]" /> : <Copy size={13} />}
              {copied ? t('codeGen.copied') : t('codeGen.copy')}
            </button>
            <button
              type="button"
              aria-label={t('a11y.closeDialog')}
              onClick={() => setShow(false)}
              className="cursor-pointer border-none bg-transparent p-1 text-[var(--hint)] hover:text-[var(--text)]"
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
            className="w-[180px] shrink-0 overflow-auto border-r border-[var(--border)] bg-[var(--bg)] py-1"
          >
            {CODEGEN_LANGUAGES.map((lang) => {
              const active = selection.language.id === lang.id
              const Icon = SHELL_LANGS.has(lang.id) ? Terminal : Code2
              return (
                <button
                  key={lang.id}
                  type="button"
                  aria-pressed={active}
                  data-testid={`codegen-language-${lang.id}`}
                  onClick={() => selection.setLanguage(lang.id)}
                  className={`flex w-full cursor-pointer items-center gap-2.5 border-0 border-l-2 px-4 py-1.5 text-left transition-colors ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent-light)] font-semibold text-[var(--accent-text)]'
                      : 'border-transparent bg-transparent text-[var(--text)] hover:bg-[var(--surface)]'
                  }`}
                >
                  <Icon
                    size={14}
                    aria-hidden="true"
                    className={active ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}
                  />
                  {lang.label}
                </button>
              )
            })}
          </div>

          {/* Code pane */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {unavailableProtocol ? (
              <CodegenUnavailable protocol={unavailableProtocol} />
            ) : (
              <>
                <div className="shrink-0 border-b border-[var(--border)] px-3 py-1.5">
                  <CodegenVariantRow selection={selection} />
                </div>
                {wsSecurityNote && <CodegenWsseNote />}
                <div className="flex-1 overflow-hidden">
                  <MonacoWrapper
                    value={code}
                    language={selection.variant.monaco}
                    readOnly
                    height="100%"
                  />
                </div>
              </>
            )}
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
