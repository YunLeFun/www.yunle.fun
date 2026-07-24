import type { Buffer } from 'node:buffer'

export interface RewardClaimTokenPort {
  generate: () => string
  digest: (rawToken: string) => string
  publicUrl: (rawToken: string) => string
}

export interface RewardClaimRateTicketPayload {
  ipHash: string
  linkDigest: string
  issuedAt: number
  expiresAt: number
  nonce: string
}

export interface RewardClaimRateTicket {
  issue: (input: { linkDigest: string, ip: string }) => string
  verify: (ticket: string, input: { tokenDigest: string }) => RewardClaimRateTicketPayload
}

export class RewardClaimSecurityError extends Error {
  code: string
}

export function publicLinkDigest(rawToken: string): string

export function createRewardClaimTokenPort(options: {
  hashKey: string
  siteUrl?: string
  randomBytes?: (size: number) => Buffer
}): RewardClaimTokenPort

export function createRewardClaimRateTicket(options: {
  secret: string
  linkHashKey?: string
  now?: () => number
  randomBytes?: (size: number) => Buffer
}): RewardClaimRateTicket
