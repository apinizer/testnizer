import { useState } from 'react'
import { Search, ChevronRight, Hash, List, Box } from 'lucide-react'
import type { GqlSchema, GqlType, GqlField } from '../../stores/graphql.store'

interface Props {
  schemaData: GqlSchema | null
  error: string | null
}

export default function GraphQLSchemaExplorer({ schemaData, error }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedTypeName, setSelectedTypeName] = useState<string | null>(null)

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="text-red-500">{error}</span>
      </div>
    )
  }

  if (!schemaData) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--hint)]">
        <Search size={20} />
        <span>Click "Introspect" to load the schema</span>
      </div>
    )
  }

  const filteredTypes = schemaData.types.filter((t) =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const selectedType = schemaData.types.find((t) => t.name === selectedTypeName)

  // Group types
  const rootTypes = [schemaData.queryType, schemaData.mutationType, schemaData.subscriptionType].filter(Boolean)
  const queryTypes = filteredTypes.filter((t) => rootTypes.includes(t.name))
  const objectTypes = filteredTypes.filter((t) => t.kind === 'OBJECT' && !rootTypes.includes(t.name))
  const inputTypes = filteredTypes.filter((t) => t.kind === 'INPUT_OBJECT')
  const enumTypes = filteredTypes.filter((t) => t.kind === 'ENUM')
  const scalarTypes = filteredTypes.filter((t) => t.kind === 'SCALAR')

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: type list */}
      <div className="flex w-[180px] shrink-0 flex-col border-r border-[var(--border)]">
        {/* Search */}
        <div className="shrink-0 border-b border-[var(--border)] p-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1">
            <Search size={12} className="shrink-0 text-[var(--hint)]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter types..."
              className="w-full border-none bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--hint)]"
            />
          </div>
        </div>

        {/* Types list */}
        <div className="flex-1 overflow-y-auto">
          <TypeSection
            label="Root Types"
            types={queryTypes}
            selected={selectedTypeName}
            onSelect={setSelectedTypeName}
            icon={<Box size={11} />}
          />
          <TypeSection
            label="Objects"
            types={objectTypes}
            selected={selectedTypeName}
            onSelect={setSelectedTypeName}
            icon={<Hash size={11} />}
          />
          <TypeSection
            label="Input Objects"
            types={inputTypes}
            selected={selectedTypeName}
            onSelect={setSelectedTypeName}
            icon={<ChevronRight size={11} />}
          />
          <TypeSection
            label="Enums"
            types={enumTypes}
            selected={selectedTypeName}
            onSelect={setSelectedTypeName}
            icon={<List size={11} />}
          />
          {scalarTypes.length > 0 && (
            <TypeSection
              label="Scalars"
              types={scalarTypes}
              selected={selectedTypeName}
              onSelect={setSelectedTypeName}
              icon={<Hash size={11} />}
            />
          )}
        </div>
      </div>

      {/* Right: type detail */}
      <div className="flex-1 overflow-y-auto p-3">
        {selectedType ? (
          <TypeDetail type={selectedType} onNavigate={setSelectedTypeName} />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--hint)]">
            Select a type to view its details
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Type Section ────────────────────────────────────────────

function TypeSection({
  label,
  types,
  selected,
  onSelect,
  icon,
}: {
  label: string
  types: GqlType[]
  selected: string | null
  onSelect: (name: string) => void
  icon: React.ReactNode
}) {
  if (types.length === 0) return null

  return (
    <div className="border-b border-[var(--border)]">
      <div className="px-2.5 py-1.5 font-semibold uppercase tracking-wider text-[var(--hint)]">
        {label} ({types.length})
      </div>
      {types.map((t) => (
        <button
          key={t.name}
          type="button"
          onClick={() => onSelect(t.name)}
          className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1 text-left transition-colors"
          style={{
            background: selected === t.name ? 'var(--accent-light)' : 'transparent',
            color: selected === t.name ? 'var(--accent-text)' : 'var(--text)',
            border: 'none',
          }}
        >
          <span className="shrink-0 text-[var(--muted)]">{icon}</span>
          <span className="truncate">{t.name}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Type Detail ─────────────────────────────────────────────

function TypeDetail({
  type,
  onNavigate,
}: {
  type: GqlType
  onNavigate: (name: string) => void
}) {
  return (
    <div>
      {/* Type header */}
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-[var(--text)]">{type.name}</h3>
          <span
            className="rounded px-1.5 py-0.5 font-medium uppercase"
            style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}
          >
            {type.kind}
          </span>
        </div>
        {type.description && (
          <p className="mt-1 text-[var(--muted)]">{type.description}</p>
        )}
      </div>

      {/* Enum values */}
      {type.enumValues && type.enumValues.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 font-semibold text-[var(--muted)]">Values</div>
          <div className="flex flex-wrap gap-1">
            {type.enumValues.map((val) => (
              <span
                key={val}
                className="rounded px-2 py-0.5 font-mono"
                style={{ background: 'var(--surface)', color: 'var(--orange)' }}
              >
                {val}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Fields */}
      {type.fields.length > 0 && (
        <div>
          <div className="mb-1.5 font-semibold text-[var(--muted)]">
            Fields ({type.fields.length})
          </div>
          <div className="space-y-1">
            {type.fields.map((field) => (
              <FieldRow key={field.name} field={field} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Field Row ───────────────────────────────────────────────

function FieldRow({
  field,
  onNavigate,
}: {
  field: GqlField
  onNavigate: (name: string) => void
}) {
  const typeName = field.type.replace(/[[\]!]/g, '')

  return (
    <div className="rounded-lg border border-[var(--border)] px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono font-medium text-[var(--text)]">
          {field.name}
        </span>
        <button
          type="button"
          onClick={() => onNavigate(typeName)}
          className="cursor-pointer font-mono transition-colors hover:underline"
          style={{ color: 'var(--accent-text)', background: 'transparent', border: 'none', padding: 0 }}
        >
          {field.type}
        </button>
      </div>

      {field.description && (
        <p className="mt-0.5 text-[var(--muted)]">{field.description}</p>
      )}

      {field.args.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          <span className="font-medium text-[var(--hint)]">Arguments:</span>
          {field.args.map((arg) => (
            <div key={arg.name} className="flex items-baseline gap-1.5 pl-2">
              <span className="font-mono text-[var(--text)]">{arg.name}</span>
              <span className="font-mono" style={{ color: 'var(--orange)' }}>
                {arg.type}
              </span>
              {arg.description && (
                <span className="text-[var(--hint)]">— {arg.description}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
