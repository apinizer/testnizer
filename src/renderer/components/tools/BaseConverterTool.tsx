import { useState } from 'react'
import ToolShell from './ToolShell'
import { useTranslation } from '../../lib/i18n'
import {
  bytesToAll,
  EMPTY_FIELDS as EMPTY,
  parseToBytes,
  type Fields,
  type Source,
} from '../../lib/tools/base-converter'

/**
 * Convert string ↔ binary / decimal / hexadecimal / ASCII representations.
 *
 * Encoding choices:
 *   - ASCII / text  ↔ space-separated byte values per representation
 *   - Each byte rendered with consistent width (8 bin, 3 oct, 3 dec, 2 hex)
 *   - For pure-numeric inputs (e.g. user types `255` in dec) we still go
 *     through bytes — this matches the canonical "bin/dec/hex/ascii" tool
 *     behaviour where the input is interpreted as a sequence of bytes.
 */
export default function BaseConverterTool() {
  const { t } = useTranslation()
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  function recompute(source: Source, raw: string): void {
    if (raw.trim() === '') {
      setFields(EMPTY)
      setError(null)
      return
    }
    try {
      const bytes = parseToBytes(source, raw)
      setFields(bytesToAll(bytes))
      setError(null)
    } catch (e) {
      // Keep the user's typed value, blank the others until valid.
      setFields({ ...EMPTY, [source]: raw })
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <ToolShell
      title={t('tools.base.title')}
      toolbar={
        <button
          onClick={() => {
            setFields(EMPTY)
            setError(null)
          }}
          className="rounded border px-2 py-1 text-xs"
          style={{
            borderColor: 'var(--border)',
            color: 'var(--muted)',
            background: 'var(--white)',
          }}
        >
          {t('tools.common.clear')}
        </button>
      }
      inputPane={
        <div className="flex h-full flex-col overflow-auto p-4 space-y-3">
          <Field
            label={t('tools.base.ascii')}
            sublabel={t('tools.base.asciiSub')}
            value={fields.ascii}
            mono={false}
            placeholder="Hello"
            onChange={(v) => recompute('ascii', v)}
          />
          <Field
            label={t('tools.base.binary')}
            sublabel={t('tools.base.binarySub')}
            value={fields.bin}
            placeholder="01001000 01100101 01101100 01101100 01101111"
            onChange={(v) => recompute('bin', v)}
          />
          <Field
            label={t('tools.base.octal')}
            sublabel={t('tools.base.octalSub')}
            value={fields.oct}
            placeholder="110 145 154 154 157"
            onChange={(v) => recompute('oct', v)}
          />
          <Field
            label={t('tools.base.decimal')}
            sublabel={t('tools.base.decimalSub')}
            value={fields.dec}
            placeholder="72 101 108 108 111"
            onChange={(v) => recompute('dec', v)}
          />
          <Field
            label={t('tools.base.hex')}
            sublabel={t('tools.base.hexSub')}
            value={fields.hex}
            placeholder="48 65 6c 6c 6f"
            onChange={(v) => recompute('hex', v)}
          />
          {error ? (
            <div
              className="rounded border px-3 py-2 text-xs"
              style={{ borderColor: '#cc220040', background: '#cc220015', color: '#cc2200' }}
            >
              {error}
            </div>
          ) : null}
        </div>
      }
      outputPane={
        <div className="h-full overflow-auto p-4 text-sm" style={{ color: 'var(--muted)' }}>
          <h3 className="m-0 mb-2 text-base font-semibold" style={{ color: 'var(--heading)' }}>
            {t('tools.base.notesTitle')}
          </h3>
          <ul className="my-0 list-disc pl-5 space-y-1.5">
            <li>{t('tools.base.note1')}</li>
            <li>{t('tools.base.note2')}</li>
            <li>{t('tools.base.note3')}</li>
            <li>{t('tools.base.note4')}</li>
          </ul>
          <h4 className="mb-1 mt-4 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
            {t('tools.base.examplesTitle')}
          </h4>
          <table className="w-full border-collapse font-mono text-xs">
            <thead>
              <tr style={{ background: 'var(--surface)' }}>
                <th
                  className="border-b px-2 py-1 text-left"
                  style={{ borderColor: 'var(--border)' }}
                >
                  ASCII
                </th>
                <th
                  className="border-b px-2 py-1 text-left"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Bin
                </th>
                <th
                  className="border-b px-2 py-1 text-left"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Dec
                </th>
                <th
                  className="border-b px-2 py-1 text-left"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Hex
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ['A', '01000001', '65', '41'],
                ['0', '00110000', '48', '30'],
                [' ', '00100000', '32', '20'],
                ['€', '— (multi-byte)', '— (UTF-8)', 'e2 82 ac'],
              ].map((r) => (
                <tr key={r[0]}>
                  <td className="border-b px-2 py-1" style={{ borderColor: 'var(--border)' }}>
                    {r[0]}
                  </td>
                  <td className="border-b px-2 py-1" style={{ borderColor: 'var(--border)' }}>
                    {r[1]}
                  </td>
                  <td className="border-b px-2 py-1" style={{ borderColor: 'var(--border)' }}>
                    {r[2]}
                  </td>
                  <td className="border-b px-2 py-1" style={{ borderColor: 'var(--border)' }}>
                    {r[3]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    />
  )
}

function Field({
  label,
  sublabel,
  value,
  placeholder,
  mono = true,
  onChange,
}: {
  label: string
  sublabel: string
  value: string
  placeholder: string
  mono?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: 'var(--text)' }}
        >
          {label}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
          {sublabel}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full rounded border px-2 py-1 text-xs"
        style={{
          background: 'var(--white)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          resize: 'vertical',
        }}
      />
    </div>
  )
}
