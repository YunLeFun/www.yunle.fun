import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  isAnonUid,
  isValidTicketUid,
  normalizePrivateKey,
  tokensMatch,
} from '../../cloudfunctions/sso-ticket/mint.js'

describe('sso-ticket mint 纯函数', () => {
  it('isAnonUid：空 / anon / anonymous* 视为匿名', () => {
    expect(isAnonUid('')).toBe(true)
    expect(isAnonUid(undefined)).toBe(true)
    expect(isAnonUid('anon')).toBe(true)
    expect(isAnonUid('anonymous_abc')).toBe(true)
    expect(isAnonUid('user_42')).toBe(false)
  })

  it('isValidTicketUid：合规 uid 通过；匿名/越界/非法字符/非串拒绝', () => {
    expect(isValidTicketUid('user_42abc')).toBe(true)
    expect(isValidTicketUid('abcd')).toBe(true) // 长度下限 4
    expect(isValidTicketUid('abc')).toBe(false) // 太短
    expect(isValidTicketUid('a'.repeat(33))).toBe(false) // 太长（>32）
    expect(isValidTicketUid('has space')).toBe(false) // 非法字符
    expect(isValidTicketUid('anon')).toBe(false) // Publishable Key 保留匿名主体
    expect(isValidTicketUid('anonymous_x1')).toBe(false) // 匿名
    expect(isValidTicketUid(null)).toBe(false)
    expect(isValidTicketUid(12345)).toBe(false) // 非字符串
  })

  it('tokensMatch：相等→true；不等/长度不同/空→false', () => {
    expect(tokensMatch('s3cr3t-token-value', 's3cr3t-token-value')).toBe(true)
    expect(tokensMatch('s3cr3t-token-value', 'wrong-token-value0')).toBe(false)
    expect(tokensMatch('short', 'longer-token')).toBe(false) // 长度不同
    expect(tokensMatch('', '')).toBe(false) // 空一律判负（fail closed）
    expect(tokensMatch('abc', undefined)).toBe(false)
  })

  it('normalizePrivateKey：PEM 原样、base64(PEM) 解码、\\n 转义还原', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIBxyz\n-----END PRIVATE KEY-----'
    expect(normalizePrivateKey(pem)).toBe(pem)

    const b64 = Buffer.from(pem, 'utf8').toString('base64')
    expect(normalizePrivateKey(b64)).toBe(pem)

    const escaped = '-----BEGIN PRIVATE KEY-----\\nMIIBxyz\\n-----END PRIVATE KEY-----'
    expect(normalizePrivateKey(escaped)).toBe(pem)

    expect(normalizePrivateKey('')).toBe('')
    expect(normalizePrivateKey(undefined)).toBe('')
  })
})
