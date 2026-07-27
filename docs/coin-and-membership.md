# 云币 + 跨应用会员 — 共享支付/账户中心设计

> 状态：核心账户/支付能力已编码落地并有单测覆盖；生产侧仍需确认 CloudBase 集合、索引、安全规则和云函数部署。
> 关联代码：`cloudfunctions/account-api`、`cloudfunctions/wxpay-order`、`cloudfunctions/wxpay-notify`、`cloudfunctions/iap-order`、`cloudfunctions/appstore-notify`、`app/composables/useCoin.ts`、`app/composables/useCoinRecharge.ts`、`app/pages/wallet.vue`、`app/types/payment.ts`
> 云空间配额中心见 [`docs/storage-quota.md`](./storage-quota.md)。

## 1. 背景与目标

当前微信支付链路（下单 / 验签 / 回调 / 兜底查单 / 并发安全）已抽成依赖注入的纯函数库
（`cloudfunctions/wxpay-order/lib/`），质量良好但**强耦合单一业务**：套餐写死 `basic`、
描述写死「云乐坊」、会员表只服务云乐坊一个应用。

目标是把它从「云乐坊的功能」升级为「平台级账户/支付中心」，让后续的小应用零成本接入。
账户中心向所有子应用提供**两类资产**：

| 资产     | 名称                         | 性质                   | 回答的问题                    |
| -------- | ---------------------------- | ---------------------- | ----------------------------- |
| 消费货币 | **云币**（coin）             | 可消费、按次/按量扣    | 「你有多少钱花」              |
| 权益身份 | **云乐坊会员**（membership） | 按时间授权、跨应用共享 | 「你是不是 VIP / 享什么特权」 |

两者**资产层面正交**：各自独立账本、独立充值入口。会员对云币的影响仅以「权益」形式叠加
（见 [§5](#5-会员--云币交互规则)）。

云空间配额是会员权益在账号中心的另一个全局派生能力：普通用户 100MB、会员用户 1GB，
单文件 200MB，所有应用通过 `user-storage-api` 的 storage action 共享同一套
`user_storage_quotas` / `user_storage_files`。它不改变云币账本，只读取会员状态并懒同步
`quotaBytes`；详细状态机和接口见 [`storage-quota.md`](./storage-quota.md)。

### 关键前提（已确认）

- 所有子应用**共用同一个微信商户号**（同一结算主体）→ 支付网关零改动复用，仅需引入 `appId` 做归属/对账。
- 所有子应用**共用同一套 CloudBase Auth**（同一 `uid` 体系）→ 账户天然跨应用共享。

## 2. 架构总览

```
   小应用 A ──┐      ┌──────────────────────────────────────────┐
   小应用 B ──┼─────▶│           平台账户 / 支付中心              │
   云乐坊   ──┘      │  wxpay-order   下单（充值云币 / 买会员）    │
                    │  wxpay-notify  微信回调 → 入账云币 / 开通会员 │
                    │  account-api   查账户 / 扣云币 / 流水        │ ← 新增
                    └──────────────────────────────────────────┘
                              │  统一 CloudBase Auth uid
              ┌───────────────┴───────────────┐
        user_wallet（云币余额）          user_memberships（全局会员）
        coin_transactions（流水）        orders（订单，带 appId）
```

- **真相源职责边界**：支付中心只维护「云币余额 / 会员等级 / 会员到期时间」这三个事实。
  「会员能解锁哪些功能」由各子应用**自行定义**（本地 `level → features` 映射），支付中心不感知。
  这样新增应用、新增权益都不需要改支付中心。

## 3. 数据模型

### 3.1 `user_wallet` — 云币钱包（新增，跨应用共享余额）

```jsonc
{
  "_id": "<cloudbase uid>",
  "userId": "<cloudbase uid>",
  "balance": 1280, // 云币余额（整数，最小单位 = 1 云币）
  "version": 7, // 乐观锁版本号，每次变更 +1
  "createdAt": 1735689000000,
  "updatedAt": 1735689600000
}
```

索引：`idx_user`（`userId` ASC，**唯一**）。

> 云币用整数计量，避免浮点。定价时 1 云币 = 多少人民币由充值套餐决定（见 §3.4）。

### 3.2 `coin_transactions` — 云币流水（新增，审计 + 对账）

```jsonc
{
  "_id": "<doc>",
  "userId": "<cloudbase uid>",
  "appId": "yunle", // 哪个应用产生的流水，便于分应用对账/分成
  "type": "recharge", // recharge | consume | refund | gift
  "amount": 1000, // 正=入账，负=扣减
  "balanceAfter": 1280, // 变更后余额（便于审计与回放）
  "refId": "YLF1735689000000abcdef", // 充值=outTradeNo；消费=业务 bizId；赠币=订单号
  "meta": {}, // 业务自定义（如消费场景、数量）
  "createdAt": 1735689600000
}
```

索引：`idx_user_time`（`userId` ASC, `createdAt` DESC，非唯一）、
可选 `idx_app_time`（`appId` ASC, `createdAt` DESC）用于按应用对账。

### 3.3 `user_memberships` — 会员（单一主键，去耦合）

`level` 取代写死的 `planId`，**一个用户一条全局记录、不带 appId**——
这正是「跨应用共享会员」的天然形态。

```jsonc
{
  "_id": "<cloudbase uid>",
  "level": "basic", // 会员等级，预留多档（basic / pro …）
  "activeCycle": "month", // month | year
  "expireAt": 1738367600000, // 毫秒时间戳
  "billingAnchorDay": 31, // Asia/Shanghai 账单日
  "billingAnchorIsMonthEnd": true, // 首次开通是否发生在月末
  "lastOrderId": "YLF…",
  "createdAt": 1735689000000,
  "updatedAt": 1735689600000
}
```

`_id` 就是 CloudBase `uid`，由内建主键索引保证一个用户最多一条会员记录；
不再重复存储 `userId`，也不需要额外的用户唯一索引。

> 迁移：现有文档的 `planId: "basic"` 语义等同于 `level: "basic"`。可在读取层做兼容
> （`level ?? planId`），无需一次性刷数据。详见 [§7](#7-迁移方案)。

#### 会员计费周期规则

- 月付按 **Asia/Shanghai 自然月**顺延，年付按 **自然年**顺延；时间戳仍以 UTC 毫秒存储。
- 正常情况取下月或次年同日、同一时间；首次开通发生在月末时，后续周期始终取目标月份月末。
- 非月末账单日由 `billingAnchorDay` 保留；目标月份没有对应日期时临时取该月最后一天，后续月份恢复原账单日。例如
  `1 月 30 日 -> 2 月 28/29 日 -> 3 月 30 日`。
- `billingAnchorIsMonthEnd` 明确记录月末策略。例如 `4 月 30 日 -> 5 月 31 日 -> 6 月 30 日`。
- 有效会员提前续费时从当前 `expireAt` 顺延；已过期会员从本次支付时间重新起算并重置账单锚点。微信订单使用支付确认时间，IAP 会员订单使用 Apple 签名交易中的 `purchaseDate`。
- 历史会员两个账单锚点字段都缺失时，首次续费从现有 `expireAt` 推导并补写；已有 `billingAnchorDay` 但缺少月末标记的记录继续沿用“指定日 + 短月截断”策略，不修改已经发放的到期时间。
- 运营活动明确写“赠送 N 天”的会员奖励仍按固定天数发放，不属于月付或年付套餐；奖励到账后以新的到期时间重置账单锚点，避免后续付费续期回跳到奖励前的日期。
- IAP 会员退款仅在该订单仍是当前最后一次会员变更、且发放快照匹配时回滚该笔权益；存在后续购买或缺少可靠快照时保留当前会员并标记人工复核，避免误清空叠加权益。

### 3.4 `orders` — 订单（沿用现状，加字段）

新增 `appId`、`orderType`，并按类型携带 `coinAmount` 或 `level`：

```jsonc
{
  // …现有字段（userId / amount / payType / status / outTradeNo / …）
  "appId": "yunle",
  "orderType": "recharge_coin", // recharge_coin（买云币）| membership（买会员）
  "coinAmount": 1000, // orderType=recharge_coin 时：到账云币数
  "level": "basic", // orderType=membership 时：会员等级
  "billingCycle": "month" // orderType=membership 时：month | year
}
```

> `amount` 仍是实付人民币（分）。`coinAmount` 与 `amount` 的换算关系由**充值套餐表**定义，
> 不在订单里硬编码，避免被前端篡改（金额校验沿用现有 `getPlanAmount` 风格的服务端权威表）。

### 3.5 充值套餐表（替代写死的 `plans.js`）

把 `plans.js` 从「只认 basic」改造成按 `appId` + `orderType` 取权威价：

**定价（已定稿）**：100 云币 = 10 元，即 **1 云币 = 10 分**（线性换算，无折扣档）。

```js
// 云币充值套餐：packId -> { amount(分), coin }，满足 amount = coin * 10
const COIN_PACKS = {
  coin_100: { amount: 1000, coin: 100 }, // 10 元
  coin_500: { amount: 5000, coin: 500 }, // 50 元
  coin_1000: { amount: 10000, coin: 1000 }, // 100 元
}

// 会员套餐：level -> { month, year }（分）
const MEMBERSHIP_PRICES = {
  basic: { month: 1000, year: 10000 }, // 10 元 / 100 元
}
```

服务端下单时**只信这张表**：前端传 `packId` / `level+cycle`，金额由表查出，前端无权指定金额。
下单时额外校验 `amount === coin * 10`（汇率守恒），防止套餐表配错价。

## 4. 云函数接口

### 4.1 `wxpay-order`（扩展现有 action）

| action            | 说明                                                                 | 关键入参                                                                        |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `createOrder`     | 统一下单。按 `orderType` 分支：买云币 or 买会员                      | `appId`, `orderType`, `packId`?/`level`+`billingCycle`?, `payType`, `wxOpenid`? |
| `queryOrder`      | 查询订单（本地 + 微信兜底）。沿用现状，兜底成功后按 `orderType` 入账 | `outTradeNo`                                                                    |
| `createTestOrder` | 测试下单。沿用现状（默认禁用，`WX_ALLOW_TEST_ORDER=true` 才启用）    | `amount`, `payType`                                                             |

> 下单主入口保持「参数解析 + 鉴权 + 路由」职责，纯逻辑全部委托 `lib/`，与现有风格一致。

### 4.2 `account-api`（新增云函数）

| action             | 说明               | 入参                                | 返回                                                  |
| ------------------ | ------------------ | ----------------------------------- | ----------------------------------------------------- |
| `getAccount`       | 一次拿到账户全貌   | —                                   | `{ coin, membership: { isActive, level, expireAt } }` |
| `deductCoin`       | 按次扣云币（核心） | `appId`, `amount`, `bizId`, `meta?` | `{ balance }` 或抛「余额不足」                        |
| `listTransactions` | 云币流水分页       | `cursor?`, `limit?`                 | `{ items, nextCursor }`                               |

- `deductCoin` 必须在服务端鉴权（`uid` 来自 CloudBase Auth），子应用不能伪造他人 uid。
- `bizId` 用于**幂等**：同一 `bizId` 重复调用只扣一次（见 §6）。
- 云空间 action 已迁到独立 `user-storage-api`：`account-api` 只保留账户 / 云币 / 会员职责。

### 4.3 各子应用接入（客户端三步）

```ts
// 1) 拉账户：决定 UI（会员标识 / 余额）
const acct = await callAccount('getAccount')
// → { coin: 1280, membership: { isActive: true, level: 'basic', expireAt } }

// 2) 权益判断：本地定义会员能解锁什么
if (acct.membership.isActive) { /* 解锁高级功能 / 去广告 / … */ }

// 3) 按次消费：扣云币（会员免扣费场景见 §5）
await callAccount('deductCoin', { appId: 'xxx', amount: 50, bizId })
```

支付网关、验签、回调、对账子应用完全不碰。

## 5. 会员 × 云币交互规则

资产层正交，叠加一条会员权益（已确认；「会员赠币」已决定**不做**）：

### 5.1 完全正交（底座）

会员状态与云币余额互不影响。会员只解锁权益，云币单独消费。这是默认行为。

### 5.2 会员免扣费（free）

某些按次扣费的功能，会员期内直接免费（不扣云币）。

- 实现：扣费决策放在**子应用**，而非平台。子应用调 `deductCoin` 前先看 `membership.isActive`
  与本地「该功能是否会员免费」规则；若免费则跳过扣费。需要统计会员节省金额时，在子应用自己的业务日志记录
  `waived:true`；平台 `deductCoin` 只接受正整数扣费，不写 0 额流水。
- 平台 `deductCoin` 不感知「哪个功能对会员免费」，保持解耦。

> 这样的分工：**平台只回答「是不是会员」**，免扣费/折扣的具体业务规则留在各应用，
> 平台无需为每个应用维护权益矩阵。

## 6. 并发安全（关键）

沿用现有 `activateMembership` 的乐观锁 / CAS 思路，云币扣费同理：

### 6.1 扣云币：CAS + 余额充足条件化

```js
async function deductCoin(db, { userId, appId, amount, bizId, meta }) {
  // 幂等：bizId 已存在流水则直接返回，不重复扣
  if (bizId && await txExists(db, userId, bizId))
    return { balance: await currentBalance(db, userId) }

  for (let i = 0; i < MAX_RETRY; i++) {
    const w = await getWallet(db, userId)
    if (!w || w.balance < amount)
      throw new Error('云币余额不足')
    const res = await db.collection('user_wallet')
      .where({ userId, version: w.version }) // 乐观锁条件
      .update({ balance: _.inc(-amount), version: _.inc(1), updatedAt: now })
    if ((res.updated ?? 0) > 0) {
      await db.collection('coin_transactions').add({
        userId,
        appId,
        type: 'consume',
        amount: -amount,
        balanceAfter: w.balance - amount,
        refId: bizId,
        meta,
        createdAt: now,
      })
      return { balance: w.balance - amount }
    }
    // 被并发改写，重读重试
  }
  throw new Error('扣费并发冲突，请重试')
}
```

### 6.2 充值入账：依赖回调幂等

充值入账写在 `wxpay-notify` 的 `markOrderPaid`**成功之后**（`updated > 0` 才入账），
`markOrderPaid` 的 `where({ status: 'pending' })` 条件更新已保证同一订单只入账一次。
入账动作：`balance: _.inc(coinAmount)` + 写 `type:'recharge'` 流水（`refId = outTradeNo`）。

> ⚠️ CloudBase NoSQL 无跨集合事务。"标记订单已支付"与"钱包入账"是两步，
> 若入账失败需可补偿：以 `orders.status='paid'` 但无对应 `recharge` 流水为依据，
> 提供补偿脚本/兜底（与现有「兜底开通会员失败需人工补偿」同构）。

## 7. 迁移方案

1. **会员表**：`planId` → `level` 语义兼容，读取层 `level ?? planId`，不强刷。
2. **订单表**：历史订单无 `appId`/`orderType`，读取层默认 `appId='yunle'`、
   `orderType='membership'`，新订单一律写全字段。
3. **现有会员折算云币**（可选）：如需给老会员发云币，用一次性脚本写 `type:'gift'` 流水 + 入账，
   `refId='migrate:<userId>'` 保证只发一次。
4. **双轨并存**：云乐坊继续卖会员，新应用走云币；`orderType` 字段就是为双轨预留。

## 8. 合规要点（云币）

- 云币定位为**虚拟商品 / 平台内消费凭证**：必须在用户协议中写明
  **不可提现、不可转账、不可兑换人民币**。这是它比「人民币余额」合规友好的根本。
- 退款只退**未消费**部分，按原路退回微信；已消费云币不退。
- 充值开发票按实付人民币金额；赠送的云币不计入开票额。
- 流水（`coin_transactions`）是对账与客诉处理的依据，**只追加不修改**。

## 9. 索引清单（汇总）

| 集合                      | 索引                 | 字段                   | 唯一 |
| ------------------------- | -------------------- | ---------------------- | ---- |
| `orders`                  | `idx_outTradeNo`     | `outTradeNo`           | 唯一 |
| `orders`                  | `idx_userId_status`  | `userId`, `status`     | 否   |
| `orders`                  | `idx_app_type`（新） | `appId`, `orderType`   | 否   |
| `user_memberships`        | `_id_`（内建）       | `_id`（CloudBase uid） | 唯一 |
| `user_wallet`（新）       | `idx_user`           | `userId`               | 唯一 |
| `coin_transactions`（新） | `idx_user_time`      | `userId`, `createdAt`↓ | 否   |
| `coin_transactions`（新） | `idx_app_time`       | `appId`, `createdAt`↓  | 否   |

## 10. 落地状态（代码侧）

1. [x] `lib/plans.js` 已拆为 `COIN_PACKS` + `MEMBERSHIP_PRICES`，并支持预设充值包与自定义云币数量；前端常量从 `@yunlefun/types` re-export。
2. [x] `lib/wallet.js` 已实现 `creditCoin` / `deductCoin` / `clawbackCoin` / `getWallet`，含 CAS 重试与 refId/bizId 幂等；`bizId` 在入参校验层已设为必填。
3. [x] `wxpay-order/index.js` 已按 `orderType` 分支下单；`queryOrder` / `reconcileOrders` 可兜底补发会员或云币。
4. [x] `wxpay-notify` / `iap-order` / `appstore-notify` 已复用同一套发放逻辑，按 `orderType` 入账云币、开通会员或退款追回。
5. [x] `account-api` 已提供 `getAccount` / `deductCoin` / `listTransactions` / `listOrders`，并扩展签到、投币、关注、通知、资料等账户中心能力。
6. [x] 前端已接入钱包页、云币充值弹窗、订单/流水展示、每日签到热力图、投币与账户 composable。
7. [ ] 生产运维仍需逐项确认：`user_wallet`、`coin_transactions`、`app_tip_stats`、`app_supporters` 等集合/索引/安全规则已在 CloudBase 环境生效；相关云函数均已重新部署。

## 11. 签到 / 投币 / 首充礼包（2026-06 新增，已落地）

在底座之上叠加三类「云币增长 / 消耗」玩法。三者都复用既有账本与幂等机制，**仅 `lib/orders.js`
一处改动同步库**（首充礼包），其余为 `account-api` 本地新增。

### 11.1 每日签到（signIn / getSignInStatus）

- 规则：免费用户每日 **1** 云币，会员每日 **2** 云币；按**东八区**自然日切日。
- 入账：`creditCoin(type:'gift', refId:'signin:<uid>:<东八区日>')`，同日重复签到命中
  `idx_ref_uniq` 幂等、不重复发。
- 代码：`account-api/signin.js`、`account-api/datetime.js`（`cstDateKey`）。
- ⚠️ 仅登录态可签（匿名 uid 在 index.js 入口已拦截）。

### 11.2 投币打赏（tip / getAppSupport / getTipLeaderboard）

- 规则（B 站式）：每次 **1** 云币，**每应用每日上限 2 次**；投出的币转为应用「热度」，
  **不进开发者钱包、不可提现**；首投成为该应用「支持者」。
- 扣减：`deductCoin(type:'consume', bizId:'tip:<uid>:<appId>:<日>:<slot>')`。**slot（1..上限）
  即当日第几次**——封顶与幂等合一：取首个未占用 slot，用尽即达上限；同 slot 重放由 `bizId` 去重。
- 计数：扣减成功后增 `app_tip_stats`（CAS）、`app_supporters`（唯一去重支持者）；二者为派生缓存，
  以流水为真相源可重算。
- 校验：目标应用须存在且公开；**禁止给自己应用投币**（`app.ownerId === uid`）。
- 代码：`account-api/tips.js`。

### 11.3 首充礼包（评估后暂缓）

首充赠币（首次充值送 100 云币）是常见的转化杠杆，但**本期不做**，原因：

- 云币的消耗场景（应用按次扣费）尚未真正落地、投币也才上线——给一个还没什么用处的
  货币做首充折扣为时过早；转化杠杆应在「币有真实需求」之后再上。
- 它会引入跨渠道复杂度：iOS IAP 有自动退款→追回链路（只追回已购币、不追回赠币）
  会留「退款仍保留赠币」的薅羊毛口子，且 Apple 抽成 30%。

> 当云币有真实消耗需求后，可作为一次性增长实验重新引入：在 `grantOrderEntitlement` 的
> `recharge_coin` 分支挂一笔 `creditCoin(type:'gift', refId:'firstcharge:<uid>')`
> （refId 全局唯一 = 一生一次幂等，无需查询「是不是首充」），并按需限定渠道。

### 11.4 account-api 新增 action

| action              | 鉴权 | 入参     | 返回                                                            |
| ------------------- | ---- | -------- | --------------------------------------------------------------- |
| `signIn`            | 登录 | —        | `{ balance, reward, alreadySigned, dateKey }`                   |
| `getSignInStatus`   | 登录 | —        | `{ signedToday, reward, dateKey, isMember }`                    |
| `tip`               | 登录 | `appId`  | `{ balance, tipped, slot, remainingToday, isNewSupporter }`     |
| `getAppSupport`     | 公开 | `appId`  | `{ totalCoins, supporterCount, tipCount, tippedByMe, myCoins }` |
| `getTipLeaderboard` | 公开 | `limit?` | `{ items: [{ appId, totalCoins, supporterCount, tipCount }] }`  |

### 11.5 上线 checklist（建表 + 部署）

1. 新建集合与索引：`app_tip_stats`（`idx_app` 唯一）、`app_supporters`（`idx_app_user` 唯一）。
2. 安全规则：两者均 **ADMINONLY**（仅云函数读写；前端经 account-api 间接访问）。
3. `pnpm test` 全绿。
4. `tcb functions deploy account-api`（本期无同步库改动，仅此一个云函数）。
5. 前端 push main 自动部署（EdgeOne）。

---

> 已定稿：① 定价 100 云币 = 10 元（1 云币 = 10 分，线性）；② 充值「等额赠币」**不做**——
> 会员权益本期以「每日签到差异（免费 1 / 会员 2）」体现（见 §11）。
> ③ `coin_transactions.type` 的 `gift` 现已用于**每日签到**，`consume` 复用于**投币**。
> 仍待定（不阻塞）：老会员折算云币；退款策略（已消费云币不退）。
