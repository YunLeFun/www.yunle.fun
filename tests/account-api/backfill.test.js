import { beforeEach, describe, expect, it } from 'vitest'
import { generateDefaultNickname } from '../../cloudfunctions/account-api/displayName.js'
import { backfillDefaultNicknames, USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

/** 取 fake db 内某条 profile 当前态 */
function doc(db, id) {
  return db._store[USER_PROFILES_COLLECTION].find(d => d._id === id)
}

describe('backfillDefaultNicknames', () => {
  let db
  beforeEach(() => {
    db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u-empty', nickname: '' },
        { _id: 'u-phone', nickname: '15906608053' },
        { _id: 'u-real', nickname: '云游君' },
        { _id: 'u-deleted', nickname: '', deletedAt: 1000 },
        { _id: 'u-undef' },
      ],
    })
  })

  it('回填空 / 裸手机号 / 缺失昵称为「云游者_xxxx」', async () => {
    await backfillDefaultNicknames(db, { now: 42 })
    expect(doc(db, 'u-empty').nickname).toBe(generateDefaultNickname('u-empty'))
    expect(doc(db, 'u-phone').nickname).toBe(generateDefaultNickname('u-phone'))
    expect(doc(db, 'u-undef').nickname).toBe(generateDefaultNickname('u-undef'))
    expect(doc(db, 'u-empty').updatedAt).toBe(42)
  })

  it('保留真实昵称、跳过已注销用户', async () => {
    await backfillDefaultNicknames(db, {})
    expect(doc(db, 'u-real').nickname).toBe('云游君')
    expect(doc(db, 'u-deleted').nickname).toBe('') // 注销用户不复活展示名
  })

  it('统计正确：扫 5、改 3、跳 2', async () => {
    const res = await backfillDefaultNicknames(db, {})
    expect(res.scanned).toBe(5)
    expect(res.updated).toBe(3)
    expect(res.skipped).toBe(2)
    expect(res.done).toBe(true)
  })

  it('幂等：回填后再跑无改动', async () => {
    await backfillDefaultNicknames(db, {})
    const res2 = await backfillDefaultNicknames(db, {})
    expect(res2.updated).toBe(0)
    expect(res2.skipped).toBe(5)
  })

  it('dryRun 只统计不写库', async () => {
    const res = await backfillDefaultNicknames(db, { dryRun: true })
    expect(res.updated).toBe(3)
    expect(res.dryRun).toBe(true)
    expect(doc(db, 'u-empty').nickname).toBe('') // 未写库
    expect(doc(db, 'u-phone').nickname).toBe('15906608053')
  })

  it('游标分批：limit < 总数时 done=false，续跑至全部回填', async () => {
    const first = await backfillDefaultNicknames(db, { limit: 2 })
    expect(first.scanned).toBe(2)
    expect(first.done).toBe(false)
    expect(first.nextCursor).toBe('u-empty') // _id 升序：u-deleted < u-empty < u-phone < u-real < u-undef

    let cursor = first.nextCursor
    let last
    let guard = 0
    do {
      last = await backfillDefaultNicknames(db, { limit: 2, cursor })
      cursor = last.nextCursor
    } while (!last.done && ++guard < 10)

    expect(last.done).toBe(true)
    expect(doc(db, 'u-undef').nickname).toBe(generateDefaultNickname('u-undef'))
    expect(doc(db, 'u-real').nickname).toBe('云游君') // 全程不动真实昵称
  })
})
