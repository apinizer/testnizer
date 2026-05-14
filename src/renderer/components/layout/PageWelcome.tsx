import { Server, Clock, Wrench, Settings, FileText } from 'lucide-react'

import ProjectWelcome from './ProjectWelcome'
import TestsHome from '../runner/TestsHome'
import EmptyState from '../shared/EmptyState'
import { openOrReuseRunnerTab } from '../../lib/open-runner-tab'
import { useTranslation } from '../../lib/i18n'
import type { SidebarPage } from '../../lib/sidebar-pages'
import type { EndpointRunResult, RunnerReport } from '../../stores/runner.store'

interface PageWelcomeProps {
  page: SidebarPage
}

const SECONDARY: Partial<Record<SidebarPage, { icon: typeof Server; key: string }>> = {
  mocks: { icon: Server, key: 'welcome.mocks' },
  history: { icon: Clock, key: 'welcome.history' },
  tools: { icon: Wrench, key: 'welcome.tools' },
  docs: { icon: FileText, key: 'welcome.docs' },
  settings: { icon: Settings, key: 'welcome.settings' },
}

/**
 * Workbench surface rendered when there's no active tab for the current
 * sidebar page. Each page gets its own welcome instead of always showing
 * the APIs starter (which used to leak into Tests/Mocks etc).
 */
export default function PageWelcome({ page }: PageWelcomeProps) {
  const { t } = useTranslation()

  if (page === 'apis') return <ProjectWelcome />

  if (page === 'tests') {
    return (
      <TestsHome
        onNewRun={() => openOrReuseRunnerTab({ viewHome: false })}
        onViewAllRuns={() => openOrReuseRunnerTab({ viewAllRuns: true })}
        onViewScheduled={() => openOrReuseRunnerTab({ viewScheduledTasks: true })}
        onViewReport={(
          results: EndpointRunResult[],
          report: RunnerReport,
          startedAt: number,
          sourceLabel?: string,
        ) =>
          openOrReuseRunnerTab({
            results,
            report,
            startedAt,
            sourceLabel,
          })
        }
      />
    )
  }

  const config = SECONDARY[page]
  if (!config) return null
  return <EmptyState icon={config.icon} title={t(config.key)} />
}
