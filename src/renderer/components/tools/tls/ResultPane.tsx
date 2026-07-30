/**
 * TLS Inspector — result pane. Pure move out of `TlsInspectorTool.tsx`.
 *
 * The one rule worth keeping in view here: certificate verdicts render only
 * when the server actually presented a certificate (`resultVisibility`), because
 * the engine fills those fields with placeholders on a transport failure.
 */
import { useTranslation } from '../../../lib/i18n'
import type { TlsCertificateInfo, TlsInspectResult } from '../../../types'
import { resultVisibility } from '../../../lib/tools/tls-inspect'
import { Badge, Caption, Meta, AMBER, AMBER_BG, GREEN, GREEN_BG, RED, RED_BG } from './atoms'

export default function ResultPane({
  result,
  error,
  onOpenCert,
  onAddTrusted,
}: {
  result: TlsInspectResult | null
  error: string | null
  onOpenCert: (index: number) => void
  onAddTrusted: (cert: TlsCertificateInfo) => void
}) {
  const { t } = useTranslation()

  const { handshook, hasLeaf } = result
    ? resultVisibility(result)
    : { handshook: false, hasLeaf: false }

  if (!result && !error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-xs" style={{ color: 'var(--hint)' }}>
          {t('tools.tlsInspect.emptyState')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      {error && (
        <div className="rounded px-3 py-2 text-[11px]" style={{ background: RED_BG, color: RED }}>
          {error}
        </div>
      )}

      {result && hasLeaf && (
        <>
          <div className="flex flex-wrap gap-2">
            {result.authorized ? (
              <Badge bg={GREEN_BG} color={GREEN}>
                {t('tools.tlsInspect.trusted')}
              </Badge>
            ) : (
              <Badge bg={AMBER_BG} color={AMBER}>
                {t('tools.tlsInspect.notValidated')}
              </Badge>
            )}
            <Badge
              bg={result.hostnameValid ? GREEN_BG : RED_BG}
              color={result.hostnameValid ? GREEN : RED}
            >
              {(result.hostnameValid
                ? t('tools.tlsInspect.hostnameOkFor')
                : t('tools.tlsInspect.hostnameBadFor')
              ).replace('{name}', result.servername || result.host)}
            </Badge>
            <ValidityBadge result={result} />
            {result.selfSigned && (
              <Badge bg={AMBER_BG} color={AMBER}>
                {t('tools.tlsInspect.selfSigned')}
              </Badge>
            )}
          </div>

          {!result.authorized && result.authorizationError && (
            <div>
              <Caption>{t('tools.tlsInspect.authError')}</Caption>
              <div className="break-all font-mono text-[11px]" style={{ color: RED }}>
                {result.authorizationError}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Meta
              label={t('tools.tlsInspect.expiresIn')}
              value={
                result.expired
                  ? t('tools.tlsInspect.expiredAgo').replace(
                      '{n}',
                      String(Math.abs(result.daysToExpiry)),
                    )
                  : t('tools.tlsInspect.inDays').replace('{n}', String(result.daysToExpiry))
              }
            />
          </div>
        </>
      )}

      {/*
        Transport facts, shown whenever the handshake completed — they are real
        even when the server presents no certificate. Certificate verdicts above
        are gated separately: those placeholders would otherwise be read as
        findings.
      */}
      {result && handshook && (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Meta label={t('tools.tlsInspect.protocol')} value={result.protocol ?? '—'} />
            <Meta
              label={t('tools.tlsInspect.cipher')}
              value={result.cipher ? result.cipher.name : '—'}
            />
            <Meta
              label={t('tools.tlsInspect.alpn')}
              value={result.alpnProtocol === false ? '—' : result.alpnProtocol}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Caption>{t('tools.tlsInspect.chain')}</Caption>
              <span className="text-[10px]" style={{ color: 'var(--hint)' }}>
                {t('tools.tlsInspect.presentedNote')}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {result.chain.map((c, i) => (
                <div
                  key={`${c.sha256Fingerprint}-${i}`}
                  className="flex items-center gap-2 rounded border px-2.5 py-1.5"
                  style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
                >
                  <button
                    onClick={() => onOpenCert(i)}
                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                  >
                    <span
                      className="truncate text-xs font-medium"
                      style={{ color: 'var(--accentText)' }}
                    >
                      {i === 0 ? `${t('tools.tlsInspect.leaf')} · ` : ''}
                      {c.subjectDN}
                    </span>
                    <span className="truncate text-[10px]" style={{ color: 'var(--muted)' }}>
                      {t('tools.tlsInspect.issuedBy')} {c.issuerDN}
                    </span>
                  </button>
                  <button
                    onClick={() => onAddTrusted(c)}
                    className="shrink-0 rounded border px-2 py-0.5 text-[10px]"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'var(--white)',
                      color: 'var(--accentText)',
                    }}
                    title={t('tools.tlsInspect.addTrusted')}
                  >
                    {t('tools.tlsInspect.addTrusted')}
                  </button>
                </div>
              ))}
              {result.chain.length === 0 && (
                <span className="text-xs" style={{ color: 'var(--hint)' }}>
                  {t('tools.tlsInspect.noChain')}
                </span>
              )}
            </div>
          </div>

          {/*
            Authoritative values from the RESPONSE, not the local form. The
            connection goes to `host` while the certificate is validated against
            the SNI name, so when they differ the screen has to say which is
            which — a leaf for example.com under a docs.apinizer.com inspection
            otherwise reads as "docs.apinizer.com is example.com".
          */}
          <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
            {result.host}:{result.port}
            {result.servername && result.servername !== result.host
              ? ` · SNI: ${result.servername}`
              : ''}{' '}
            · {t('tools.tlsInspect.presentedFooter')}
          </p>
          {result.servername && result.servername !== result.host && (
            <p className="text-[10px]" style={{ color: AMBER }}>
              {t('tools.tlsInspect.sniDiffers')
                .replace('{host}', result.host)
                .replace('{sni}', result.servername)}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function ValidityBadge({ result }: { result: TlsInspectResult }) {
  const { t } = useTranslation()
  const map = {
    valid: { bg: GREEN_BG, color: GREEN, key: 'tools.tlsInspect.valid' },
    expiring: { bg: AMBER_BG, color: AMBER, key: 'tools.tlsInspect.expiring' },
    expired: { bg: RED_BG, color: RED, key: 'tools.tlsInspect.expired' },
  } as const
  const s = map[result.validityStatus]
  return (
    <Badge bg={s.bg} color={s.color}>
      {t(s.key)}
    </Badge>
  )
}

// ── add-as-trusted → keystore session ────────────────────────────────────────
