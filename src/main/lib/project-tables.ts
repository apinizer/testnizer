/**
 * Which tables belong to a project's shareable file, and which stay on this
 * machine by design — the contract the git fidelity test
 * (`tests/main/handlers/git-project-fidelity.test.ts`) holds every table to.
 * A new table must be added to one of the two lists, or that test fails.
 */

/** Exported by `exportProjectData` and restored by `importProjectData`. */
export const EXPORTED_TABLES: readonly string[] = [
  'folders',
  'endpoints',
  'endpoint_cases',
  'saved_requests',
  'saved_responses',
  'environments',
  'environment_variables',
  'global_variables',
  'test_suites',
  'test_suite_folders',
  'test_suite_items',
  'mock_servers',
  'mock_endpoints',
  'mock_responses',
  'mock_mcp_servers',
  'certificates',
]

/** Never leave this machine: per-user, per-device or secret state. */
export const LOCAL_ONLY_TABLES: readonly string[] = [
  'settings', // app preferences
  'history', // request history of this machine
  'runner_history', // run results of this machine
  'scheduled_tasks', // schedules run where they were set up
  'branches', // local branch bookkeeping
  'save_history', // local save log
  'users', // local login
  'sessions',
  'otp_entries', // OTP seeds (secrets)
  'keystores', // private key material (issue #186: certs referencing them arrive disabled)
  'ai_conversations', // chats stay local (issue #198)
]
