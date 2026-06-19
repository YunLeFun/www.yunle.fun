import { describe, expect, it } from 'vitest'

import { getFollowingFeed } from '../../cloudfunctions/account-api/feed.js'
import { USER_FOLLOWS_COLLECTION } from '../../cloudfunctions/account-api/follows.js'
import { USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

/** u1 关注 u2、u3；apps 含公开/私有/未关注三类 */
function seed() {
  return makeFakeDb({
    [USER_PROFILES_COLLECTION]: [
      { _id: 'u2', login: 'bob', nickname: 'Bob', avatar: 'bob.png' },
      { _id: 'u3', login: 'carol', nickname: 'Carol', avatar: 'carol.png' },
    ],
    [USER_FOLLOWS_COLLECTION]: [
      { _id: 'f1', followerId: 'u1', followingId: 'u2', createdAt: NOW },
      { _id: 'f2', followerId: 'u1', followingId: 'u3', createdAt: NOW },
    ],
    apps: [
      { _id: 'a1', ownerId: 'u2', ownerLogin: 'bob', slug: 'app-bob', name: 'BobApp', isPublic: true, createdAt: NOW, updatedAt: NOW + 100 },
      { _id: 'a2', ownerId: 'u3', ownerLogin: 'carol', slug: 'app-carol', name: 'CarolApp', isPublic: true, createdAt: NOW, updatedAt: NOW + 200 },
      { _id: 'a3', ownerId: 'u3', ownerLogin: 'carol', slug: 'secret', name: 'Secret', isPublic: false, createdAt: NOW, updatedAt: NOW + 300 },
      { _id: 'a4', ownerId: 'u4', ownerLogin: 'dave', slug: 'app-dave', name: 'DaveApp', isPublic: true, createdAt: NOW, updatedAt: NOW + 400 },
    ],
  })
}

describe('关注动态 getFollowingFeed', () => {
  it('只含关注对象的公开应用，按更新时间倒序，join 作者资料', async () => {
    const db = seed()
    const { items, nextSkip } = await getFollowingFeed(db, { userId: 'u1' })
    // 倒序（a2 updatedAt 更大）；排除私有 a3 与未关注的 a4
    expect(items.map(i => i.slug)).toEqual(['app-carol', 'app-bob'])
    expect(items[0]).toMatchObject({ type: 'app', slug: 'app-carol' })
    expect(items[0].owner).toMatchObject({ userId: 'u3', login: 'carol', nickname: 'Carol', avatar: 'carol.png' })
    expect(nextSkip).toBeNull()
  })

  it('无关注返回空', async () => {
    const db = seed()
    expect(await getFollowingFeed(db, { userId: 'nobody' })).toEqual({ items: [], nextSkip: null })
  })

  it('分页 skip/limit', async () => {
    const db = seed()
    const page1 = await getFollowingFeed(db, { userId: 'u1', limit: 1 })
    expect(page1.items.map(i => i.slug)).toEqual(['app-carol'])
    expect(page1.nextSkip).toBe(1)
    const page2 = await getFollowingFeed(db, { userId: 'u1', skip: 1, limit: 1 })
    expect(page2.items.map(i => i.slug)).toEqual(['app-bob'])
  })

  it('作者无 profile 时用 ownerLogin 兜底', async () => {
    const db = makeFakeDb({
      [USER_FOLLOWS_COLLECTION]: [{ _id: 'f', followerId: 'u1', followingId: 'u9', createdAt: NOW }],
      apps: [{ _id: 'a', ownerId: 'u9', ownerLogin: 'eve', slug: 'eve-app', name: 'EveApp', isPublic: true, createdAt: NOW, updatedAt: NOW }],
    })
    const { items } = await getFollowingFeed(db, { userId: 'u1' })
    expect(items[0].owner).toMatchObject({ userId: 'u9', login: 'eve', nickname: '' })
  })
})
