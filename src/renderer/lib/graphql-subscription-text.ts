/**
 * A GraphQL subscription's outcome in the active locale. A failure before the
 * ack arrives classified (`errorInfo`, the ONE connection-error format) and named
 * (`failure`): this writes what the engine knows precisely in the user's language.
 * Without `failure` it is the ordinary connection error.
 *
 * Pure: no DOM, no store — safe to import from node-env store tests.
 */
import {
  composeConnectionMessage,
  isConnectionErrorInfo,
  joinConnectionHint,
} from '../../shared/connection-error'
import {
  gqlWsCloseText,
  gqlWsFailureDetail,
  gqlWsHintKey,
  type GqlWsFailure,
} from '../../shared/graphql-ws'
import { connectErrorText } from './connection-error'
import { t } from './i18n'

export function subscriptionFailureText(
  res: { error?: unknown; errorInfo?: unknown; failure?: GqlWsFailure } | null | undefined,
  fallback: string,
): string {
  const info = res?.errorInfo
  if (!res?.failure || !isConnectionErrorInfo(info)) return connectErrorText(res, fallback)
  const detail = gqlWsFailureDetail(res.failure, t)
  return joinConnectionHint(
    composeConnectionMessage({ ...info, detail }, t(`connError.${info.kind}.what`)),
    t(gqlWsHintKey(res.failure.reason)),
  )
}

/** Why a subscription is no longer running; `null` while it may still run. */
export type SubscriptionEnd =
  | { kind: 'completed' | 'error' | 'unsubscribed' | 'projectLeft' }
  | { kind: 'closed'; code?: number; reason?: string }

export function subscriptionEndText(end: SubscriptionEnd): string {
  switch (end.kind) {
    case 'completed':
      return t('graphql.sub.end.completed')
    case 'error':
      return t('graphql.sub.end.error')
    case 'unsubscribed':
      return t('graphql.sub.end.unsubscribed')
    case 'projectLeft':
      return t('graphql.sub.end.projectLeft')
    case 'closed':
      return t('graphql.sub.end.closed').replace(
        '{detail}',
        gqlWsCloseText(end.code, end.reason, t),
      )
  }
}
