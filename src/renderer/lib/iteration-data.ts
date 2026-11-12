/**
 * The Runner's iteration data file: a JSON array of row objects or a CSV, turned
 * into one `{column: value}` row per iteration. A bad file throws a message for
 * the user; it never falls back to a single run without saying so.
 *
 * The file is the user's, in whatever shape Excel or another tool wrote it: a
 * BOM ("CSV UTF-8"), `;` as the delimiter (Turkish and EU locales), line breaks
 * inside quoted cells. A JSON file's values stay as parsed, as in Postman:
 * `pm.iterationData.get('user').id` works, and `{{user}}` writes the JSON text.
 */
import { parse as parseCsv } from 'csv-parse/sync'
import { fillTemplate } from '../../shared/fill-template'

type Translate = (key: string) => string

/** A larger file would be read whole, then copied to main for the run. */
export const MAX_ITERATION_FILE_BYTES = 50 * 1024 * 1024
export const MAX_ITERATION_ROWS = 100_000

const BOM = '\uFEFF'
const DELIMITERS = [',', ';', '\t']

/** Refuse an oversized file before it is read into memory. */
export function assertIterationFileSize(size: number, t: Translate): void {
  if (size > MAX_ITERATION_FILE_BYTES) {
    throw new Error(
      fillTemplate(t('runnerConfig.dataTooLarge'), {
        max: String(MAX_ITERATION_FILE_BYTES / (1024 * 1024)),
      }),
    )
  }
}

/** Parse iteration data from a Postman-compatible JSON array or a CSV. */
export function parseIterationData(
  text: string,
  filename: string,
  t: Translate,
): Record<string, unknown>[] {
  const lower = filename.toLowerCase()
  const isJson = lower.endsWith('.json')
  if (!isJson && !lower.endsWith('.csv')) throw new Error(t('runnerConfig.dataUnsupported'))
  // A NUL never occurs in a text file: this is binary, or UTF-16 read as UTF-8.
  if (text.includes('\u0000')) throw new Error(t('runnerConfig.dataNotText'))
  const body = text.startsWith(BOM) ? text.slice(1) : text
  const rows = isJson ? parseJsonRows(body, t) : parseCsvRows(body, t)
  if (rows.length > MAX_ITERATION_ROWS) {
    throw new Error(
      fillTemplate(t('runnerConfig.dataTooManyRows'), { max: String(MAX_ITERATION_ROWS) }),
    )
  }
  return rows
}

function parseJsonRows(body: string, t: Translate): Record<string, unknown>[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (e) {
    throw new Error(fillTemplate(t('runnerConfig.jsonInvalid'), { detail: (e as Error).message }))
  }
  if (!Array.isArray(parsed)) throw new Error(t('runnerConfig.dataNotArray'))
  if (parsed.length === 0) throw new Error(t('runnerConfig.dataEmpty'))
  return parsed.map((row: unknown, i) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(fillTemplate(t('runnerConfig.dataRowNotObject'), { index: String(i + 1) }))
    }
    return row as Record<string, unknown>
  })
}

function parseCsvRows(body: string, t: Translate): Record<string, string>[] {
  let records: string[][]
  try {
    records = parseCsv(body, {
      delimiter: detectDelimiter(body),
      relax_column_count: true,
      // A stray `"` inside an unquoted cell (5" screen) is text, not an error.
      relax_quotes: true,
      skip_empty_lines: true,
      skip_records_with_empty_values: true,
    }) as string[][]
  } catch (e) {
    throw new Error(fillTemplate(t('runnerConfig.csvInvalid'), { detail: (e as Error).message }))
  }
  const [headers = [], ...rows] = records
  // A trailing delimiter makes an unnamed column; it cannot be a variable.
  const columns = headers.flatMap((name, i) => (name ? [{ name, i }] : []))
  if (columns.length === 0 || rows.length === 0) throw new Error(t('runnerConfig.csvTooShort'))
  return rows.map((cells) => {
    const out: Record<string, string> = {}
    for (const { name, i } of columns) out[name] = cells[i] ?? ''
    return out
  })
}

/** The delimiter used most in the header line, counting only outside quotes. */
function detectDelimiter(body: string): string {
  const counts = new Map<string, number>()
  let inQuotes = false
  for (const c of body.trimStart()) {
    if (c === '"') inQuotes = !inQuotes
    else if (!inQuotes && (c === '\n' || c === '\r')) break
    else if (!inQuotes && DELIMITERS.includes(c)) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let best = DELIMITERS[0]
  for (const d of DELIMITERS) if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d
  return best
}
