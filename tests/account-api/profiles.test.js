import { describe, expect, it, vi } from 'vitest'

import { MEMBERSHIPS_COLLECTION } from '../../cloudfunctions/account-api/lib/orders.js'
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

  it('已进入最终注销清理的资料不能被登录同步重新写活', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', login: null, nickname: '已注销用户', deletedAt: NOW, version: 1 },
      ],
    })

    await expect(upsertMyProfile(db, {
      userId: 'u1',
      profile: { login: 'alice', nickname: 'Alice' },
      now: NOW + 1,
    })).rejects.toThrow(/已注销/)
    expect(db._store[USER_PROFILES_COLLECTION][0]).toMatchObject({ login: null, nickname: '已注销用户' })
  })

  it('会员更新公开资料后仍返回真实会员标记', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', login: 'alice', nickname: 'Alice', followersCount: 0, followingCount: 0, version: 1 },
      ],
      [MEMBERSHIPS_COLLECTION]: [
        { _id: 'u1', expireAt: NOW + 1 },
      ],
    })

    const result = await upsertMyProfile(db, {
      userId: 'u1',
      profile: { nickname: 'Alice 2' },
      now: NOW,
    })

    expect(result).toMatchObject({ nickname: 'Alice 2', isMember: true })
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

  it('第三方登录的纯数字用户名占位符不会阻塞资料创建', async () => {
    const db = makeFakeDb()
    const result = await upsertMyProfile(db, {
      userId: 'u1',
      profile: { login: '1978032370372050944', nickname: 'OAuth 用户' },
      now: NOW,
    })
    expect(result).toMatchObject({ login: null, nickname: 'OAuth 用户' })
  })

  it('普通非法用户名会被拒绝且不会清空现有公开用户名', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', login: 'alice', nickname: 'Alice', followersCount: 0, followingCount: 0, version: 1 },
      ],
    })

    await expect(upsertMyProfile(db, {
      userId: 'u1',
      profile: { login: '1bad' },
      now: NOW,
    })).rejects.toThrow(/用户名格式不正确/)

    expect(db._store[USER_PROFILES_COLLECTION][0].login).toBe('alice')
  })

  it('公开资料快照兼容新规范生效前的 3-25 位大小写用户名', async () => {
    const db = makeFakeDb()
    const legacyLogin = 'Abcdefghijklmnopqrstuvwxy'

    const result = await upsertMyProfile(db, {
      userId: 'legacy-user',
      profile: { login: legacyLogin, nickname: 'Legacy' },
      now: NOW,
    })

    expect(result.login).toBe(legacyLogin)
    expect(db._store[USER_PROFILES_COLLECTION][0].login).toBe(legacyLogin)
  })

  it('裸手机号昵称（auth 默认值）不落库：创建时改为稳定默认昵称', async () => {
    const db = makeFakeDb()
    const res = await upsertMyProfile(db, { userId: 'u1', profile: { nickname: '15906608053' }, now: NOW })
    expect(res.nickname).toBe('云游者_uymn')
    expect(db._store[USER_PROFILES_COLLECTION][0].nickname).toBe('云游者_uymn')
  })

  it('裸手机号昵称不覆盖已设置的真实昵称', async () => {
    const db = makeFakeDb()
    await upsertMyProfile(db, { userId: 'u1', profile: { nickname: '小明' }, now: NOW })
    // 模拟用户从没改 auth 昵称、再次登录把手机号同步上来
    const res = await upsertMyProfile(db, { userId: 'u1', profile: { nickname: '15906608053' }, now: NOW + 1 })
    expect(res.nickname).toBe('小明')
  })

  it('历史空昵称用户再次同步手机号资料时自动修复', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', login: null, nickname: '', followersCount: 0, followingCount: 0, version: 1 },
      ],
    })

    const res = await upsertMyProfile(db, {
      userId: 'u1',
      profile: { nickname: '15906608053' },
      now: NOW,
    })

    expect(res.nickname).toBe('云游者_uymn')
    expect(db._store[USER_PROFILES_COLLECTION][0].nickname).toBe('云游者_uymn')
  })

  it('显式清空昵称时恢复为稳定默认昵称而不是写入空值', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', login: 'alice', nickname: 'Alice', followersCount: 0, followingCount: 0, version: 1 },
      ],
    })

    const res = await upsertMyProfile(db, {
      userId: 'u1',
      profile: { nickname: '   ' },
      now: NOW,
    })

    expect(res.nickname).toBe('云游者_uymn')
    expect(db._store[USER_PROFILES_COLLECTION][0].nickname).toBe('云游者_uymn')
  })

  it('真实昵称即使全是数字也照常落库（仅拒绝合法手机号段）', async () => {
    const db = makeFakeDb()
    // 12345678901：1 后为 2，非手机号段，不应被拒
    const res = await upsertMyProfile(db, { userId: 'u1', profile: { nickname: '12345678901' }, now: NOW })
    expect(res.nickname).toBe('12345678901')
  })
})

describe('getProfile', () => {
  it('公开资料仅标记当前有效会员，不暴露会员明细', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', login: 'alice', nickname: 'Alice' },
      ],
      [MEMBERSHIPS_COLLECTION]: [
        { _id: 'u1', level: 'basic', expireAt: NOW + 1 },
      ],
    })

    const result = await getProfile(db, { userId: 'u1', now: NOW })

    expect(result).toMatchObject({ userId: 'u1', isMember: true })
    expect(result).not.toHaveProperty('level')
    expect(result).not.toHaveProperty('expireAt')
  })

  it('会员状态读取失败时保留公开资料并隐藏角标', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', login: 'alice', nickname: 'Alice' },
      ],
    })
    const collection = db.collection
    db.collection = (name) => {
      if (name === MEMBERSHIPS_COLLECTION) {
        return {
          where() { return this },
          limit() { return this },
          async get() { throw new Error('membership unavailable') },
        }
      }
      return collection(name)
    }
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(getProfile(db, { userId: 'u1', now: NOW })).resolves.toMatchObject({
      userId: 'u1',
      isMember: false,
    })
    expect(log).toHaveBeenCalledOnce()
    log.mockRestore()
  })

  it('按 uid 读取', async () => {
    const db = makeFakeDb()
    await upsertMyProfile(db, { userId: 'u1', profile: { login: 'alice', nickname: 'Alice' }, now: NOW })
    expect(await getProfile(db, { userId: 'u1' })).toMatchObject({ userId: 'u1', login: 'alice', nickname: 'Alice' })
  })

  it('读取历史空昵称或手机号昵称时返回稳定默认昵称', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', login: null, nickname: '' },
        { _id: 'u2', login: null, nickname: '15906608053' },
      ],
    })

    await expect(getProfile(db, { userId: 'u1' })).resolves.toMatchObject({ nickname: '云游者_uymn' })
    await expect(getProfile(db, { userId: 'u2' })).resolves.toMatchObject({ nickname: '云游者_vx7z' })
  })

  it('按 login 读取', async () => {
    const db = makeFakeDb()
    await upsertMyProfile(db, { userId: 'u1', profile: { login: 'alice', nickname: 'Alice' }, now: NOW })
    expect(await getProfile(db, { login: 'alice' })).toMatchObject({ userId: 'u1', nickname: 'Alice' })
  })

  it('按 login 读取时不区分大小写', async () => {
    const db = makeFakeDb()
    await upsertMyProfile(db, { userId: 'u1', profile: { login: 'yunyoujun', nickname: '云游君' }, now: NOW })

    await expect(getProfile(db, { login: 'YunYouJun' })).resolves.toMatchObject({
      userId: 'u1',
      login: 'yunyoujun',
      nickname: '云游君',
    })
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
