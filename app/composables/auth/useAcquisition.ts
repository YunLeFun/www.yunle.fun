import type { AcquisitionAuthMethod } from '~/utils/acquisition'
import type { AcquisitionRetryTrigger } from '~/utils/acquisition-retry'
import { isAnonymousSession } from '@yunlefun/sso'
import { clearPendingAcquisition, readPendingAcquisition, writePendingAcquisition } from '~/utils/acquisition-pending'
import { createAcquisitionRetry } from '~/utils/acquisition-retry'
import { clearAcquisitionAttempt, currentAcquisitionAttempt, oauthAcquisitionAttempt, setAcquisitionAuthMethod } from '~/utils/acquisition-storage'

export { ACQUISITION_WRITE_TIMEOUT_MS } from '~/utils/acquisition-retry'
type AcquisitionApp = Pick<ReturnType<typeof useCloudbase>['app'], 'callFunction'>
type AcquisitionAuth = Pick<ReturnType<typeof useCloudbase>['auth'], 'getSession'>
const recorders = new WeakMap<AcquisitionApp, ReturnType<typeof createAcquisitionRetry>>()

export function useAuthAcquisition(app?: AcquisitionApp, auth?: AcquisitionAuth) {
  function recorder() {
    if (!app || !auth)
      return null
    let value = recorders.get(app)
    if (!value) {
      value = createAcquisitionRetry({
        now: Date.now,
        currentAttempt: currentAcquisitionAttempt,
        readPending: readPendingAcquisition,
        writePending: writePendingAcquisition,
        clearPending: clearPendingAcquisition,
        clearAttempt: clearAcquisitionAttempt,
        async authenticatedUid() {
          const response = await auth.getSession()
          if (response.error)
            throw response.error
          const session = response.data?.session
          return session && !isAnonymousSession(session) && typeof session.user?.id === 'string' ? session.user.id : null
        },
        async send(pending) {
          const response = await app.callFunction({ name: 'account-api', data: { action: 'recordUserAcquisition', expectedUserId: pending.userId, context: pending.context, authMethod: pending.authMethod } })
          return response.result
        },
        // eslint-disable-next-line no-console -- Safe structured outcomes are required for diagnosing delivery.
        log: event => console.info('[acquisition]', event),
      })
      recorders.set(app, value)
    }
    return value
  }

  async function recordAfterAuthentication(authMethod: AcquisitionAuthMethod, authenticatedUid?: string): Promise<void> {
    const attempt = setAcquisitionAuthMethod(authMethod)
    if (!attempt || attempt.sso || !authenticatedUid)
      return
    await recorder()?.start(attempt, authenticatedUid)
  }

  async function resumeAfterSessionRecovery(authenticatedUid?: string, trigger: AcquisitionRetryTrigger = 'session_recovery'): Promise<void> {
    if (!authenticatedUid)
      return
    const pending = readPendingAcquisition()
    if (!pending)
      return
    // The real SDK session is checked again before every request. Do not capture
    // the current page or rebuild the frozen pending from another account.
    await recorder()?.resume(trigger)
  }

  async function recordAfterOAuthAuthentication(authMethod: AcquisitionAuthMethod, authenticatedUid: string, state: string | null): Promise<void> {
    const attempt = oauthAcquisitionAttempt(state, authMethod)
    if (!attempt || attempt.sso)
      return
    await recorder()?.start(attempt, authenticatedUid)
  }

  function ssoAcquisition(clientId: string, redirectUri: string, nonce: string) {
    const attempt = currentAcquisitionAttempt()
    return attempt?.sso?.clientId === clientId && attempt.sso.redirectUri === redirectUri && attempt.sso.nonce === nonce
      ? { acquisition: attempt.context, acquisitionAuthMethod: attempt.authMethod }
      : undefined
  }

  return { recordAfterAuthentication, recordAfterOAuthAuthentication, resumeAfterSessionRecovery, ssoAcquisition, setAcquisitionAuthMethod }
}
