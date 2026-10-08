import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import McpKvSection from './McpKvSection'

/**
 * Environment panel of the MCP config tab strip (issue #139): extra env vars
 * for the spawned stdio process, merged over the safe default env (PATH,
 * HOME, …) by the main process. `{{var}}` resolves at Connect. The tab is
 * shown for stdio only.
 */
export default function McpStdioEnvSection() {
  const { t } = useTranslation()
  const envVars = useMcpStore((s) => s.envVars)
  const addEnvVar = useMcpStore((s) => s.addEnvVar)
  const updateEnvVar = useMcpStore((s) => s.updateEnvVar)
  const removeEnvVar = useMcpStore((s) => s.removeEnvVar)

  return (
    <McpKvSection
      testIdPrefix="mcp-env"
      rows={envVars}
      onUpdate={updateEnvVar}
      onRemove={removeEnvVar}
      onAdd={addEnvVar}
      addLabel={t('mcp.env.add')}
      hint={t('mcp.env.hint')}
    />
  )
}
