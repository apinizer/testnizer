/**
 * The ONE place a runner `execute` payload is assembled.
 *
 * The reported bug: "Stop run if an error occurs" did nothing. The main-process
 * loop honours it correctly in three places, and 23 main-process tests prove it
 * — every one of them passing the flag by hand. What nobody tested was the wire:
 * `RunnerTab.handleRun` simply never put `stopOnError` in the payload, and main
 * defaults it to `false` while the checkbox defaults to `true`. `persistResponses`
 * was missing the same way, so switching body persistence OFF was ignored.
 *
 * Two UI paths call `runner:execute` (the runner tab, and the modal the Command
 * Palette opens), and each was dropping a DIFFERENT set of fields. Both now go
 * through `buildExecutePayload`, whose `RunSettings` type has NO optional
 * members: adding a flag to a run breaks every call site until it supplies one.
 * That is the part that makes this class of bug non-recurring — a comment or a
 * test only catches the fields we thought of today.
 */
import type { RunnerExecuteOptions } from '../../shared/runner-types'

/**
 * Flags that describe HOW a run behaves, as opposed to what it runs.
 *
 * `Required<Pick<…>>` is deliberate: every one of these must be stated
 * explicitly at the call site, because silently inheriting main's default is
 * exactly how the checkbox came to be ignored.
 */
export type RunSettings = Required<
  Pick<
    RunnerExecuteOptions,
    'delay' | 'iterations' | 'stopOnError' | 'persistResponses' | 'keepVariableValues'
  >
>

/**
 * Defaults shared by every runner surface. The runner tab keeps its own state
 * (it is per-tab on purpose — two open runner tabs must not share a checkbox),
 * so only the STARTING VALUES are centralised here, not the state itself.
 */
export const RUNNER_DEFAULTS: RunSettings = {
  delay: 0,
  iterations: 1,
  stopOnError: true,
  persistResponses: true,
  keepVariableValues: true,
}

/** Everything that identifies WHAT to run, as opposed to how. */
export type RunTarget = Omit<RunnerExecuteOptions, keyof RunSettings>

export function buildExecutePayload(
  target: RunTarget,
  settings: RunSettings,
): RunnerExecuteOptions {
  return { ...target, ...settings }
}
