/**
 * 云函数 account-api —— 平台账户中心（云币钱包 + 跨应用会员）。
 *
 * 路由 action：
 *   - getAccount        一次拿到账户全貌（云币余额 + 会员状态），需登录
 *   - getMembership     读取本人会员记录，需登录（替代浏览器直读集合）
 *   - deductCoin        按次扣云币（需登录，幂等键 bizId）
 *   - signIn            每日签到领云币（需登录，免费 1 / 会员 2，按东八区切日幂等）
 *   - getSignInStatus   读今日签到态（需登录）
 *   - tip               投币打赏应用（需登录，1 币/次，每应用每日上限 2 次）
 *   - getAppSupport     读某应用支持详情（公开；登录时附带「我是否支持过」）
 *   - getTipLeaderboard 应用支持榜（公开）
 *   - getProfile        读用户公开资料（公开，按 uid 或 login）
 *   - getRelation       读我与某用户的关系（公开；登录时附带 isFollowing/isFollowedBy）
 *   - listFollowing     某用户关注的人列表（公开，分页；登录时标 isFollowing）
 *   - listFollowers     某用户的粉丝列表（公开，分页；登录时标 isFollowing）
 *   - getFollowingFeed  关注动态：我关注的人最近发布的公开应用（需登录，分页）
 *   - getUnreadCount    未读通知数（需登录）
 *   - listNotifications 通知列表（需登录，分页）
 *   - markNotificationsRead 标记通知已读（需登录，传 ids 或全部）
 *   - followUser        关注用户（需登录，幂等，目标 targetId）
 *   - unfollowUser      取关用户（需登录，幂等）
 *   - upsertMyProfile   同步本人公开资料（需登录，白名单字段）
 *   - deductCoinForUser 内部服务按指定 userId 扣云币（需 ACCOUNT_API_INTERNAL_TOKEN）
 *   - getAccountForUser 内部服务按指定 userId 读账户全貌（需 ACCOUNT_API_INTERNAL_TOKEN）
 *   - adminAdjustCoin   管理员人工调账（增/减，需 ACCOUNT_API_INTERNAL_TOKEN）
 *   - adminGrantReward  owner 按稳定 grantId 发放内测奖励（需 ACCOUNT_API_INTERNAL_TOKEN）
 *   - adminCorrectReward owner 创建受控奖励纠正（需 ACCOUNT_API_INTERNAL_TOKEN）
 *   - getRewardClaimCampaign 读取共享领取活动（公开；登录时附本人领取结果）
 *   - claimRewardCampaign 登录用户主动领取固定权益（需短时 IP 速率凭证）
 *   - admin*RewardClaimCampaign 权益领取活动控制面（需 ACCOUNT_API_INTERNAL_TOKEN）
 *   - prepareSyntheticBaseline Broker 在受管身份禁用态初始化/恢复钱包基线（需 TEST_BROKER_ACCOUNT_API_TOKEN）
 *   - backfillDefaultNicknames 运维回填存量空/手机号昵称为「云游者_xxxx」（需 ACCOUNT_API_INTERNAL_TOKEN，幂等/分批/dryRun）
 *   - listTransactions  云币流水分页（需登录）
 *   - listOrders        我的订单历史分页（需登录，会员 / 云币充值订单）
 *   - requestAccountDeletion 申请注销并进入 30 天冷静期（需登录）
 *   - getAccountDeletionStatus 查询冷静期 / 清理状态（需登录）
 *   - cancelAccountDeletion 冷静期内撤回注销（需登录）
 *   - finalizeAccountDeletion 到期清理业务资料（需 ACCOUNT_API_INTERNAL_TOKEN）
 *   - uploadAvatar      后端受控上传头像到 CloudBase Storage（需登录，限制 2 MiB）
 *
 * 主入口只做"参数解析 + 鉴权 + 路由"，纯逻辑委托给 lib/（与 wxpay-order 共享同一份 lib）。
 *
 * lib/ 由 `pnpm sync:wxpay-lib` 从 cloudfunctions/wxpay-order/lib 同步，禁止直接修改本目录的 lib。
 */

'use strict'

const cloudbase = require('@cloudbase/node-sdk')

const { getAccountSnapshot, readMembership } = require('./account')
const {
  cancelAccountDeletion,
  finalizeAccountDeletion,
  getAccountDeletionStatus,
  requestAccountDeletion,
} = require('./account-deletion')
const { dispatchAuthenticatedAction } = require('./account-routing')
const { uploadAvatar } = require('./avatars')
const { getFollowingFeed } = require('./feed')
const { followUser, getRelation, listFollowers, listFollowing, unfollowUser } = require('./follows')
const {
  assertInternalServiceToken,
  assertUserId,
  handleAdminAdjustCoin,
  handleAdminBanAccount,
  handleAdminCorrectReward,
  handleAdminGrantReward,
  handleAdminUnbanAccount,
  handleDeductCoinForUser,
  handleExpireAccountRestrictions,
  handleGetAccountAccessForUser,
  handleGetAccountForUser,
} = require('./internal')
const { assertDeductCoinInput } = require('./lib/validation')
const {
  COIN_TX_COLLECTION,
  deductCoin,
} = require('./lib/wallet')
const { getUnreadCount, listNotifications, markRead } = require('./notifications')
const { listUserOrders } = require('./orders-query')
const { backfillDefaultNicknames, getProfile, upsertMyProfile } = require('./profiles')
const { createRewardClaimActionRouter, isRewardClaimAction } = require('./reward-claim-routing')
const { createRewardClaimRuntime } = require('./reward-claim-runtime')
const { assertRewardControlToken } = require('./reward-control-token')
const { listRewardHistory } = require('./rewards')
const { getSignInHistory, getSignInStatus, signIn } = require('./signin')
const {
  SyntheticAccountError,
  fixedSyntheticTransactionMeta,
  guardSyntheticSessionAction,
  handlePrepareSyntheticBaseline,
  handleSyntheticDeductCoinForUser,
} = require('./synthetic')
const { getAppSupport, getTipLeaderboard, tip } = require('./tips')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
let rewardClaimActionRouter

function getRewardClaimActionRouter() {
  if (!rewardClaimActionRouter) {
    const runtime = createRewardClaimRuntime(db)
    rewardClaimActionRouter = createRewardClaimActionRouter({
      service: runtime.service,
      assertInternalServiceToken,
    })
  }
  return rewardClaimActionRouter
}

/**
 * 匿名 / 占位身份集合。CloudBase 在「仅用公开 accessKey、未真正登录」时
 * 会以匿名身份调用云函数，getUserInfo().uid 可能为空或 'anon'。
 * 这类身份绝不能用于扣费 / 读取余额，否则会命中共享占位账户。
 */
const ANON_UIDS = new Set(['', 'anon'])

/** 当前调用者 uid（CloudBase Auth）；匿名 / 占位身份一律视为未登录返回 '' */
function getCallerUid() {
  try {
    const auth = app.auth()
    const info = auth.getUserInfo()
    const uid = info?.uid || ''
    return ANON_UIDS.has(uid) ? '' : uid
  }
  catch {
    return ''
  }
}

async function handleGetAccount(uid) {
  return getAccountSnapshot(db, uid)
}

async function handleGetMembership(uid) {
  return readMembership(db, uid)
}

async function handleDeductCoin(uid, event, classification) {
  const { appId, amount, bizId } = assertDeductCoinInput(event)
  const { balance, deduped } = await deductCoin(db, {
    userId: uid,
    appId,
    amount,
    bizId,
    meta: classification?.synthetic
      ? fixedSyntheticTransactionMeta(classification.identity, event.meta)
      : event.meta && typeof event.meta === 'object' ? event.meta : undefined,
    now: Date.now(),
  })
  return { balance, deduped: !!deduped }
}

async function handleListTransactions(uid, event) {
  const limit = Math.min(Math.max(Number(event.limit) || 20, 1), 100)
  // 按时间倒序分页；CloudBase 支持 orderBy + skip/limit
  const skip = Math.max(Number(event.skip) || 0, 0)
  const { data } = await db
    .collection(COIN_TX_COLLECTION)
    .where({ userId: uid })
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get()
  const items = Array.isArray(data) ? data : []
  return {
    items,
    nextSkip: items.length === limit ? skip + limit : null,
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** 路由分发（payload 同 SDK event 形态 { action, ... }）。纯逻辑，HTTP 包装见 main。 */
async function dispatch(event) {
  const { action } = event || {}
  if (isRewardClaimAction(action)) {
    return await getRewardClaimActionRouter().dispatch({
      event,
      callerUid: getCallerUid(),
    })
  }
  switch (action) {
    case 'prepareSyntheticBaseline':
      return await handlePrepareSyntheticBaseline(db, event)
    case 'deductSyntheticCoinForUser':
      return await handleSyntheticDeductCoinForUser(db, event)
    case 'deductCoinForUser':
      return await handleDeductCoinForUser(db, event)
    case 'getAccountForUser':
      return await handleGetAccountForUser(db, event)
    case 'getAccountAccessForUser':
      return await handleGetAccountAccessForUser(db, event)
    case 'adminAdjustCoin':
      return await handleAdminAdjustCoin(db, event)
    case 'adminBanAccount':
      return await handleAdminBanAccount(db, event)
    case 'adminUnbanAccount':
      return await handleAdminUnbanAccount(db, event)
    case 'expireAccountRestrictions':
      return await handleExpireAccountRestrictions(db, event)
    case 'adminGrantReward':
      return await handleAdminGrantReward(db, event)
    case 'adminCorrectReward':
      return await handleAdminCorrectReward(db, event)
    case 'getRewardCapabilities':
      assertRewardControlToken(event)
      return {
        protocolVersion: 1,
        coinAmounts: [100, 1000],
        membershipDays: [30, 90, 365],
        corrections: true,
        stableGrantId: true,
      }
    case 'backfillDefaultNicknames':
      // 运维一次性回填存量空 / 手机号昵称为「云游者_xxxx」，复用内部服务令牌鉴权
      assertInternalServiceToken(event?.serviceToken)
      return await backfillDefaultNicknames(db, { cursor: event.cursor, limit: event.limit, dryRun: event.dryRun, now: Date.now() })
    case 'finalizeAccountDeletion':
      assertInternalServiceToken(event?.serviceToken)
      return await finalizeAccountDeletion(db, { userId: event.userId, now: Date.now() })
      // 公开只读：应用支持榜 / 单应用支持详情（支持详情用可选 uid 标记 tippedByMe）
    case 'getTipLeaderboard':
      return await getTipLeaderboard(db, { limit: event.limit })
    case 'getAppSupport':
      return await getAppSupport(db, { userId: getCallerUid(), appId: event.appId })
      // 公开只读：用户资料 / 关系（关系用可选 uid 标记 isFollowing/isFollowedBy）
    case 'getProfile':
      return await getProfile(db, { userId: event.userId, login: event.login })
    case 'getRelation':
      return await getRelation(db, { viewerId: getCallerUid(), targetId: event.targetId })
    case 'listFollowing':
      return await listFollowing(db, { userId: event.userId, viewerId: getCallerUid(), skip: event.skip, limit: event.limit })
    case 'listFollowers':
      return await listFollowers(db, { userId: event.userId, viewerId: getCallerUid(), skip: event.skip, limit: event.limit })
    case 'getAccount':
    case 'getMembership':
    case 'deductCoin':
    case 'listTransactions':
    case 'listRewardHistory':
    case 'listOrders':
    case 'requestAccountDeletion':
    case 'getAccountAccessStatus':
    case 'getAccountDeletionStatus':
    case 'cancelAccountDeletion':
    case 'uploadAvatar':
    case 'signIn':
    case 'getSignInStatus':
    case 'getSignInHistory':
    case 'tip':
    case 'followUser':
    case 'unfollowUser':
    case 'upsertMyProfile':
    case 'getFollowingFeed':
    case 'getUnreadCount':
    case 'listNotifications':
    case 'markNotificationsRead': {
      const uid = getCallerUid()
      if (!uid)
        throw new Error('请先登录')
      const classification = await guardSyntheticSessionAction(db, uid, action)
      const now = Date.now()
      return await dispatchAuthenticatedAction(db, {
        userId: uid,
        action,
        now,
        handlers: {
          getAccount: () => handleGetAccount(uid),
          getMembership: () => handleGetMembership(uid),
          deductCoin: () => handleDeductCoin(uid, event, classification),
          listTransactions: () => handleListTransactions(uid, event),
          listRewardHistory: () => listRewardHistory(db, { userId: uid, skip: event.skip, limit: event.limit }),
          listOrders: () => listUserOrders(db, { userId: uid, skip: event.skip, limit: event.limit }),
          requestAccountDeletion: () => requestAccountDeletion(db, { userId: uid, now }),
          getAccountDeletionStatus: () => getAccountDeletionStatus(db, { userId: uid, now }),
          cancelAccountDeletion: () => cancelAccountDeletion(db, { userId: uid, now }),
          uploadAvatar: () => uploadAvatar(app, { userId: uid, avatar: event.avatar, now }),
          signIn: () => signIn(db, { userId: uid, now }),
          getSignInStatus: () => getSignInStatus(db, { userId: uid, now }),
          getSignInHistory: () => getSignInHistory(db, { userId: uid, now }),
          tip: () => tip(db, { userId: uid, appId: event.appId, now }),
          followUser: () => followUser(db, { followerId: uid, followingId: event.targetId, now }),
          unfollowUser: () => unfollowUser(db, { followerId: uid, followingId: event.targetId, now }),
          upsertMyProfile: () => upsertMyProfile(db, { userId: uid, profile: event.profile, now }),
          getFollowingFeed: () => getFollowingFeed(db, { userId: uid, skip: event.skip, limit: event.limit }),
          getUnreadCount: () => getUnreadCount(db, { userId: uid }),
          listNotifications: () => listNotifications(db, { userId: uid, skip: event.skip, limit: event.limit }),
          markNotificationsRead: () => markRead(db, { userId: uid, ids: event.ids, now }),
        },
      })
    }

    default:
      throw new Error(`未知 action: ${action}`)
  }
}

/**
 * 入口兼容两种调用：
 *   - SDK callFunction（带登录态）：event = { action, ... }，返回纯对象。
 *   - CloudBase HTTP 访问服务（server 端 fetch，无登录态，仅公开 action 可用，如 SSR 取 getProfile）：
 *     event = { httpMethod, headers, body }（body 为 JSON 字符串），返回 { statusCode, headers, body }。
 *     登录 / 内部 action 在 HTTP 入口因拿不到登录态 / token 自然被拒，不会越权。
 */
exports.main = async (event) => {
  const isHttp = !!(event && event.httpMethod)
  if (isHttp && event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }

  let payload = event || {}
  if (isHttp) {
    try {
      payload = event.body ? JSON.parse(event.body) : {}
    }
    catch {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: '请求体不是合法 JSON' }) }
    }
  }

  try {
    const result = await dispatch(payload)
    return isHttp
      ? { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(result) }
      : result
  }
  catch (err) {
    console.error('[account-api] 处理失败:', payload.action, err.message)
    if (isHttp) {
      return {
        statusCode: Number.isInteger(err?.httpStatus)
          ? err.httpStatus
          : err instanceof SyntheticAccountError
            ? err.httpStatus
            : 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message, code: err.code }),
      }
    }
    throw err
  }
}

exports._private = {
  assertInternalServiceToken,
  assertUserId,
  handleAdminAdjustCoin,
  handleAdminBanAccount,
  handleAdminCorrectReward,
  handleAdminGrantReward,
  handleAdminUnbanAccount,
  handleDeductCoinForUser,
  handleSyntheticDeductCoinForUser,
  handleGetAccountForUser,
  handleGetAccountAccessForUser,
  handleExpireAccountRestrictions,
}
