import { Component, type ReactNode, type ErrorInfo } from 'react'

/**
 * Top-level error boundary.
 *
 * Without this, any uncaught render error in a deep child unmounts the entire
 * React tree and leaves the user staring at a blank white window — with no
 * obvious way out, because the persisted Zustand stores re-hydrate the same
 * broken state on the next launch, perpetuating the crash.
 *
 * The boundary catches the error, shows a recovery panel, and gives the user
 * three escalating self-help options:
 *
 *   1. Reload — try the same state again (fixes transient render races).
 *   2. Clear local UI state — wipe localStorage + sessionStorage. The SQLite
 *      database is untouched, so all projects / requests / history survive;
 *      only the per-tab UI snapshots, view filters, and panel sizes reset.
 *   3. Copy error — drop the stack to clipboard so the user can paste it
 *      into a bug report. We do not autosend telemetry.
 */

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

interface ErrorBoundaryProps {
  children: ReactNode
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })

    console.error('[ErrorBoundary] render crash:', error, errorInfo)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  handleClearState = (): void => {
    try {
      // Drop every persisted UI snapshot. The DB stays intact.
      localStorage.clear()
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
    window.location.reload()
  }

  handleCopyError = async (): Promise<void> => {
    const { error, errorInfo } = this.state
    const payload = [
      `Testnizer renderer crash`,
      `Time: ${new Date().toISOString()}`,
      ``,
      `Error: ${error?.name}: ${error?.message}`,
      ``,
      `Stack:`,
      error?.stack ?? '(no stack)',
      ``,
      `Component stack:`,
      errorInfo?.componentStack ?? '(no component stack)',
    ].join('\n')
    try {
      await navigator.clipboard.writeText(payload)
    } catch {
      /* ignore — user is on a context that doesn't allow clipboard */
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    const { error } = this.state
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#f5f5f7',
          color: '#1a1a2e',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 560,
            width: '100%',
            background: '#ffffff',
            border: '1px solid #e8e8ed',
            borderRadius: 12,
            padding: 28,
            boxShadow: '0 20px 60px rgba(0,0,0,0.10)',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            Testnizer hit a render error
          </div>
          <p style={{ color: '#666', marginBottom: 16, lineHeight: 1.5 }}>
            The window is recovering instead of staying blank. Your projects, requests, environments
            and history are stored in the local database and are <strong>not affected</strong> —
            only the in-memory UI state crashed.
          </p>

          <pre
            style={{
              fontSize: 12,
              background: '#fafafa',
              border: '1px solid #e8e8ed',
              borderRadius: 6,
              padding: 10,
              margin: '0 0 16px',
              maxHeight: 160,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              color: '#cc2200',
            }}
          >
            {error?.name}: {error?.message}
          </pre>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                background: '#7c73e6',
                color: '#fff',
                border: 'none',
                borderRadius: 7,
                padding: '8px 16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.handleClearState}
              style={{
                background: '#ffffff',
                color: '#5b52d4',
                border: '1.5px solid #d0d0da',
                borderRadius: 7,
                padding: '8px 16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Wipes localStorage + sessionStorage (per-tab UI snapshots, panel sizes, filters). DB untouched."
            >
              Reset UI state &amp; reload
            </button>
            <button
              type="button"
              onClick={this.handleCopyError}
              style={{
                background: 'transparent',
                color: '#666',
                border: '1.5px solid #d0d0da',
                borderRadius: 7,
                padding: '8px 16px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Copy error
            </button>
          </div>

          <p style={{ color: '#888', fontSize: 12, marginTop: 14 }}>
            If <em>Reset UI state &amp; reload</em> doesn't help, the crash is probably triggered by
            something in the DB itself. Open an issue at github.com/apinizer/testnizer-releases with
            the copied error.
          </p>
        </div>
      </div>
    )
  }
}
