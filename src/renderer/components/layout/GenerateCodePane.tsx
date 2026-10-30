import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import MonacoWrapper from '../shared/MonacoWrapper'
import { CODEGEN_LANGUAGES } from '../../../shared/codegen'
import { useGeneratedCode } from '../shared/use-generated-code'
import { useCodegenSelection } from '../shared/use-codegen-selection'
import IncludeSecretsToggle from '../shared/IncludeSecretsToggle'
import CodegenVariantRow from '../shared/CodegenVariantRow'
import CodegenUnavailable from '../shared/CodegenUnavailable'
import CodegenWsseNote from '../shared/CodegenWsseNote'
import { useTranslation } from '../../lib/i18n'
import { SELECT_CLS } from '../mock-mcp/ui'

/**
 * Generate Code pane of the right panel: Language select + Copy, the
 * "Include secret values" opt-in, the Variant row (with Options), the hidden
 * secret / unresolved variable notes, the snippet. Same selection as the
 * Generate Code modal (`ui.store.codegen`, issue #280).
 */
export default function GenerateCodePane() {
  const { t } = useTranslation()
  const selection = useCodegenSelection()
  const [copied, setCopied] = useState(false)

  // Session-only opt-in: a secret variable stays `{{name}}` in the snippet.
  const [includeSecrets, setIncludeSecrets] = useState(false)
  // `unresolved`: `{{var}}` placeholders the resolver couldn't substitute,
  // surfaced as a banner so users notice missing-variable cases like
  // body=`{{employee_body}}` with no `employee_body` in the active env
  // (v1.4.2 T-5.5). A hidden secret is not "unresolved" — it has its own note.
  const {
    code,
    hiddenSecrets,
    unresolved: unresolvedVars,
    unavailableProtocol,
    wsSecurityNote,
  } = useGeneratedCode(selection.variant.id, includeSecrets, selection.options)

  function handleCopy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (unavailableProtocol) return <CodegenUnavailable protocol={unavailableProtocol} />

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Language selector + copy */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-2.5 py-2">
        <select
          value={selection.language.id}
          aria-label={t('codeGen.language')}
          data-testid="codegen-language-select"
          onChange={(e) => selection.setLanguage(e.target.value)}
          className={`${SELECT_CLS} flex-1 text-sm`}
        >
          {CODEGEN_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleCopy}
          title={t('rightPanel.copy')}
          data-testid="codegen-pane-copy"
          className="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--white)] px-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
        >
          {copied ? <Check size={12} className="text-[var(--green)]" /> : <Copy size={12} />}
          <span>{copied ? t('rightPanel.copied') : t('rightPanel.copy')}</span>
        </button>
      </div>

      <div className="flex shrink-0 items-center border-b border-[var(--border)] px-2.5 py-1.5">
        <IncludeSecretsToggle checked={includeSecrets} onChange={setIncludeSecrets} />
      </div>

      <div className="shrink-0 border-b border-[var(--border)] px-2.5 py-1.5">
        <CodegenVariantRow selection={selection} />
      </div>

      {wsSecurityNote && <CodegenWsseNote />}

      {hiddenSecrets.length > 0 && (
        <div
          data-testid="codegen-secrets-hidden"
          className="shrink-0 border-b border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted)]"
          title={t('codeGen.includeSecretsHint')}
        >
          {t('codeGen.secretsHidden')} {hiddenSecrets.map((v) => `{{${v}}}`).join(', ')}
        </div>
      )}

      {/* Unresolved-variable banner */}
      {unresolvedVars.length > 0 && (
        <div
          data-testid="codegen-unresolved"
          className="shrink-0 border-b border-t border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--orange)]"
          title={t('rightPanel.unresolvedHint')}
        >
          {t('rightPanel.unresolved')} {unresolvedVars.map((v) => `{{${v}}}`).join(', ')}
        </div>
      )}

      {/* Code preview */}
      <div className="flex-1 overflow-hidden">
        <MonacoWrapper
          value={code}
          language={selection.variant.monaco}
          readOnly
          height="100%"
          lineNumbers="off"
        />
      </div>
    </div>
  )
}
