import { describe, expect, it } from 'vitest'

import {
  bumpFollowCount,
  getProfile,
  upsertMyProfile,
  USER_PROFILES_COLLECTION,
} from '../../cloudfunctions/account-api/profiles.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

describe('upsertMyProfile', () => {
  it('首次创建：计数初始化为 0', async () => {
    const db = makeFakeDb()
    const res = await upsertMyProfile(db, {
      userId: 'u1',
      profile: { login: 'alice', nickname: 'Alice', avatar: 'a.png' },
      now: NOW,
    })
    expect(res).toMatchObject({ userId: 'u1', login: 'alice', nickname: 'Alice', followersCount: 0, followingCount: 0 })
    expect(db._store[USER_PROFILES_COLLECTION]).toHaveLength(1)
  })

  it('再次 upsert：更新资料、不影响计数', async () => {
    const db = makeFakeDb()
    await upsertMyProfile(db, { userId: 'u1', profile: { nickname: 'Alice' }, now: NOW })
    db._store[USER_PROFILES_COLLECTION][0].followersCount = 5 // 模拟已有粉丝
    const res = await upsertMyProfile(db, { userId: 'u1', profile: { nickname: 'Alice 2' }, now: NOW + 1 })
    expect(res).toMatchObject({ nickname: 'Alice 2', followersCount: 5 })
  })

  it('计数字段无法被本人 upsert 篡改', async () => {
    const db = makeFakeDb()
    await upsertMyProfile(db, {
      userId: 'u1',
      profile: { nickname: 'A', followersCount: 999, followingCount: 999 },
      now: NOW,
    })
    expect(db._store[USER_PROFILES_COLLECTION][0]).toMatchObject({ followersCount: 0, followingCount: 0 })
  })

  it('非法用户名抛错', async () => {
    const db = makeFakeDb()
    await expect(upsertMyProfile(db, { userId: 'u1', profile: { login: '1bad' }, now: NOW })).rejects.toThrow(/用户名/)
  })

  it('裸手机号昵称（auth 默认值）不落库：创建时昵称为空', async () => {
    const db = makeFakeDb()
    const res = await upsertMyProfile(db, { userId: 'u1', profile: { nickname: '15906608053' }, now: NOW })
    expect(res.nickname).toBe('')
    expect(db._store[USER_PROFILES_COLLECTION][0].nickname).toBe('')
  })

  it('裸手机号昵称不覆盖已设置的真实昵称', async () => {
    const db = makeFakeDb()
    await upsertMyProfile(db, { userId: 'u1', profile: { nickname: '小明' }, now: NOW })
    // 模拟用户从没改 auth 昵称、再次登录把手机号同步上来
    const res = await upsertMyProfile(db, { userId: 'u1', profile: { nickname: '15906608053' }, now: NOW + 1 })
    expect(res.nickname).toBe('小明')
  })

  it('真实昵称即使全是数字也照常落库（仅拒绝合法手机号段）', async () => {
    const db = makeFakeDb()
    // 12345678901：1 后为 2，非手机号段，不应被拒
    const res = await upsertMyProfile(db, { userId: 'u1', profile: { nickname: '12345678901' }, now: NOW })
    expect(res.nickname).toBe('12345678901')
  })
})

describe('getProfile', () => {
  it('按 uid 读取', async () => {
    const db = makeFakeDb()
    await upsertMyProfile(db, { userId: 'u1', profile: { login: 'alice', nickname: 'Alice' }, now: NOW })
    expect(await getProfile(db, { userId: 'u1' })).toMatchObject({ userId: 'u1', login: 'alice', nickname: 'Alice' })
  })

  it('按 login 读取', async () => {
    const db = makeFakeDb()
    await upsertMyProfile(db, { userId: 'u1', profile: { login: 'alice', nickname: 'Alice' }, now: NOW })
    expect(await getProfile(db, { login: 'alice' })).toMatchObject({ userId: 'u1', nickname: 'Alice' })
  })

  it('不存在返回 null', async () => {
    const db = makeFakeDb()
    expect(await getProfile(db, { userId: 'ghost' })).toBeNull()
    expect(await getProfile(db, { login: 'ghost' })).toBeNull()
    expect(await getProfile(db, {})).toBeNull()
  })
})

describe('bumpFollowCount', () => {
  it('占位创建 + 累加 + 不减为负', async () => {
    const db = makeFakeDb()
    await bumpFollowCount(db, { userId: 'u1', field: 'followersCount', delta: 1, now: NOW })
    expect(db._store[USER_PROFILES_COLLECTION][0]).toMatchObject({ _id: 'u1', followersCount: 1 })
    await bumpFollowCount(db, { userId: 'u1', field: 'followersCount', delta: 1, now: NOW })
    expect(db._store[USER_PROFILES_COLLECTION][0].followersCount).toBe(2)
    for (let i = 0; i < 3; i++)
      await bumpFollowCount(db, { userId: 'u1', field: 'followersCount', delta: -1, now: NOW })
    expect(db._store[USER_PROFILES_COLLECTION][0].followersCount).toBe(0)
  })
})
