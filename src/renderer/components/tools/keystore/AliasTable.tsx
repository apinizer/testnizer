import { useTranslation } from '../../../lib/i18n'
import type { KeystoreAliasSummary } from '../../../types'
import { certValidityStatus } from './cert-validity'

const GREEN = '#1a7a4a'
const AMBER = '#b35a00'
const RED = '#cc2200'

interface ExpiryStatus {
  color: string
  label: string
}

/**
 * Certificate expiry status coloring (design §9.4): valid → green, expiring in
 * under 30 days → amber, expired → red. Label reads "in N days" / "N days ago".
 * Thresholds use the raw diff (see {@link certValidityStatus}); the rounded day
 * count is only for the label.
 */
function expiryStatus(notAfter: string | undefined, t: (k: string) => string): ExpiryStatus | null {
  if (!notAfter) return null
  const end = Date.parse(notAfter)
  if (Number.isNaN(end)) return null
  const { status, days } = certValidityStatus(end, Date.now())
  if (status === 'expired') {
    return {
      color: RED,
      label: `${t('tools.keystore.expired')} · ${days} ${t('tools.keystore.daysAgoSuffix')}`,
    }
  }
  const label = `${t('tools.keystore.inPrefix')} ${days} ${t('tools.keystore.daysSuffix')}`.trim()
  return { color: status === 'warning' ? AMBER : GREEN, label }
}

function badgeFor(
  a: KeystoreAliasSummary,
  t: (k: string) => string,
): { text: string; bg: string; color: string } {
  if (a.entryType === 'KEY') {
    return a.hasPrivateKey
      ? { text: t('tools.keystore.badgeKeypair'), bg: '#eeecfe', color: '#5b52d4' }
      : { text: t('tools.keystore.badgeSecret'), bg: '#fff4e0', color: '#b35a00' }
  }
  return { text: t('tools.keystore.badgeTrusted'), bg: '#e8f4ff', color: '#0066cc' }
}

export default function AliasTable({
  aliases,
  onDetail,
}: {
  aliases: KeystoreAliasSummary[]
  onDetail: (alias: string) => void
}) {
  const { t } = useTranslation()

  if (aliases.length === 0) {
    return (
      <div className="p-4 text-sm" style={{ color: 'var(--muted)' }}>
        {t('tools.keystore.noAliases')}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left" style={{ color: 'var(--muted)', background: 'var(--surface)' }}>
            <Th>{t('tools.keystore.colAlias')}</Th>
            <Th>{t('tools.keystore.colType')}</Th>
            <Th>{t('tools.keystore.colAlgorithm')}</Th>
            <Th>{t('tools.keystore.colSubject')}</Th>
            <Th>{t('tools.keystore.colExpiry')}</Th>
            <Th> </Th>
          </tr>
        </thead>
        <tbody>
          {aliases.map((a) => {
            const badge = badgeFor(a, t)
            const exp =
              a.entryType === 'CERTIFICATE' || a.hasPrivateKey ? expiryStatus(a.notAfter, t) : null
            return (
              <tr key={a.alias} className="border-t" style={{ borderColor: 'var(--border)' }}>
                <Td>
                  <span className="font-medium" style={{ color: 'var(--text)' }}>
                    {a.alias}
                  </span>
                </Td>
                <Td>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                    style={{ background: badge.bg, color: badge.color }}
                  >
                    {badge.text}
                  </span>
                </Td>
                <Td>
                  <span style={{ color: 'var(--muted)' }}>{a.keyAlgorithm ?? '—'}</span>
                </Td>
                <Td>
                  <span
                    className="block max-w-[22rem] truncate"
                    style={{ color: 'var(--muted)' }}
                    title={a.subjectDN ?? ''}
                  >
                    {a.subjectDN ?? '—'}
                  </span>
                </Td>
                <Td>
                  {exp ? (
                    <span style={{ color: exp.color }}>{exp.label}</span>
                  ) : (
                    <span style={{ color: 'var(--hint)' }}>{t('tools.keystore.noExpiry')}</span>
                  )}
                </Td>
                <Td>
                  {a.chainLength > 0 ? (
                    <button
                      onClick={() => onDetail(a.alias)}
                      className="rounded border px-2 py-0.5 text-[11px]"
                      style={{
                        borderColor: 'var(--border)',
                        background: 'var(--white)',
                        color: 'var(--accentText)',
                      }}
                    >
                      {t('tools.keystore.detail')}
                    </button>
                  ) : null}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide">{children}</th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-1.5 align-middle">{children}</td>
}
