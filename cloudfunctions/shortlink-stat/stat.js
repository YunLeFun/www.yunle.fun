/**
 * shortlink-stat 纯逻辑 —— 短链点击的分片计数器（T0：原子累加，写多读少）。
 *
 * 设计取舍（与本仓库约定一致）：
 *   - 不用 `_.inc()`：读出当前值在 JS 里 +1，配 `version` 乐观锁（CAS）写回，
 *     与 wxpay 钱包同款,既并发安全又能用内存版 fakeDb 测（见 tests/_fixtures/wxpay.mjs）。
 *   - 分片计数器：同一 (domain,slug) 拆成 SHARD_COUNT 个分片文档,每次点击随机落一个,
 *     把热门短链的并发写打散,避免单文档写锁成为瓶颈;读时跨分片求和。
 *   - 容忍偶发丢失：CAS 冲突最多重试 MAX_RETRY 次,仍失败就放弃这一次计数（统计场景可接受）。
 *
 * 分片文档按 (domain,slug,shard) 字段查/写（auto _id），读侧按 (domain,slug) 跨分片 where 求和。
 * 并发首写可能给同一分片留下重复文档，但每个都是真实点击的计数，求和仍准确（仅文档数略增）。
 * 不用 doc(_id).get()：真实 CloudBase 对不存在的 _id 返回 { data: [] }（非 null），会被误判成
 * “已存在”导致 CAS 永不命中、从不计数；统一走 where().get()（CloudBase 与 fakeDb 都返回数组）。
 *
 * 纯函数,db 由调用方注入（index.js 注真实 CloudBase db,测试注 fakeDb）。
 */

'use strict'

const STATS_COLLECTION = 'shortlink_stats'
const SHARD_COUNT = 10
const MAX_RETRY = 3

function normalize(v) {
  return String(v || '').trim().toLowerCase()
}

/**
 * 记一次点击：随机分片 + CAS 累加。
 * payload: { host|domain, slug, ts? }（target/referer/ua 由边缘函数携带,T0 计数器不落,留待 T1 事件日志）。
 * 返回 { ok, created?, reason? }。
 */
async function recordClick(db, payload = {}) {
  const domain = normalize(payload.host ?? payload.domain)
  const slug = normalize(payload.slug)
  const ts = typeof payload.ts === 'number' ? payload.ts : 0
  if (!domain || !slug)
    return { ok: false, reason: 'missing host/slug' }

  const shard = Math.floor(Math.random() * SHARD_COUNT)
  const coll = () => db.collection(STATS_COLLECTION)

  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    // 按字段查分片文档；where().get() 返回数组（真实 CloudBase 与 fakeDb 一致）
    const { data } = await coll().where({ domain, slug, shard }).limit(1).get()
    const existing = Array.isArray(data) ? data[0] : data

    // 分片首写：创建文档（auto _id）
    if (!existing) {
      try {
        await coll().add({ domain, slug, shard, count: 1, version: 1, createdAt: ts, updatedAt: ts })
        return { ok: true, created: true }
      }
      catch {
        continue // 并发首写撞了,下一轮走 update 分支
      }
    }

    // 已存在：version 乐观锁累加
    const version = existing.version || 0
    const res = await coll()
      .where({ _id: existing._id, version })
      .update({ count: (existing.count || 0) + 1, version: version + 1, updatedAt: ts })
    if ((res.updated || res.modifiedCount || 0) > 0)
      return { ok: true }
    // version 被并发改动 → 重试
  }

  return { ok: false, reason: 'contended' }
}

/** 读某短链累计点击：跨分片求和。query: { host|domain, slug } → number。 */
async function getClicks(db, query = {}) {
  const domain = normalize(query.host ?? query.domain)
  const slug = normalize(query.slug)
  if (!domain || !slug)
    return 0
  const { data } = await db.collection(STATS_COLLECTION).where({ domain, slug }).get()
  return (data || []).reduce((sum, d) => sum + (d.count || 0), 0)
}

module.exports = { STATS_COLLECTION, SHARD_COUNT, recordClick, getClicks }
