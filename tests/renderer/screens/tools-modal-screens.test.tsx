/**
 * Smoke-render the Tools-panel utilities and the top-level modals (in their
 * OPEN state) against a mocked window.api + seeded stores. A tool or modal that
 * throws on mount becomes a RED test here (see `mountsWithoutCrash`) instead of
 * a white-screen for one of the 600+ live users.
 *
 * Two render shapes are covered:
 *   - Tools (src/renderer/components/tools/*): prop-less, render inline.
 *   - Modals (src/renderer/components/modals/*): driven by a `show*` flag in the
 *     ui store; they render through the shared Radix <Modal> which PORTALS into
 *     document.body. The helper's ErrorBoundary still catches a render-throw
 *     from inside a portal (React error boundaries follow the React tree, not
 *     the DOM tree), so `mountsWithoutCrash` remains the right gate.
 */
import * as React from 'react'
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Monaco can't run in jsdom — stub it (mirrors the existing renderer tests).
vi.mock('../../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mountsWithoutCrash, mockWindowApi } from './_mount'
import { useUIStore } from '../../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'
import type { Project } from '../../../src/renderer/types'

// ─── Tools ───────────────────────────────────────────────────────────────────
import JwtTool from '../../../src/renderer/components/tools/JwtTool'
import HashTool from '../../../src/renderer/components/tools/HashTool'
import RegexTool from '../../../src/renderer/components/tools/RegexTool'
import JsonXmlTool from '../../../src/renderer/components/tools/JsonXmlTool'
import KeystoreTool from '../../../src/renderer/components/tools/KeystoreTool'
import TlsInspectorTool from '../../../src/renderer/components/tools/TlsInspectorTool'
import EncodeTool from '../../../src/renderer/components/tools/EncodeTool'
import UuidTool from '../../../src/renderer/components/tools/UuidTool'
import BaseConverterTool from '../../../src/renderer/components/tools/BaseConverterTool'
import EpochTool from '../../../src/renderer/components/tools/EpochTool'
import HttpStatusTool from '../../../src/renderer/components/tools/HttpStatusTool'
import HmacTool from '../../../src/renderer/components/tools/HmacTool'

// ─── Modals ──────────────────────────────────────────────────────────────────
import SettingsModal from '../../../src/renderer/components/modals/SettingsModal'
import EnvironmentModal from '../../../src/renderer/components/modals/EnvironmentModal'
import ImportModal from '../../../src/renderer/components/modals/ImportModal'
import RunnerConfigView from '../../../src/renderer/components/modals/RunnerConfigView'
import ProjectDetailModal from '../../../src/renderer/components/modals/ProjectDetailModal'
import SaveModal from '../../../src/renderer/components/modals/SaveModal'

// Radix Dialog + a few tools touch DOM APIs jsdom doesn't implement.
function stubDom(): void {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.scrollIntoView = () => {}
}

function seedActiveProject(): void {
  const now = Date.now()
  const project: Project = {
    id: 'proj-1',
    workspace_id: 'ws-1',
    name: 'Sample',
    display_name: 'Sample',
    description: 'demo',
    type: 'http',
    save_mode: 'local',
    sort_order: 0,
    created_at: now,
    updated_at: now,
  }
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'proj-1',
    projects: [project],
  })
}

// KeystoreTool's mount effect calls `window.api.keystore.libraryList()` and
// writes the returned `data` straight into the store's `library` array. The
// generic mock resolves `data: null`, which would null out `library` and make a
// child `library.find(...)` throw. Override the keystore namespace so every
// method resolves an empty array — the REAL tool tree still renders (empty
// library state), just without the spurious transient throw.
function keystoreArrayNamespace(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined
        return (..._a: unknown[]) => Promise.resolve({ success: true, data: [] })
      },
    },
  )
}

beforeEach(() => {
  stubDom()
  mockWindowApi({ keystore: keystoreArrayNamespace() })
  seedActiveProject()
})

afterEach(() => {
  cleanup()
})

describe('Tools panel — smoke mount', () => {
  it('JwtTool', () => {
    mountsWithoutCrash(<JwtTool />)
  })

  it('HashTool', () => {
    mountsWithoutCrash(<HashTool />)
  })

  it('RegexTool', () => {
    mountsWithoutCrash(<RegexTool />)
  })

  it('JsonXmlTool (JSON↔XML)', () => {
    mountsWithoutCrash(<JsonXmlTool />)
  })

  it('KeystoreTool', () => {
    mountsWithoutCrash(<KeystoreTool />)
  })

  it('TlsInspectorTool', () => {
    mountsWithoutCrash(<TlsInspectorTool />)
  })

  it('EncodeTool', () => {
    mountsWithoutCrash(<EncodeTool />)
  })

  it('UuidTool', () => {
    mountsWithoutCrash(<UuidTool />)
  })

  it('BaseConverterTool', () => {
    mountsWithoutCrash(<BaseConverterTool />)
  })

  it('EpochTool', () => {
    mountsWithoutCrash(<EpochTool />)
  })

  it('HttpStatusTool', () => {
    mountsWithoutCrash(<HttpStatusTool />)
  })

  it('HmacTool', () => {
    mountsWithoutCrash(<HmacTool />)
  })
})

describe('Top modals — smoke mount (open state)', () => {
  it('SettingsModal', () => {
    useUIStore.setState({ showSettingsModal: true })
    mountsWithoutCrash(<SettingsModal />)
  })

  it('EnvironmentModal', () => {
    useUIStore.setState({ showEnvironmentModal: true })
    mountsWithoutCrash(<EnvironmentModal />)
  })

  it('ImportModal', () => {
    useUIStore.setState({ showImportModal: true })
    mountsWithoutCrash(<ImportModal />)
  })

  it('RunnerConfigView', () => {
    mountsWithoutCrash(<RunnerConfigView projectId="proj-1" workspaceId="ws-1" />)
  })

  it('ProjectDetailModal', () => {
    useUIStore.setState({ showProjectDetailModal: true })
    mountsWithoutCrash(<ProjectDetailModal />)
  })

  it('SaveModal', () => {
    useUIStore.setState({ showSaveModal: true })
    mountsWithoutCrash(<SaveModal />)
  })
})
