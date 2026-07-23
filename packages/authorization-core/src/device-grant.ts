import type { AuthorizationDecision } from './index'

import type { DevicePublicJwk } from './proof-of-possession'
import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'
import { AuthorizationError } from './index'
import { deviceJwkThumbprint } from './proof-of-possession'

export interface DeviceAuthorizationRecord {
  status: 'approved' | 'consumed' | 'denied' | 'expired' | 'pending'
  deviceCodeHash: string
  userCodeHash: string
  issuer: string
  clientId: string
  appId: string
  displayName: string
  scopes: readonly string[]
  policyVersion: string
  registrationFingerprint: string
  deviceId: string
  deviceJkt: string
  devicePublicJwk: DevicePublicJwk
  deviceName: string
  createdAt: number
  expiresAt: number
  subject?: string
  authorizedAt?: number
  consumedAt?: number
}

export interface DeviceGrant {
  subject: string
  issuer: string
  clientId: string
  appId: string
  scopes: readonly string[]
  deviceId: string
  deviceJkt: string
  authorizedAt: number
  registrationFingerprint: string
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function equal(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export function createDeviceGrantMachine(options: {
  generateDeviceCode: () => string
  generateUserCode: () => string
}) {
  return {
    start(input: {
      authorization: AuthorizationDecision
      devicePublicJwk: DevicePublicJwk
      deviceName: string
      now: number
      ttlSeconds: number
    }) {
      if (input.authorization.adapter !== 'device')
        throw new AuthorizationError('adapter_not_allowed')
      const deviceCode = options.generateDeviceCode()
      const userCode = options.generateUserCode()
      const deviceJkt = deviceJwkThumbprint(input.devicePublicJwk)
      const record: DeviceAuthorizationRecord = {
        status: 'pending',
        deviceCodeHash: hash(deviceCode),
        userCodeHash: hash(userCode.replace(/-/g, '').toUpperCase()),
        issuer: input.authorization.issuer,
        clientId: input.authorization.clientId,
        appId: input.authorization.appId,
        displayName: input.authorization.displayName,
        scopes: [...input.authorization.scopes],
        policyVersion: input.authorization.policyVersion,
        registrationFingerprint: input.authorization.registrationFingerprint,
        deviceId: deviceJkt,
        deviceJkt,
        devicePublicJwk: { ...input.devicePublicJwk },
        deviceName: input.deviceName,
        createdAt: input.now,
        expiresAt: input.now + input.ttlSeconds * 1000,
      }
      return { deviceCode, userCode, record }
    },

    approve(record: DeviceAuthorizationRecord, input: { subject: string, now: number }) {
      if (record.status !== 'pending')
        throw new AuthorizationError('device_code_not_pending')
      if (record.expiresAt <= input.now)
        throw new AuthorizationError('device_code_expired')
      return {
        ...record,
        status: 'approved' as const,
        subject: input.subject,
        authorizedAt: input.now,
      }
    },

    consume(record: DeviceAuthorizationRecord, input: {
      deviceCode: string
      proofJkt: string
      now: number
    }) {
      if (record.status !== 'approved')
        throw new AuthorizationError(record.status === 'consumed' ? 'device_code_used' : 'authorization_pending')
      if (record.expiresAt <= input.now)
        throw new AuthorizationError('device_code_expired')
      if (!equal(record.deviceCodeHash, hash(input.deviceCode)) || record.deviceJkt !== input.proofJkt)
        throw new AuthorizationError('device_code_binding_invalid')
      if (!record.subject || !record.authorizedAt)
        throw new AuthorizationError('device_code_invalid')

      const grant: DeviceGrant = {
        subject: record.subject,
        issuer: record.issuer,
        clientId: record.clientId,
        appId: record.appId,
        scopes: [...record.scopes],
        deviceId: record.deviceId,
        deviceJkt: record.deviceJkt,
        authorizedAt: record.authorizedAt,
        registrationFingerprint: record.registrationFingerprint,
      }
      return {
        grant,
        next: {
          ...record,
          status: 'consumed' as const,
          consumedAt: input.now,
        },
      }
    },
  }
}
