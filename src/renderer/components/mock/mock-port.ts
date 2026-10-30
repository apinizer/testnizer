/**
 * The New Mock Server dialog's port rule (issue #257), checked as the user
 * types. Pure: no store, no i18n.
 */
export const PRIVILEGED_PORT_BELOW = 1024

export type PortCheck =
  | { ok: true; port: number; privileged: boolean }
  | { ok: false; reason: 'empty' | 'notNumber' | 'range' }

export function checkMockPort(raw: string): PortCheck {
  const value = raw.trim()
  if (!value) return { ok: false, reason: 'empty' }
  // ASCII digits only: no sign, decimal point, exponent, hex or full-width digits.
  if (!/^[0-9]+$/.test(value)) return { ok: false, reason: 'notNumber' }
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return { ok: false, reason: 'range' }
  return { ok: true, port, privileged: port < PRIVILEGED_PORT_BELOW }
}
