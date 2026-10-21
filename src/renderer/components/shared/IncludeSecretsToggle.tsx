import { Checkbox } from '../mock-mcp/ui'
import { useTranslation } from '../../lib/i18n'

/**
 * "Include secret values" for generated code (Generate Code, MCP Copy as…).
 * Off by default and kept in component state only — never persisted — so a
 * copied snippet carries `{{name}}` for a secret variable unless the user
 * asks for a ready-to-run command this time.
 */
export default function IncludeSecretsToggle({
  checked,
  onChange,
  testId = 'codegen-include-secrets',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  testId?: string
}) {
  const { t } = useTranslation()
  return (
    <span title={t('codeGen.includeSecretsHint')} className="flex shrink-0">
      <Checkbox
        checked={checked}
        onChange={onChange}
        label={t('codeGen.includeSecrets')}
        testId={testId}
      />
    </span>
  )
}
