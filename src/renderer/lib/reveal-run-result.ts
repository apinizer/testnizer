/**
 * The folder icon on a Run-results row (issue #115): bring the row's request
 * into view in the sidebar it lives in.
 *
 *  - APIs / Runner runs carry endpoint ids → the APIs tree (`revealNode`).
 *  - Suite runs carry `test_suite_items` ids → the Tests sidebar
 *    (`revealSuiteItem`). These used to get no icon at all, because the ids
 *    have no row in the APIs tree.
 *
 * A request deleted since the run is said so in a toast instead of navigating
 * to nothing.
 */
import { useUIStore } from '../stores/ui.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { t } from './i18n'
import { toast } from './toast'

export type RunOrigin = 'apis' | 'suite' | 'runner'

/** Which sidebar a run's results reveal into. */
export function revealTargetFor(origin: RunOrigin): 'apis' | 'tests' {
  return origin === 'suite' ? 'tests' : 'apis'
}

/** Reveal result `id` of a run that started from `origin`. Resolves true when found. */
export async function revealRunResult(origin: RunOrigin, id: string): Promise<boolean> {
  if (revealTargetFor(origin) === 'tests') {
    // Switch first, as the APIs branch does: the Tests panel mounts and picks
    // the reveal up once the item has been looked up.
    useUIStore.getState().setActiveSidebarPage('tests')
    const found = await useWorkspaceStore.getState().revealSuiteItem(id)
    if (!found) toast.info(t('runResults.revealNotFoundTests'))
    return found
  }
  useUIStore.getState().setActiveSidebarPage('apis')
  const found = useWorkspaceStore.getState().revealNode(id)
  if (!found) toast.info(t('runResults.revealNotFound'))
  return found
}
