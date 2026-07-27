import { describe, expect, it } from 'vitest'

import {
  followUser,
  getRelation,
  listFollowers,
  listFollowing,
  unfollowUser,
  USER_FOLLOWS_COLLECTION,
} from '../../cloudfunctions/account-api/follows.js'
import { MEMBERSHIPS_COLLECTION } from '../../cloudfunctions/account-api/lib/orders.js'
import { USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

/** 预置两个已有资料的用户 */
function seed(overrides = {}) {
  return makeFakeDb({
    [USER_PROFILES_COLLECTION]: [
      { _id: 'u1', login: 'alice', nickname: 'Alice', followersCount: 0, followingCount: 0, version: 1 },
      { _id: 'u2', login: 'bob', nickname: 'Bob', followersCount: 0, followingCount: 0, version: 1 },
    ],
    ...overrides,
  })
}

function profile(db, uid) {
  return db._store[USER_PROFILES_COLLECTION].find(p => p._id === uid)
}

describe('关注 followUser / unfollowUser', () => {
  it('关注：建立关系 + 双方计数 +1', async () => {
    const db = seed()
    const res = await followUser(db, { followerId: 'u1', followingId: 'u2', now: NOW })
    expect(res).toMatchObject({ following: true, deduped: false })
    expect(db._store[USER_FOLLOWS_COLLECTION][0]).toMatchObject({ followerId: 'u1', followingId: 'u2' })
    expect(profile(db, 'u1')).toMatchObject({ followingCount: 1, followersCount: 0 })
    expect(profile(db, 'u2')).toMatchObject({ followersCount: 1, followingCount: 0 })
  })

  it('重复关注幂等：不重复建关系、不重复计数', async () => {
    const db = seed()
    await followUser(db, { followerId: 'u1', followingId: 'u2', now: NOW })
    const r2 = await followUser(db, { followerId: 'u1', followingId: 'u2', now: NOW + 1 })
    expect(r2).toMatchObject({ following: true, deduped: true })
    expect(db._store[USER_FOLLOWS_COLLECTION]).toHaveLength(1)
    expect(profile(db, 'u2').followersCount).toBe(1)
  })

  it('取关：删除关系 + 双方计数 -1', async () => {
    const db = seed()
    await followUser(db, { followerId: 'u1', followingId: 'u2', now: NOW })
    const res = await unfollowUser(db, { followerId: 'u1', followingId: 'u2', now: NOW + 1 })
    expect(res).toMatchObject({ following: false, deduped: false })
    expect(db._store[USER_FOLLOWS_COLLECTION]).toHaveLength(0)
    expect(profile(db, 'u1').followingCount).toBe(0)
    expect(profile(db, 'u2').followersCount).toBe(0)
  })

  it('取关未关注：no-op 幂等、计数不变', async () => {
    const db = seed()
    const res = await unfollowUser(db, { followerId: 'u1', followingId: 'u2', now: NOW })
    expect(res).toMatchObject({ following: false, deduped: true })
    expect(profile(db, 'u2').followersCount).toBe(0)
  })

  it('不能关注自己', async () => {
    const db = seed()
    await expect(followUser(db, { followerId: 'u1', followingId: 'u1', now: NOW })).rejects.toThrow(/自己/)
  })

  it('关注无资料的目标：自动占位并计数', async () => {
    const db = seed()
    await followUser(db, { followerId: 'u1', followingId: 'ghost', now: NOW })
    expect(profile(db, 'ghost')).toMatchObject({ followersCount: 1, followingCount: 0, nickname: '云游者_33gf' })
    expect(profile(db, 'u1').followingCount).toBe(1)
  })
})

describe('getRelation', () => {
  it('反映单向 / 互关', async () => {
    const db = seed()
    await followUser(db, { followerId: 'u1', followingId: 'u2', now: NOW })
    expect(await getRelation(db, { viewerId: 'u1', targetId: 'u2' })).toEqual({ isFollowing: true, isFollowedBy: false })
    expect(await getRelation(db, { viewerId: 'u2', targetId: 'u1' })).toEqual({ isFollowing: false, isFollowedBy: true })
    await followUser(db, { followerId: 'u2', followingId: 'u1', now: NOW + 1 })
    expect(await getRelation(db, { viewerId: 'u1', targetId: 'u2' })).toEqual({ isFollowing: true, isFollowedBy: true })
  })

  it('未登录 viewer 均为 false', async () => {
    const db = seed()
    await followUser(db, { followerId: 'u1', followingId: 'u2', now: NOW })
    expect(await getRelation(db, { viewerId: '', targetId: 'u2' })).toEqual({ isFollowing: false, isFollowedBy: false })
  })
})

describe('列表 listFollowing / listFollowers', () => {
  /** u1 关注 u2、u3；u3 回关 u1（u1 与 u3 互关） */
  async function seedFollows() {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', login: 'alice', nickname: 'Alice', followersCount: 0, followingCount: 0, version: 1 },
        { _id: 'u2', login: 'bob', nickname: 'Bob', followersCount: 0, followingCount: 0, version: 1 },
        { _id: 'u3', login: 'carol', nickname: 'Carol', followersCount: 0, followingCount: 0, version: 1 },
      ],
    })
    await followUser(db, { followerId: 'u1', followingId: 'u2', now: NOW })
    await followUser(db, { followerId: 'u1', followingId: 'u3', now: NOW + 10 })
    await followUser(db, { followerId: 'u3', followingId: 'u1', now: NOW + 20 })
    return db
  }

  it('listFollowing 按时间倒序 + join 资料', async () => {
    const db = await seedFollows()
    const { items, nextSkip } = await listFollowing(db, { userId: 'u1' })
    expect(items.map(i => i.userId)).toEqual(['u3', 'u2']) // u3 后关注，倒序在前
    expect(items[0]).toMatchObject({ userId: 'u3', login: 'carol', nickname: 'Carol' })
    expect(nextSkip).toBeNull()
  })

  it('listFollowing 归一化历史空昵称和手机号昵称', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', nickname: 'Alice' },
        { _id: 'u2', nickname: '' },
        { _id: 'u3', nickname: '15906608053' },
      ],
      [USER_FOLLOWS_COLLECTION]: [
        { _id: 'f1', followerId: 'u1', followingId: 'u2', createdAt: NOW },
        { _id: 'f2', followerId: 'u1', followingId: 'u3', createdAt: NOW + 1 },
      ],
    })

    const { items } = await listFollowing(db, { userId: 'u1' })

    expect(items.find(item => item.userId === 'u2')?.nickname).toBe('云游者_vx7z')
    expect(items.find(item => item.userId === 'u3')?.nickname).toBe('云游者_wwwg')
  })

  it('listFollowing 在历史关系缺少 profile 时仍返回默认昵称', async () => {
    const db = makeFakeDb({
      [USER_FOLLOWS_COLLECTION]: [
        { _id: 'f1', followerId: 'u1', followingId: 'u9', createdAt: NOW },
      ],
    })

    const { items } = await listFollowing(db, { userId: 'u1' })

    expect(items[0]).toMatchObject({ userId: 'u9', nickname: '云游者_4fhz' })
  })

  it('listFollowing 批量标记有效会员并排除已到期会员', async () => {
    const db = await seedFollows()
    db._store[MEMBERSHIPS_COLLECTION] = [
      { _id: 'u2', expireAt: NOW - 1 },
      { _id: 'u3', expireAt: NOW + 1 },
    ]

    const { items } = await listFollowing(db, { userId: 'u1', now: NOW })

    expect(items.find(item => item.userId === 'u3')).toMatchObject({ isMember: true })
    expect(items.find(item => item.userId === 'u2')).toMatchObject({ isMember: false })
  })

  it('listFollowers join 资料', async () => {
    const db = await seedFollows()
    const { items } = await listFollowers(db, { userId: 'u1' })
    expect(items.map(i => i.userId)).toEqual(['u3']) // u1 的粉丝只有 u3
    expect(items[0].nickname).toBe('Carol')
  })

  it('viewer 标记 isFollowing（互关识别）', async () => {
    const db = await seedFollows()
    // viewer=u3 看 u1 的关注列表：u3 未关注 u2 → false
    const asU3 = await listFollowing(db, { userId: 'u1', viewerId: 'u3' })
    expect(asU3.items.find(i => i.userId === 'u2')?.isFollowing).toBe(false)
    // viewer=u1 看 u1 的粉丝列表：u1 已关注粉丝 u3 → true（互关）
    const asU1 = await listFollowers(db, { userId: 'u1', viewerId: 'u1' })
    expect(asU1.items.find(i => i.userId === 'u3')?.isFollowing).toBe(true)
  })

  it('分页 skip/limit', async () => {
    const db = await seedFollows()
    const page1 = await listFollowing(db, { userId: 'u1', limit: 1 })
    expect(page1.items.map(i => i.userId)).toEqual(['u3'])
    expect(page1.nextSkip).toBe(1)
    const page2 = await listFollowing(db, { userId: 'u1', skip: 1, limit: 1 })
    expect(page2.items.map(i => i.userId)).toEqual(['u2'])
    // 全量取完（limit 超过总数）→ nextSkip 为 null
    const all = await listFollowing(db, { userId: 'u1', limit: 20 })
    expect(all.items).toHaveLength(2)
    expect(all.nextSkip).toBeNull()
  })

  it('owner 开启隐私：非本人查看返回 hidden，本人仍可见', async () => {
    const db = await seedFollows()
    db._store[USER_PROFILES_COLLECTION].find(p => p._id === 'u1').hideFollowers = true
    const asOther = await listFollowers(db, { userId: 'u1', viewerId: 'u3' })
    expect(asOther).toMatchObject({ items: [], nextSkip: null, hidden: true })
    const asSelf = await listFollowers(db, { userId: 'u1', viewerId: 'u1' })
    expect(asSelf.items.map(i => i.userId)).toEqual(['u3'])
    expect(asSelf.hidden).toBeUndefined()
  })
})
