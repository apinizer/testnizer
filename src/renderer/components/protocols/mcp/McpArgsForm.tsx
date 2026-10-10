import { useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import { testIdSlug } from '../../../lib/mcp-store-helpers'
import {
  REMOVE,
  argsPathText,
  getAtPath,
  leafText,
  leafValue,
  type ArgsNode,
  type ArgsPath,
} from '../../../lib/mcp-args-form'
import type { ElicitField } from '../../../lib/mcp-elicitation'
import McpElicitField from './McpElicitField'

const slug = (path: ArgsPath): string => testIdSlug(argsPathText(path))

/** Does the input's text still mean the stored value? (else the JSON changed underneath) */
function sameValue(fromDraft: unknown, stored: unknown): boolean {
  if (fromDraft === REMOVE) return stored === undefined
  return fromDraft === stored
}

/**
 * A leaf input. It keeps the typed text while it still means the stored
 * value, so `1.0` on the way to `1.05` is not rewritten to `1` under the
 * cursor; an edit made elsewhere (JSON view, restore) shows through.
 */
function Leaf({
  field,
  value,
  testId,
  invalid,
  label,
  onChange,
}: {
  field: ElicitField
  value: unknown
  testId: string
  invalid: boolean
  label?: ReactNode
  onChange: (v: unknown) => void
}) {
  const { t } = useTranslation()
  const external = leafText(field, value)
  const [draft, setDraft] = useState<string | boolean>(external)
  const shown = sameValue(leafValue(field, draft), value) ? draft : external
  const placeholder =
    value === undefined && field.default !== undefined
      ? t('mcp.args.defaultHint').replace('{value}', String(field.default))
      : undefined
  return (
    <McpElicitField
      requestKey="args"
      field={field}
      value={shown}
      invalid={invalid}
      testId={testId}
      allowTemplates
      placeholder={placeholder}
      label={label}
      onChange={(v) => {
        setDraft(v)
        onChange(leafValue(field, v))
      }}
    />
  )
}

function emptyItem(item: ElicitField): unknown {
  if (item.kind === 'boolean') return false
  if (item.kind === 'enum') return leafValue(item, item.options?.[0]?.value ?? '')
  return ''
}

function ArrayNode({
  node,
  value,
  invalidPaths,
  onPatch,
}: {
  node: Extract<ArgsNode, { kind: 'array' }>
  value: unknown
  invalidPaths: ReadonlySet<string>
  onPatch: (path: ArgsPath, v: unknown) => void
}) {
  const { t } = useTranslation()
  const rows = Array.isArray(value) ? value : []
  const id = slug(node.path)
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--muted)]">
        {node.title || node.name}
        {node.required && <span className="text-[var(--red)]">*</span>}
        {node.title && <span className="font-mono text-[10px]">{node.name}</span>}
      </span>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <Leaf
              field={node.item}
              value={row}
              testId={`mcp-arg-${id}-${i}`}
              invalid={invalidPaths.has(argsPathText([...node.path, i]))}
              label={null}
              onChange={(v) => onPatch([...node.path, i], v === REMOVE ? '' : v)}
            />
          </div>
          <button
            type="button"
            data-testid={`mcp-arg-${id}-remove-${i}`}
            aria-label={t('mcp.args.removeItem')}
            title={t('mcp.args.removeItem')}
            onClick={() =>
              // The last row of an optional array takes the key with it: an
              // empty optional field is not sent (#162 follow-up).
              onPatch(rows.length === 1 && !node.required ? node.path : [...node.path, i], REMOVE)
            }
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[var(--muted)] hover:bg-[var(--surface)]"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid={`mcp-arg-${id}-add`}
        onClick={() => onPatch([...node.path, rows.length], emptyItem(node.item))}
        className="flex cursor-pointer items-center gap-1 self-start rounded border border-dashed border-[var(--border)] bg-transparent px-2 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--surface)]"
      >
        <Plus size={11} />
        {t('mcp.args.addItem')}
      </button>
      {node.description && (
        <span className="text-[11px] text-[var(--hint)]">{node.description}</span>
      )}
    </div>
  )
}

/**
 * The schema-driven tool arguments (issue #162): one input per leaf, rows for
 * arrays of primitives, an indented group per nested object. `value` is the
 * parsed `toolArgs`; every edit goes back through `onPatch(path, value)`.
 */
export default function McpArgsForm({
  nodes,
  value,
  invalidPaths,
  onPatch,
}: {
  nodes: ArgsNode[]
  value: unknown
  invalidPaths: ReadonlySet<string>
  onPatch: (path: ArgsPath, v: unknown) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const v = getAtPath(value, node.path)
        if (node.kind === 'leaf') {
          return (
            <Leaf
              key={node.name}
              field={node.field}
              value={v}
              testId={`mcp-arg-${slug(node.path)}`}
              invalid={invalidPaths.has(argsPathText(node.path))}
              onChange={(next) => onPatch(node.path, next)}
            />
          )
        }
        if (node.kind === 'array') {
          return (
            <ArrayNode
              key={node.name}
              node={node}
              value={v}
              invalidPaths={invalidPaths}
              onPatch={onPatch}
            />
          )
        }
        return (
          <fieldset
            key={node.name}
            data-testid={`mcp-arg-group-${slug(node.path)}`}
            className="m-0 flex flex-col gap-2 border-y-0 border-r-0 border-l-2 border-solid border-[var(--border)] py-0 pl-3 pr-0"
          >
            <legend className="mb-1 p-0 text-[11px] font-medium text-[var(--muted)]">
              {node.title || node.name}
              {node.required && <span className="text-[var(--red)]"> *</span>}
            </legend>
            {node.description && (
              <span className="text-[11px] text-[var(--hint)]">{node.description}</span>
            )}
            <McpArgsForm
              nodes={node.children}
              value={value}
              invalidPaths={invalidPaths}
              onPatch={onPatch}
            />
          </fieldset>
        )
      })}
    </>
  )
}
