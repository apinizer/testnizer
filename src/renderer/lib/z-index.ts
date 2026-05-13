// Centralised z-index stacking for modal-like surfaces. Layers go from
// background panels up to system-level overlays. Add new surfaces here
// rather than sprinkling magic numbers across components.
export const Z = {
  /** Inline overlays inside the workbench (dropdowns, tooltips). */
  DROPDOWN: 100,
  /** Standard modals (Settings, Save, Import, About, etc.). */
  MODAL: 9999,
  /** Cmd+K command palette — sits above standard modals. */
  COMMAND_PALETTE: 10000,
  /** Global toast layer — must clear every modal + palette. */
  TOAST: 10001,
  /** EULA / consent gate — blocks app until accepted, above everything. */
  GATE: 10500,
} as const
