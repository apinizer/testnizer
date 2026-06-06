/**
 * UI element inventory for exhaustive E2E coverage.
 * Each entry maps a user-facing control to a stable selector + smoke action.
 */

export type InventoryAction = 'visible' | 'click' | 'shortcut'

export interface InventoryItem {
  id: string
  description: string
  selector: string
  action: InventoryAction
  /** Keyboard shortcut chord (Playwright format) — only for action=shortcut */
  shortcut?: string
  /** Sidebar page required before check */
  requiresPage?: 'apis' | 'tests' | 'mocks' | 'history' | 'tools'
  /** Skip in inventory sweep (destructive / needs network) */
  skip?: boolean
}

export const NAV_ITEMS: InventoryItem[] = [
  { id: 'nav-apis', description: 'APIs sidebar', selector: '[data-testid="nav-apis"]', action: 'click' },
  { id: 'nav-tests', description: 'Tests sidebar', selector: '[data-testid="nav-tests"]', action: 'click' },
  { id: 'nav-mocks', description: 'Mocks sidebar', selector: '[data-testid="nav-mocks"]', action: 'click' },
  { id: 'nav-history', description: 'History sidebar', selector: '[data-testid="nav-history"]', action: 'click' },
  { id: 'nav-tools', description: 'Tools sidebar', selector: '[data-testid="nav-tools"]', action: 'click' },
  { id: 'nav-settings', description: 'Project settings sidebar', selector: '[data-testid="nav-settings"]', action: 'click' },
]

export const FOOTER_ITEMS: InventoryItem[] = [
  { id: 'footer-env', description: 'Environment manager', selector: '[data-testid="footer-env"]', action: 'click' },
  { id: 'footer-enterprise', description: 'Enterprise modal', selector: '[data-testid="footer-enterprise"]', action: 'click' },
  { id: 'footer-console', description: 'Console panel toggle', selector: '[data-testid="footer-console"]', action: 'click' },
]

export const REQUEST_TABS: InventoryItem[] = [
  { id: 'req-tab-params', description: 'Request Params tab', selector: '[data-testid="req-tab-params"]', action: 'click', requiresPage: 'apis' },
  { id: 'req-tab-headers', description: 'Request Headers tab', selector: '[data-testid="req-tab-headers"]', action: 'click', requiresPage: 'apis' },
  { id: 'req-tab-auth', description: 'Request Auth tab', selector: '[data-testid="req-tab-auth"]', action: 'click', requiresPage: 'apis' },
  { id: 'req-tab-body', description: 'Request Body tab', selector: '[data-testid="req-tab-body"]', action: 'click', requiresPage: 'apis' },
  { id: 'req-tab-scripts', description: 'Request Scripts tab', selector: '[data-testid="req-tab-scripts"]', action: 'click', requiresPage: 'apis' },
  { id: 'req-tab-tests', description: 'Request Tests tab', selector: '[data-testid="req-tab-tests"]', action: 'click', requiresPage: 'apis' },
  { id: 'req-tab-settings', description: 'Request Settings tab', selector: '[data-testid="req-tab-settings"]', action: 'click', requiresPage: 'apis' },
]

export const URL_BAR_ITEMS: InventoryItem[] = [
  { id: 'url-input', description: 'URL input', selector: 'input[placeholder*="URL"], input[placeholder*="url"]', action: 'visible', requiresPage: 'apis' },
  { id: 'send-btn', description: 'Send button', selector: '[data-testid="send-btn"]', action: 'visible', requiresPage: 'apis' },
  { id: 'save-btn', description: 'Save endpoint button', selector: '[data-testid="save-btn"]', action: 'visible', requiresPage: 'apis' },
]

export const KEYBOARD_SHORTCUTS: InventoryItem[] = [
  { id: 'shortcut-palette', description: 'Command palette', selector: '[data-testid="command-palette"]', action: 'shortcut', shortcut: 'Meta+KeyK' },
  { id: 'shortcut-cheatsheet', description: 'Shortcut cheatsheet', selector: '[data-testid="shortcut-cheatsheet"]', action: 'shortcut', shortcut: 'Shift+Slash' },
  { id: 'shortcut-import', description: 'Import modal', selector: '[data-testid="import-modal"]', action: 'shortcut', shortcut: 'Meta+KeyO' },
  { id: 'shortcut-settings', description: 'Settings modal', selector: '[data-testid="settings-modal"]', action: 'shortcut', shortcut: 'Meta+Comma' },
  { id: 'shortcut-save-project', description: 'Save project modal', selector: '[data-testid="save-modal"]', action: 'shortcut', shortcut: 'Meta+Shift+KeyS' },
  { id: 'shortcut-new-tab', description: 'New HTTP tab', selector: '[data-testid="workbench"]', action: 'shortcut', shortcut: 'Meta+KeyT' },
  { id: 'shortcut-project-hub', description: 'Project hub', selector: '[data-testid="project-home"]', action: 'shortcut', shortcut: 'Meta+KeyP' },
]

/** All tools from TOOL_CATALOG — opened via command palette search. */
export const TOOL_NAMES = [
  'JWT Debugger',
  'JSON Formatter',
  'XML Formatter',
  'Encode / Decode',
  'Text Diff',
  'JSON Schema Generator',
  'JSONPath Evaluator',
  'XPath Evaluator',
  'JSON ↔ XML Converter',
  'XSLT Evaluator',
  'Jolt Evaluator',
  'WS-Security',
  'Hash Calculator',
  'HMAC Generator',
  'Epoch Converter',
  'HTTP Status Codes',
  'Base Converter',
  'UUID Generator',
  'Regex Tester',
  'YAML ↔ JSON',
] as const

/** Protocol entries in New (+) dropdown. */
/** Project detail modal sidebar tabs (ProjectDetailModal). */
export const PROJECT_DETAIL_TABS = [
  'overview',
  'authorization',
  'preRequest',
  'tests',
  'variables',
  'storage',
  'branches',
  'general',
  'themes',
  'shortcuts',
  'data',
  'certificates',
  'proxy',
  'update',
  'about',
] as const

/** Response pane tabs shown after a successful HTTP response. */
export const RESPONSE_TABS = ['body', 'cookies', 'headers', 'testResults'] as const

export const NEW_DROPDOWN_PROTOCOLS = [
  /^HTTP$/i,
  /Quick Request/i,
  /SOAP/i,
  /WebSocket/i,
  /GraphQL/i,
  /AI/i,
  /gRPC/i,
  /SSE/i,
  /MCP/i,
  /Socket\.IO/i,
  /^Import$/i,
  /^Import cURL$/i,
] as const

export const ALL_INVENTORY: InventoryItem[] = [
  ...NAV_ITEMS,
  ...FOOTER_ITEMS,
  ...REQUEST_TABS,
  ...URL_BAR_ITEMS,
]
