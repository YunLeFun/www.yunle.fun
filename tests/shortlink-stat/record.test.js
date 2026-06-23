import { describe, expect, it } from 'vitest'

import { getClicks, recordClick, SHARD_COUNT, STATS_COLLECTION } from '../../cloudfunctions/shortlink-stat/stat.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

describe('shortlink-stat 点击计数', () => {
  it('首次点击：创建分片文档,count=1', async () => {
    const db = makeFakeDb()
    const r = await recordClick(db, { host: 'u.yunle.fun', slug: 'abc', ts: 1 })
    expect(r.ok).toBe(true)
    expect(r.created).toBe(true)
    const docs = db._store[STATS_COLLECTION]
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ domain: 'u.yunle.fun', slug: 'abc', count: 1 })
  })

  it('多次点击：跨分片求和累加', async () => {
    const db = makeFakeDb()
    for (let i = 0; i < 25; i++)
      await recordClick(db, { host: 'u.yunle.fun', slug: 'abc', ts: i })
    expect(await getClicks(db, { host: 'u.yunle.fun', slug: 'abc' })).toBe(25)
    // 分片文档数不超过 SHARD_COUNT
    expect(db._store[STATS_COLLECTION].length).toBeLessThanOrEqual(SHARD_COUNT)
  })

  it('host/slug 大小写与首尾空白归一', async () => {
    const db = makeFakeDb()
    await recordClick(db, { host: ' U.YunLe.Fun ', slug: ' ABC ', ts: 1 })
    expect(await getClicks(db, { host: 'u.yunle.fun', slug: 'abc' })).toBe(1)
  })

  it('缺 host 或 slug：不写库', async () => {
    const db = makeFakeDb()
    expect((await recordClick(db, { host: '', slug: 'abc', ts: 1 })).ok).toBe(false)
    expect((await recordClick(db, { host: 'u.yunle.fun', slug: '', ts: 1 })).ok).toBe(false)
    expect(db._store[STATS_COLLECTION]).toBeUndefined()
  })

  it('不同 (domain,slug) 计数互不干扰', async () => {
    const db = makeFakeDb()
    await recordClick(db, { host: 'u.yunle.fun', slug: 'a', ts: 1 })
    await recordClick(db, { host: 'u.yunle.fun', slug: 'b', ts: 1 })
    await recordClick(db, { host: 'u.yunle.fun', slug: 'b', ts: 2 })
    await recordClick(db, { host: 'yunle.app', slug: 'a', ts: 3 })
    expect(await getClicks(db, { host: 'u.yunle.fun', slug: 'a' })).toBe(1)
    expect(await getClicks(db, { host: 'u.yunle.fun', slug: 'b' })).toBe(2)
    expect(await getClicks(db, { host: 'yunle.app', slug: 'a' })).toBe(1)
  })

  it('getClicks：未知短链返回 0', async () => {
    const db = makeFakeDb()
    expect(await getClicks(db, { host: 'u.yunle.fun', slug: 'nope' })).toBe(0)
    expect(await getClicks(db, { host: '', slug: '' })).toBe(0)
  })
})
