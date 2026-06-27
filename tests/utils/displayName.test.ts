import { describe, expect, it } from 'vitest'
import { generateDefaultNickname } from '../../app/utils/displayName'
import { looksLikePhone } from '../../app/utils/mask'

describe('generateDefaultNickname', () => {
  it('同一 seed 始终生成同一昵称（幂等可重放）', () => {
    const a = generateDefaultNickname('uid-abc-123')
    const b = generateDefaultNickname('uid-abc-123')
    expect(a).toBe(b)
  })

  it('形如「云游者_4位后缀」', () => {
    expect(generateDefaultNickname('uid-abc-123')).toMatch(/^云游者_[2-9a-z]{4}$/)
  })

  it('后缀不含易混字符 0 1 i l o', () => {
    const suffix = generateDefaultNickname('uid-abc-123').split('_')[1]!
    expect(suffix).not.toMatch(/[01ilo]/)
  })

  it('生成结果不是裸手机号（不泄露 PII）', () => {
    for (const seed of ['13800138000', 'uid-1', 'uid-2', '15906608053'])
      expect(looksLikePhone(generateDefaultNickname(seed))).toBe(false)
  })

  it('不同 seed 大概率得到不同后缀（辨识度）', () => {
    const names = new Set(
      Array.from({ length: 200 }, (_, i) => generateDefaultNickname(`uid-${i}`)),
    )
    // 31^4 ≈ 92 万后缀空间，200 个样本碰撞概率极低
    expect(names.size).toBeGreaterThan(195)
  })

  it('空 / 缺省种子也能稳定生成', () => {
    expect(generateDefaultNickname('')).toBe(generateDefaultNickname(''))
    expect(generateDefaultNickname(null)).toMatch(/^云游者_[2-9a-z]{4}$/)
    expect(generateDefaultNickname(undefined)).toMatch(/^云游者_[2-9a-z]{4}$/)
  })
})
