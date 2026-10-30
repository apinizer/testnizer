/**
 * Issue #254 — how the project dialog names an inherited app value.
 * Pure helpers (no React) so the components file exports components only.
 */
import type { ProxySetting } from '../../shared/request-settings'

/** "on" / "off" in the UI language. */
export function onOff(t: (k: string) => string, v: boolean): string {
  return t(v ? 'settingsTab.valueOn' : 'settingsTab.valueOff')
}

/** An app proxy as one short phrase: "no proxy", "system proxy" or "host:port". */
export function describeProxy(t: (k: string) => string, p: ProxySetting | undefined): string {
  if (p?.mode === 'none') return t('settingsScope.proxyNone')
  if (p?.mode === 'custom' && p.host) return p.port ? `${p.host}:${p.port}` : p.host
  return t('settingsScope.proxySystem')
}
