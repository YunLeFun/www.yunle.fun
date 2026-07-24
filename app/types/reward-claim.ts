export type RewardClaimAvailability
  = | 'unpublished'
    | 'scheduled'
    | 'active'
    | 'paused'
    | 'ended'
    | 'expired'
    | 'exhausted'
    | 'unavailable'

export interface RewardClaimPublicCampaign {
  title: string
  description: string
  reward: {
    coinAmount: number
    membershipDays: number
  }
  remainingCount: number
  claimLimit: 1
  startsAt: number
  endsAt: number
  rewardExpires: false
}

export interface RewardClaimResult {
  claimId: string
  status: 'processing' | 'succeeded' | 'failed'
  grantId: string
  balanceAfter?: number
  claimedAt?: number
  retryable?: boolean
}

export interface RewardClaimCampaignView {
  availability: RewardClaimAvailability
  campaign?: RewardClaimPublicCampaign
  viewer: {
    authenticated: boolean
    claim?: RewardClaimResult
  }
}
