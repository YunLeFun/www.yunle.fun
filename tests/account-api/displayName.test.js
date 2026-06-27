import { describe, expect, it } from 'vitest'
import { generateDefaultNickname } from '../../cloudfunctions/account-api/displayName.js'

describe('generateDefaultNickname (云函数侧)', () => {
  it('幂等：同一 seed 始终同结果', () => {
    expect(generateDefaultNickname('uid-abc-123')).toBe(generateDefaultNickname('uid-abc-123'))
  })

  it('形如「云游者_4位去混淆后缀」', () => {
    expect(generateDefaultNickname('uid-abc-123')).toMatch(/^云游者_[2-9a-z]{4}$/)
    expect(generateDefaultNickname('uid-abc-123').split('_')[1]).not.toMatch(/[01ilo]/)
  })

  // 跨端黄金向量：这些期望值取自前端 app/utils/displayName.ts 的实跑输出。
  // 若此断言失败，说明前后端算法漂移了——两边「同 uid 同名」的前提被破坏，必须修复。
  it('与前端 app/utils/displayName.ts 输出逐字节一致', () => {
    expect(generateDefaultNickname('u1')).toBe('云游者_uymn')
    expect(generateDefaultNickname('u2')).toBe('云游者_vx7z')
    expect(generateDefaultNickname('u3')).toBe('云游者_wwwg')
    expect(generateDefaultNickname('550e8400-e29b-41d4-a716-446655440000')).toBe('云游者_336d')
    expect(generateDefaultNickname('7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe('云游者_jjrj')
    expect(generateDefaultNickname('15906608053')).toBe('云游者_6r6d')
  })

  it('空 / 非字符串种子也稳定生成', () => {
    expect(generateDefaultNickname('')).toBe('云游者_5spb')
    expect(generateDefaultNickname(null)).toBe('云游者_5spb')
    expect(generateDefaultNickname(undefined)).toBe('云游者_5spb')
  })
})
