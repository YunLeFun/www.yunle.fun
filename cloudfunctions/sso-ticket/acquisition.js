/** Private acquisition proxy. Application identity comes exclusively from the validated Registry decision. */
'use strict'

const ACQUISITION_WRITE_TIMEOUT_MS = 1500

function logOutcome(outcome, attempts, statusCode) {
  // eslint-disable-next-line no-console -- Safe structured outcomes identify delivery without logging inputs.
  console.info('[acquisition]', {
    surface: 'sso',
    trigger: 'authorization',
    outcome,
    attempts,
    ...([400, 401, 403, 409, 503].includes(statusCode) ? { statusCode } : {}),
  })
}

async function recordSsoAcquisition(callAccountApi, { userId, request, payload, serviceToken }) {
  if (!serviceToken) {
    logOutcome('not_configured', 0)
    return { ok: false }
  }
  let timer
  let timedOut = false
  try {
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        timedOut = true
        resolve({ ok: false })
      }, ACQUISITION_WRITE_TIMEOUT_MS)
    })
    const result = await Promise.race([
      callAccountApi({
        action: 'recordUserAcquisitionForSso',
        serviceToken,
        userId,
        entry: {
          appId: request.appId,
          clientId: request.clientId,
          origin: request.targetOrigin,
        },
        context: payload?.acquisition || null,
        authMethod: payload?.acquisitionAuthMethod || 'unknown',
      }),
      deadline,
    ])
    const outcome = timedOut
      ? 'timeout'
      : result?.ok === true
        ? (['recorded', 'existing', 'skipped'].includes(result.status) ? result.status : 'completed')
        : (result?.statusCode === 503 && result?.retryable === true ? 'retryable_failure' : 'terminal_failure')
    logOutcome(outcome, 1, result?.statusCode)
    return result
  }
  catch {
    // An analytics write must not invalidate an otherwise successful authorization.
    logOutcome('transport_failure', 1)
    return { ok: false }
  }
  finally {
    clearTimeout(timer)
  }
}

module.exports = { ACQUISITION_WRITE_TIMEOUT_MS, recordSsoAcquisition }
