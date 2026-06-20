/**
 * 账号软注销（account-api 本地模块，非同步 lib）。
 *
 * 「软注销」策略（与产品决策一致）：立即清除可公开识别的 PII、释放用户名、解除社交关系、
 * 删除收到的通知，并在 user_profiles 标记 deletedAt；**保留订单 / 钱包 / 云币流水等财务记录**
 * 以满足对账与合规留存。CloudBase Auth 身份与财务记录的彻底删除（硬删）留作后续人工 / 定时任务。
 *
 * 幂等：重复调用安全——资料已脱敏后再次执行只是重写同样的脱敏值；社交关系按当前明细再清一遍
 * （已清空则为 no-op）。
 */

'use strict'

const { USER_FOLLOWS_COLLECTION } = require('./follows')
const { assertUserId, bumpFollowCount, readProfileDoc, USER_PROFILES_COLLECTION } = require('./profiles')

const USER_NOTIFICATIONS_COLLECTION = 'user_notifications'
/** 分页捞取关系的页大小（避免大 V 用户关系被默认 limit 截断） */
const PAGE = 100

/** 分页捞完某条件下的全部 user_follows 文档 */
async function fetchAllFollows(db, where) {
  const out = []
  let skip = 0
  for (;;) {
    const { data } = await db
      .collection(USER_FOLLOWS_COLLECTION)
      .where(where)
      .skip(skip)
      .limit(PAGE)
      .get()
    const rows = Array.isArray(data) ? data : []
    out.push(...rows)
    if (rows.length < PAGE)
      break
    skip += PAGE
  }
  return out
}

/**
 * 软注销当前账号。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId 当前登录用户
 * @param {number} [input.now]
 * @returns {Promise<{ deleted: true, deletedAt: number, removedFollowing: number, removedFollowers: number }>} 注销结果与清理的关系数
 */
async function requestAccountDeletion(db, { userId, now = Date.now() }) {
  const uid = assertUserId(userId)

  // 1) 脱敏 + 标记注销：立即清除公开 PII、释放 login、计数清零、关闭隐私开关
  const existing = await readProfileDoc(db, uid)
  if (existing) {
    await db.collection(USER_PROFILES_COLLECTION).doc(uid).update({
      login: null,
      nickname: '已注销用户',
      avatar: null,
      description: '',
      followersCount: 0,
      followingCount: 0,
      hideFollowers: false,
      hideFollowing: false,
      deletedAt: now,
      updatedAt: now,
    })
  }

  // 2) 解除社交关系（双向），并修正对端去规范化计数
  // 我关注的人：删关系 + 对方 followersCount-1
  const iFollow = await fetchAllFollows(db, { followerId: uid })
  for (const f of iFollow) {
    await db.collection(USER_FOLLOWS_COLLECTION).where({ followerId: uid, followingId: f.followingId }).remove()
    await bumpFollowCount(db, { userId: f.followingId, field: 'followersCount', delta: -1, now })
  }
  // 我的粉丝：删关系 + 对方 followingCount-1
  const myFollowers = await fetchAllFollows(db, { followingId: uid })
  for (const f of myFollowers) {
    await db.collection(USER_FOLLOWS_COLLECTION).where({ followerId: f.followerId, followingId: uid }).remove()
    await bumpFollowCount(db, { userId: f.followerId, field: 'followingCount', delta: -1, now })
  }

  // 3) 删除收到的通知（作为 actor 出现在他人通知里的，资料已脱敏，渲染为「已注销用户」）
  await db.collection(USER_NOTIFICATIONS_COLLECTION).where({ userId: uid }).remove()

  return {
    deleted: true,
    deletedAt: now,
    removedFollowing: iFollow.length,
    removedFollowers: myFollowers.length,
  }
}

module.exports = {
  requestAccountDeletion,
}
