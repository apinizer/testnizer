import { registerRequestHandlers } from './request.handler'
import { registerWorkspaceHandlers } from './workspace.handler'
import { registerProjectHandlers } from './project.handler'
import { registerEndpointHandlers } from './endpoint.handler'
import { registerEnvironmentHandlers } from './environment.handler'
import { registerHistoryHandlers } from './history.handler'
import { registerSettingsHandlers } from './settings.handler'
import { registerImportExportHandlers } from './import-export.handler'
import { registerSoapHandlers } from './soap.handler'
import { registerWebSocketHandlers } from './websocket.handler'
import { registerRunnerHandlers } from './runner.handler'
import { registerGraphqlHandlers } from './graphql.handler'
import { registerGrpcHandlers } from './grpc.handler'
import { registerSseHandlers } from './sse.handler'
import { registerBranchHandlers } from './branch.handler'
import { registerSaveHandlers } from './save.handler'
import { registerSchedulerHandlers, startAllSchedulers } from './scheduler.handler'
import { registerGitHandlers } from './git.handler'
import { registerAuthHandlers } from './auth.handler'
import { registerTestSuiteHandlers } from './test-suite.handler'
import { registerCertificateHandlers } from './certificate.handler'

export function registerAllHandlers(): void {
  registerAuthHandlers()
  registerRequestHandlers()
  registerWorkspaceHandlers()
  registerProjectHandlers()
  registerEndpointHandlers()
  registerEnvironmentHandlers()
  registerHistoryHandlers()
  registerSettingsHandlers()
  registerImportExportHandlers()
  registerSoapHandlers()
  registerWebSocketHandlers()
  registerRunnerHandlers()
  registerGraphqlHandlers()
  registerGrpcHandlers()
  registerSseHandlers()
  registerBranchHandlers()
  registerSaveHandlers()
  registerSchedulerHandlers()
  registerGitHandlers()
  registerTestSuiteHandlers()
  registerCertificateHandlers()

  // Start scheduled task timers after all handlers are registered
  startAllSchedulers()
}
