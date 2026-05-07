import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'

// Lazy-load the heavy Monaco-based implementation. Splitting it out keeps
// `monaco-editor` (~5–6 MB) out of the initial renderer chunk; it gets fetched
// the first time something actually mounts a Monaco editor.
const MonacoWrapperImpl = lazy(() => import('./MonacoWrapperImpl'))

type MonacoWrapperProps = ComponentProps<typeof MonacoWrapperImpl>

/**
 * Lightweight skeleton shown while the Monaco chunk is being fetched. Mimics
 * the editor's gutter + content layout so the surrounding UI doesn't reflow.
 */
function MonacoFallback({
  height = '100%',
  className,
}: Pick<MonacoWrapperProps, 'height' | 'className'>) {
  return (
    <div
      className={className}
      style={{ height }}
      aria-busy="true"
      aria-label="Loading editor"
    >
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          background: 'var(--surface, #fafafa)',
          border: '1px solid var(--border, #e8e8ed)',
          borderRadius: 4,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--hint, #bbbbbb)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: 32,
            background: 'var(--bg, #f5f5f7)',
            borderRight: '1px solid var(--border, #e8e8ed)',
            padding: '6px 0',
            textAlign: 'right',
            paddingRight: 6,
            lineHeight: '18px',
            userSelect: 'none',
          }}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <div
          style={{
            flex: 1,
            padding: '6px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          Loading editor…
        </div>
      </div>
    </div>
  )
}

export default function MonacoWrapper(props: MonacoWrapperProps) {
  return (
    <Suspense
      fallback={
        <MonacoFallback height={props.height} className={props.className} />
      }
    >
      <MonacoWrapperImpl {...props} />
    </Suspense>
  )
}
