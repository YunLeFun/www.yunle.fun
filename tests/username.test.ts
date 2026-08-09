import { describe, expect, it } from 'vitest'
import {
  generateTemporaryUsername,
  getUsernameUpdateErrorMessage,
  getUsernameValidationError,
  isAuthUsernameCompatible,
  isOAuthUsernamePlaceholder,
  isTemporaryUsername,
  isValidUsername,
  normalizeUsername,
} from '../app/utils/username'

describe('username utilities', () => {
  it('uses the canonical lowercase 6-20 character username contract', () => {
    expect(normalizeUsername('  Yuier  ')).toBe('yuier')
    expect(isValidUsername('yuier')).toBe(false)
    expect(isValidUsername('yuier1')).toBe(true)
    expect(isValidUsername('Yuier1')).toBe(false)
    expect(isValidUsername('a12345678901234567890')).toBe(false)

    // 登录与 Auth 快照只为历史账号保留兼容，不扩大新用户名规则。
    expect(isAuthUsernameCompatible('LegacyUser')).toBe(true)
    expect(isAuthUsernameCompatible('a123456789012345678901234')).toBe(true)
  })

  it('returns field-safe username validation and server error messages', () => {
    expect(getUsernameValidationError('yuier')).toBe('用户名至少 6 个字符')
    expect(getUsernameValidationError('yuier1')).toBe('')
    expect(getUsernameValidationError('1yuier')).toBe('用户名必须以字母开头')
    expect(getUsernameValidationError('yuier!')).toBe('只允许小写字母、数字、下划线和连字符')

    expect(getUsernameUpdateErrorMessage(new Error('用户名必须匹配 ^[a-z][0-9a-z_-]{5,24}$')))
      .toBe('用户名需为 6-20 个字符，以小写字母开头，只允许小写字母、数字、下划线和连字符')
    expect(getUsernameUpdateErrorMessage(new Error('username already exists')))
      .toBe('该用户名已被占用，请换一个试试')
    expect(getUsernameUpdateErrorMessage(new Error('update conflict')))
      .toBe('用户名状态已变化，请刷新后重试')
    expect(getUsernameUpdateErrorMessage(new Error('用户名至少 6 个字符')))
      .toBe('用户名至少 6 个字符')
    expect(getUsernameUpdateErrorMessage(new Error('internal details')))
      .toBe('用户名设置失败，请稍后重试')
  })

  it('generates a stable valid temporary username from a numeric uid', () => {
    const username = generateTemporaryUsername('2081712496858640384')

    expect(username).toBe('tmp_ftddhqtxqnsw')
    expect(isValidUsername(username)).toBe(true)
    expect(isTemporaryUsername(username)).toBe(true)
  })

  it('generates the same bounded temporary username for a non-numeric uid', () => {
    const first = generateTemporaryUsername('oauth:user@example.com')
    const second = generateTemporaryUsername('oauth:user@example.com')

    expect(first).toBe(second)
    expect(first.length).toBeLessThanOrEqual(20)
    expect(isValidUsername(first)).toBe(true)
    expect(isTemporaryUsername(first)).toBe(true)
  })

  it('does not classify a normal username as temporary', () => {
    expect(isTemporaryUsername('new_github_user')).toBe(false)
  })

  it('only treats numeric OAuth usernames as placeholders', () => {
    expect(isOAuthUsernamePlaceholder('1978032370372050944')).toBe(true)
    expect(isOAuthUsernamePlaceholder('rain')).toBe(false)
    expect(isOAuthUsernamePlaceholder('legacy.github-user')).toBe(false)
  })
})
