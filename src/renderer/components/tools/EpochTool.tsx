import { useEffect, useMemo, useState } from 'react'
import ToolShell from './ToolShell'
import {
  detectUnit,
  epochToDate,
  formatLocal,
  formatUtc,
  fromParts,
  localTzLabel,
  relative,
  type EpochUnit,
} from '../../lib/tools/epoch'
import { useTranslation } from '../../lib/i18n'

export default function EpochTool() {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  // Live ticker for the "current epoch" header.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Section A: epoch → date
  const [tsInput, setTsInput] = useState(String(now))
  const [tsUnit, setTsUnit] = useState<EpochUnit | 'auto'>('auto')

  // Section B: date → epoch
  const initial = useMemo(() => new Date(), [])
  const [yr, setYr] = useState(initial.getUTCFullYear())
  const [mo, setMo] = useState(initial.getUTCMonth() + 1)
  const [day, setDay] = useState(initial.getUTCDate())
  const [hr, setHr] = useState(initial.getUTCHours())
  const [mi, setMi] = useState(initial.getUTCMinutes())
  const [se, setSe] = useState(initial.getUTCSeconds())
  const [zone, setZone] = useState<'gmt' | 'local'>('gmt')

  const parsedTs = Number(tsInput)
  const tsValid = !Number.isNaN(parsedTs) && tsInput.trim() !== ''
  const decoded = tsValid ? epochToDate(parsedTs, tsUnit) : null
  const detectedUnit = tsValid ? detectUnit(parsedTs) : null

  const composed = fromParts({ y: yr, mo, d: day, h: hr, mi, s: se }, zone)
  const composedSec = Math.floor(composed.getTime() / 1000)
  const composedMs = composed.getTime()

  const toolbar = (
    <button
      onClick={() => {
        const cur = Math.floor(Date.now() / 1000)
        setTsInput(String(cur))
        setTsUnit('auto')
        const d = new Date()
        if (zone === 'gmt') {
          setYr(d.getUTCFullYear())
          setMo(d.getUTCMonth() + 1)
          setDay(d.getUTCDate())
          setHr(d.getUTCHours())
          setMi(d.getUTCMinutes())
          setSe(d.getUTCSeconds())
        } else {
          setYr(d.getFullYear())
          setMo(d.getMonth() + 1)
          setDay(d.getDate())
          setHr(d.getHours())
          setMi(d.getMinutes())
          setSe(d.getSeconds())
        }
      }}
      className="rounded border px-2 py-1 text-xs"
      style={{ borderColor: 'var(--border)', color: 'var(--text)', background: 'var(--white)' }}
    >
      {t('tools.epoch.useNow')}
    </button>
  )

  return (
    <ToolShell
      title={t('tools.epoch.title')}
      toolbar={toolbar}
      inputLabel={t('tools.epoch.timestampToDate')}
      outputLabel={t('tools.epoch.dateToTimestamp')}
      inputPane={
        <div className="flex h-full flex-col overflow-auto p-4">
          <div
            className="mb-4 flex items-center gap-2 rounded border p-2 text-xs"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <span style={{ color: 'var(--muted)' }}>{t('tools.epoch.currentEpoch')}:</span>
            <span
              className="rounded border px-2 py-0.5 font-mono font-semibold"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--white)',
                color: 'var(--text)',
              }}
            >
              {now}
            </span>
            <CopyButton text={String(now)} />
          </div>

          <label className="mb-1 text-xs" style={{ color: 'var(--muted)' }}>
            {t('tools.epoch.timestamp')}
          </label>
          <div className="mb-3 flex items-center gap-2">
            <input
              type="text"
              value={tsInput}
              onChange={(e) => setTsInput(e.target.value)}
              placeholder="1735689600"
              className="flex-1 rounded border px-2 py-1 font-mono text-sm"
              style={{
                background: 'var(--white)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
            <select
              value={tsUnit}
              onChange={(e) => setTsUnit(e.target.value as EpochUnit | 'auto')}
              className="rounded border px-2 py-1 text-xs"
              style={{
                background: 'var(--white)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            >
              <option value="auto">{t('tools.epoch.unitAuto')}</option>
              <option value="seconds">{t('tools.epoch.seconds')}</option>
              <option value="milliseconds">{t('tools.epoch.milliseconds')}</option>
              <option value="microseconds">{t('tools.epoch.microseconds')}</option>
              <option value="nanoseconds">{t('tools.epoch.nanoseconds')}</option>
            </select>
          </div>

          {!tsValid ? (
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              {t('tools.epoch.timestampHint')}
            </div>
          ) : decoded && isNaN(decoded.date.getTime()) ? (
            <div className="text-sm" style={{ color: '#cc2200' }}>
              {t('tools.epoch.invalidTimestamp')}
            </div>
          ) : decoded ? (
            <div
              className="space-y-1.5 rounded border p-3 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <Row
                label={t('tools.epoch.assuming')}
                value={
                  <span style={{ color: 'var(--accentText)' }}>
                    {tsUnit === 'auto'
                      ? `${detectedUnit} ${t('tools.epoch.autoDetected')}`
                      : decoded.unit}
                  </span>
                }
              />
              <Row label="GMT" value={formatUtc(decoded.date)} copy={decoded.date.toISOString()} />
              <Row
                label={`${t('tools.epoch.yourZone')} (${localTzLabel()})`}
                value={formatLocal(decoded.date)}
              />
              <Row label={t('tools.epoch.relative')} value={relative(decoded.date)} />
              <Row
                label="ISO 8601"
                value={decoded.date.toISOString()}
                copy={decoded.date.toISOString()}
              />
            </div>
          ) : null}
        </div>
      }
      outputPane={
        <div className="flex h-full flex-col overflow-auto p-4">
          <label className="mb-1 text-xs" style={{ color: 'var(--muted)' }}>
            {t('tools.epoch.dateParts')}
          </label>
          <div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
            <NumberField label="Yr" value={yr} setValue={setYr} width={70} />
            <NumberField label="Mon" value={mo} setValue={setMo} width={50} />
            <NumberField label="Day" value={day} setValue={setDay} width={50} />
            <NumberField label="Hr" value={hr} setValue={setHr} width={50} />
            <NumberField label="Min" value={mi} setValue={setMi} width={50} />
            <NumberField label="Sec" value={se} setValue={setSe} width={50} />
            <select
              value={zone}
              onChange={(e) => setZone(e.target.value as 'gmt' | 'local')}
              className="rounded border px-2 py-1"
              style={{
                background: 'var(--white)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            >
              <option value="gmt">GMT</option>
              <option value="local">{t('tools.epoch.localZone')}</option>
            </select>
          </div>

          <div
            className="space-y-1.5 rounded border p-3 text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            <Row
              label={t('tools.epoch.epochSec')}
              value={String(composedSec)}
              copy={String(composedSec)}
              mono
            />
            <Row
              label={t('tools.epoch.epochMs')}
              value={String(composedMs)}
              copy={String(composedMs)}
              mono
            />
            <Row label="GMT" value={formatUtc(composed)} />
            <Row
              label={`${t('tools.epoch.yourZone')} (${localTzLabel()})`}
              value={formatLocal(composed)}
            />
            <Row
              label="ISO 8601"
              value={composed.toISOString()}
              copy={composed.toISOString()}
              mono
            />
          </div>
        </div>
      }
    />
  )
}

function NumberField({
  label,
  value,
  setValue,
  width,
}: {
  label: string
  value: number
  setValue: (n: number) => void
  width: number
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(Number(e.target.value) || 0)}
        className="rounded border px-2 py-1 font-mono"
        style={{
          width,
          background: 'var(--white)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      />
    </div>
  )
}

function Row({
  label,
  value,
  copy,
  mono,
}: {
  label: string
  value: React.ReactNode
  copy?: string
  mono?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 text-xs" style={{ color: 'var(--muted)', minWidth: 110 }}>
        {label}:
      </span>
      <span
        className="flex-1 break-all"
        style={{ color: 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined }}
      >
        {value}
      </span>
      {copy ? <CopyButton text={copy} /> : null}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          /* ignore */
        }
      }}
      title={copied ? t('tools.common.copied') : t('tools.common.copy')}
      className="rounded border px-1.5 py-0.5 text-[11px]"
      style={{
        borderColor: 'var(--border)',
        color: copied ? '#1a7a4a' : 'var(--muted)',
        background: 'var(--white)',
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}
