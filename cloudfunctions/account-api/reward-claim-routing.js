/** Explicit account-api action routing for reward-claim campaigns. */

'use strict'

const { RewardClaimError } = require('./reward-claim-campaigns')

const PUBLIC_ACTIONS = new Set([
  'getRewardClaimCampaign',
  'claimRewardCampaign',
])

const INTERNAL_ACTIONS = new Set([
  'adminPreviewRewardClaimCampaign',
  'adminCreateRewardClaimCampaign',
  'adminPublishRewardClaimCampaign',
  'adminChangeRewardClaimCampaignLifecycle',
  'adminAddRewardClaimInventory',
  'adminRotateRewardClaimLink',
  'adminListRewardClaimCampaigns',
  'adminGetRewardClaimCampaign',
  'adminListRewardClaims',
  'adminReconcileRewardClaim',
  'adminCorrectRewardClaim',
  'adminSweepRewardClaimCampaigns',
])

function isRewardClaimAction(action) {
  return PUBLIC_ACTIONS.has(action) || INTERNAL_ACTIONS.has(action)
}

function actorFromEvent(event) {
  return {
    login: typeof event?.operator === 'string' ? event.operator.trim() : '',
    role: event?.operatorRole === 'owner' ? 'owner' : 'admin',
  }
}

function createRewardClaimActionRouter({ service, assertInternalServiceToken }) {
  if (!service || typeof assertInternalServiceToken !== 'function')
    throw new Error('reward claim action router dependencies are incomplete')

  async function dispatch({ event = {}, callerUid = '' }) {
    const { action } = event
    if (!isRewardClaimAction(action))
      throw new Error(`未知权益领取 action: ${action}`)

    if (action === 'getRewardClaimCampaign')
      return service.inspect(event.token, callerUid || undefined)

    if (action === 'claimRewardCampaign') {
      if (!callerUid)
        throw new RewardClaimError('login_required', '请先登录', 401)
      return service.claim({
        token: event.token,
        rateTicket: event.rateTicket,
      }, callerUid)
    }

    assertInternalServiceToken(event.serviceToken)
    const actor = actorFromEvent(event)
    switch (action) {
      case 'adminPreviewRewardClaimCampaign':
        return service.preview(event.campaign)
      case 'adminCreateRewardClaimCampaign':
        return service.createDraft(event.campaign, actor)
      case 'adminPublishRewardClaimCampaign':
        return service.publish(event.campaignId, { title: event.confirmationTitle }, actor)
      case 'adminChangeRewardClaimCampaignLifecycle':
        return service.changeLifecycle(event.campaignId, event.lifecycleAction, actor)
      case 'adminAddRewardClaimInventory':
        return service.addInventory(event.campaignId, {
          amount: event.amount,
          confirmationTitle: event.confirmationTitle,
        }, actor)
      case 'adminRotateRewardClaimLink':
        return service.rotateLink(event.campaignId, actor)
      case 'adminListRewardClaimCampaigns':
        return service.listCampaigns({
          skip: event.skip,
          limit: event.limit,
          lifecycle: event.lifecycle,
        }, actor)
      case 'adminGetRewardClaimCampaign':
        return service.getAdminCampaign(event.campaignId, actor)
      case 'adminListRewardClaims':
        return service.listClaims(event.campaignId, {
          skip: event.skip,
          limit: event.limit,
          status: event.status,
        }, actor)
      case 'adminReconcileRewardClaim':
        return service.reconcile(event.claimId, actor)
      case 'adminCorrectRewardClaim':
        return service.correct(event.claimId, event.reason, actor)
      case 'adminSweepRewardClaimCampaigns':
        return service.sweep({ login: 'reward-claim-sweeper', role: 'system' })
      default:
        throw new Error(`未知权益领取 action: ${action}`)
    }
  }

  return { dispatch }
}

module.exports = {
  INTERNAL_ACTIONS,
  PUBLIC_ACTIONS,
  createRewardClaimActionRouter,
  isRewardClaimAction,
}
