import { describe, expect, it } from 'vitest'

import { followUser } from '../../cloudfunctions/account-api/follows.js'
import {
  createFollowNotification,
  getUnreadCount,
  listNotifications,
  markRead,
  USER_NOTIFICATIONS_COLLECTION,
} from '../../cloudfunctions/account-api/notifications.js'
import { USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

function seed() {
  return makeFakeDb({
    [USER_PROFILES_COLLECTION]: [
      { _id: 'u1', login: 'alice', nickname: 'Alice', avatar: 'a.png', followersCount: 0, followingCount: 0, version: 1 },
      { _id: 'u2', login: 'bob', nickname: 'Bob', followersCount: 0, followingCount: 0, version: 1 },
    ],
  })
}

describe('关注通知', () => {
  it('关注触发通知：被关注者收到，含 actor 资料', async () => {
    const db = seed()
    await followUser(db, { followerId: 'u2', followingId: 'u1', now: NOW }) // u2 关注 u1
    const { items } = await listNotifications(db, { userId: 'u1' })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'follow', read: false })
    expect(items[0].actor).toMatchObject({ userId: 'u2', login: 'bob', nickname: 'Bob' })
  })

  it('重复关注不重复通知', async () => {
    const db = seed()
    await followUser(db, { followerId: 'u2', followingId: 'u1', now: NOW })
    await followUser(db, { followerId: 'u2', followingId: 'u1', now: NOW + 1 }) // 重复（deduped）
    expect(db._store[USER_NOTIFICATIONS_COLLECTION]).toHaveLength(1)
  })

  it('getUnreadCount 统计未读', async () => {
    const db = seed()
    await followUser(db, { followerId: 'u2', followingId: 'u1', now: NOW })
    expect(await getUnreadCount(db, { userId: 'u1' })).toEqual({ unread: 1 })
    expect(await getUnreadCount(db, { userId: 'u2' })).toEqual({ unread: 0 })
  })

  it('markRead 全部已读', async () => {
    const db = seed()
    await createFollowNotification(db, { userId: 'u1', actorId: 'u2', now: NOW })
    await createFollowNotification(db, { userId: 'u1', actorId: 'u3', now: NOW + 1 })
    expect((await getUnreadCount(db, { userId: 'u1' })).unread).toBe(2)
    await markRead(db, { userId: 'u1', now: NOW + 2 })
    expect((await getUnreadCount(db, { userId: 'u1' })).unread).toBe(0)
  })

  it('markRead 指定 id 限本人（不能标记他人通知）', async () => {
    const db = seed()
    await createFollowNotification(db, { userId: 'u1', actorId: 'u2', now: NOW })
    const { items } = await listNotifications(db, { userId: 'u1' })
    const id = items[0].id
    await markRead(db, { userId: 'u2', ids: [id], now: NOW + 1 }) // 冒充他人 → 无效
    expect((await getUnreadCount(db, { userId: 'u1' })).unread).toBe(1)
    await markRead(db, { userId: 'u1', ids: [id], now: NOW + 2 }) // 本人 → 生效
    expect((await getUnreadCount(db, { userId: 'u1' })).unread).toBe(0)
  })

  it('不给自己发通知', async () => {
    const db = seed()
    await createFollowNotification(db, { userId: 'u1', actorId: 'u1', now: NOW })
    expect(db._store[USER_NOTIFICATIONS_COLLECTION] || []).toHaveLength(0)
  })

  it('接收者关闭「新增粉丝通知」则跳过（但关注关系仍建立）', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', login: 'alice', nickname: 'Alice', followersCount: 0, followingCount: 0, notifyOnFollow: false, version: 1 },
        { _id: 'u2', login: 'bob', nickname: 'Bob', followersCount: 0, followingCount: 0, version: 1 },
      ],
    })
    const res = await followUser(db, { followerId: 'u2', followingId: 'u1', now: NOW })
    expect(res).toMatchObject({ following: true })
    expect(db._store[USER_NOTIFICATIONS_COLLECTION] || []).toHaveLength(0)
  })

  it('缺省（未设置 notifyOnFollow）仍发通知', async () => {
    const db = seed() // seed 的 u1 未设 notifyOnFollow
    await followUser(db, { followerId: 'u2', followingId: 'u1', now: NOW })
    expect((await getUnreadCount(db, { userId: 'u1' })).unread).toBe(1)
  })
})
