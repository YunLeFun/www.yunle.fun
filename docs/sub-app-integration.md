# 子应用接入指南：账号 / 同步 / 支付 / 会员 / 云币

> 面向：想接入云乐坊统一账户体系的其他小应用。
> 关联：[跨站 SSO 接入（一套账号多站免登）](./sso-integration.md)、[云币 + 跨应用会员设计](./coin-and-membership.md)。

云乐坊把「统一账号 + 轻量同步 + 微信支付 + 会员 + 云币」沉淀成了平台级账户中心，新应用零成本接入。
本指南讲清楚**怎么接**。

## 0. 前提

接入方必须满足以下三点（满足后即天然共享账户）：

1. **同一 CloudBase 环境**：子应用与云乐坊跑在同一个 env（`yunlefun-8g7ybcxc7345c490`）。
2. **同一登录体系**：用同一套 CloudBase Auth，用户的 `uid` 全平台一致。
3. **同一微信商户号**：充值/支付走平台统一的商户配置（子应用无需自己配微信）。

> 如果你的小应用是独立 env 或独立商户，需要先做多租户改造，不在本指南范围。

> **前置：先有登录态。** 本指南所有接口都要求登录态（服务端从 CloudBase Auth 取 `uid`）。
> 跨域名共享登录请先接 [跨站 SSO](./sso-integration.md)——用户在主站登录一次，子站静默免登，`uid` 全平台一致。

## 1. 核心概念

平台账户 = 一个用户（`uid`）下的身份与资产事实。身份只证明「你是谁」，资产只回答「余额 / 会员是否有效」；子应用的业务内容不要塞进用户资料里。

### 数据分层

| 层级         | 归属                            | 用途                                         | 示例                                          |
| ------------ | ------------------------------- | -------------------------------------------- | --------------------------------------------- |
| 统一账号     | CloudBase Auth / 云乐坊账户中心 | 身份、手机号/邮箱、昵称头像、登录态          | `uid`、`user_metadata`                        |
| 通用轻量同步 | `ylf_user_app_state`            | 草稿、偏好、最近编辑状态                     | 当前表单内容、主题偏好、历史输入              |
| 应用业务数据 | 子应用自己的集合                | 用户主动保存的业务内容、多条记录、可编辑列表 | `chat_generator_sessions`、项目文档、作品草稿 |

**不要直接复用用户信息存业务数据。** 用户资料只放账号展示与登录所需字段；业务内容需要查询、列表、编辑、删除或长期保存时，建应用自己的集合。

| 资产                         | 是什么                                 | 你用它来                   |
| ---------------------------- | -------------------------------------- | -------------------------- |
| **云币**（coin）             | 可消费的虚拟货币，1 云币 = 10 分       | 按次/按量扣费              |
| **云乐坊会员**（membership） | 按时间授权的权益身份（全局，不分应用） | 判断是否 VIP、解锁高级功能 |

两者**正交**：云币管「有没有钱花」，会员管「是不是 VIP」。

### appId 约定

每个子应用有一个稳定的 `appId`（小写字母/数字/`-`/`_`，≤32 位），用于：

- 云币流水归属（`coin_transactions.appId`）→ 便于分应用对账
- 订单归属（`orders.appId`）

云乐坊主站用 `yunle`。**接入前先给你的应用起一个 appId**（如 `my-tool`），全程保持一致。

## 2. 三件事

子应用通常需要这四类能力：

### ⓪ 云端草稿 / 偏好同步

一方可信 Web 子应用可在登录后直接用 CloudBase Web SDK 写通用集合：

- 集合：`ylf_user_app_state`
- 文档 ID：`${uid}:${appId}:${namespace}`
- 关键字段：`uid`, `appId`, `namespace`, `schemaVersion`, `payload`, `createdAt`, `updatedAt`
- 适用内容：当前草稿、偏好、最近输入、轻量 UI 状态
- 不适用内容：用户主动保存的多条作品、对话、项目、订单、公开内容

推荐权限：

```json
{
  "read": "auth.uid == doc.uid",
  "create": "auth.uid != null && request.data.uid == auth.uid",
  "update": "auth.uid == doc.uid && (request.data.uid == undefined || request.data.uid == auth.uid)",
  "delete": false
}
```

`appId` 是一方应用约定，用于命名和排查，不作为强安全边界；真正的隔离边界是 `uid` 和 CloudBase 权限规则。

业务内容应建自己的集合。例如 `chat-generator` 将用户主动保存的文案对话放在 `chat_generator_sessions`，字段包含 `uid`, `title`, `messagesText`, `me`, `she`, `tags`, `visibility`, `source`, `createdAt`, `updatedAt`，权限同样按 `auth.uid == doc.uid` 隔离。

### ① 判断会员 / 解锁权益

平台只回答「是不是会员 / 什么等级 / 到期时间」。**「会员能解锁什么功能」由你的应用自己定义**——
在你的代码里维护一张 `level → features` 映射即可，平台不感知，解耦最彻底。

### ② 消费云币（按次扣费）

调 `account-api` 的 `deductCoin`，传你的 `appId`、扣费数量、业务幂等键 `bizId`。

### ③ 充值云币

复用 `wxpay-order` 的 `createOrder`（`orderType: 'recharge_coin'`），微信支付成功后自动入账。
通常直接把用户导到云乐坊钱包页 `/wallet` 充值即可，子应用无需自己实现充值 UI。

## 3. 接入方式 A：Nuxt / Vue 项目（推荐）

如果你的小应用也是 Nuxt + `@cloudbase/js-sdk`，直接复用云乐坊的 composable 模式。

### 拉账户 + 判断会员

```ts
const coin = useCoin() // 来自 app/composables/useCoin.ts

onMounted(() => coin.refresh()) // 登录后拉取账户

// 余额
coin.balance.value // number，云币余额
// 会员
coin.isMember.value // boolean，会员是否有效
coin.membership.value // { isActive, level, expireAt } | null

// 解锁权益（你的应用自定义）
const FEATURES_BY_LEVEL = { basic: ['hd-export', 'no-ads'] }
function canUse(feature: string) {
  const lvl = coin.membership.value?.level
  return !!lvl && FEATURES_BY_LEVEL[lvl]?.includes(feature)
}
```

### 按次扣费

```ts
const coin = useCoin()

async function exportHD() {
  // 会员免扣费（见 §5），否则扣 50 云币
  if (!coin.isMember.value) {
    try {
      await coin.deduct({
        appId: 'my-tool',
        amount: 50,
        bizId: `export:${taskId}`, // 幂等键：同一 taskId 只扣一次
        meta: { feature: 'hd-export' },
      })
    }
    catch (e) {
      // 余额不足 → 引导充值
      toast.add({ title: '云币不足', description: '前往钱包充值', color: 'warning' })
      navigateTo('https://www.yunle.fun/wallet')
      return
    }
  }
  doExport()
}
```

### 充值入口

最简单：跳转云乐坊钱包页（统一充值/流水体验）：

```ts
navigateTo('https://www.yunle.fun/wallet')
```

如需在应用内充值，复用 `useCoinRecharge()` + `<CoinRechargeModal>`（见 `app/pages/wallet.vue`）。

## 4. 接入方式 B：任意前端（直接调云函数）

非 Nuxt 项目，用 `@cloudbase/js-sdk` 直接 `callFunction`。

```ts
import cloudbase from '@cloudbase/js-sdk'

const app = cloudbase.init({ env: 'yunlefun-8g7ybcxc7345c490' })
const auth = app.auth()
// ……完成登录，确保 auth 已有用户态……

// 查账户
const { result: account } = await app.callFunction({
  name: 'account-api',
  data: { action: 'getAccount' },
})
// account = { coin, membership: { isActive, level, expireAt } }

// 扣云币
const { result } = await app.callFunction({
  name: 'account-api',
  data: { action: 'deductCoin', appId: 'my-tool', amount: 50, bizId: 'export:123' },
})
// result = { balance, deduped }

// 流水分页
const { result: txs } = await app.callFunction({
  name: 'account-api',
  data: { action: 'listTransactions', skip: 0, limit: 20 },
})
// txs = { items: CoinTransaction[], nextSkip: number | null }
```

### account-api 接口速查

| action             | 入参                                        | 返回                                                  |
| ------------------ | ------------------------------------------- | ----------------------------------------------------- |
| `getAccount`       | —                                           | `{ coin, membership: { isActive, level, expireAt } }` |
| `deductCoin`       | `appId`, `amount`(正整数), `bizId`, `meta?` | `{ balance, deduped }` 或抛「云币余额不足」           |
| `listTransactions` | `skip?`, `limit?`(≤100)                     | `{ items, nextSkip }`                                 |

> 所有接口都要求登录态（服务端从 CloudBase Auth 取 `uid`，**前端无法伪造他人 uid**）。

### 充值下单（wxpay-order）

```ts
const { result } = await app.callFunction({
  name: 'wxpay-order',
  data: {
    action: 'createOrder',
    orderType: 'recharge_coin',
    appId: 'my-tool',
    packId: 'coin_500', // coin_100 | coin_500 | coin_1000
    payType: 'native', // native 扫码 | jsapi | h5
  },
})
// result.codeUrl → 渲染二维码；再轮询 queryOrder 确认支付，成功后云币自动入账
```

充值套餐（与服务端一致，定义在 `app/types/payment.ts` 的 `COIN_PACKS`；也支持传 `coin` 做自定义数量，服务端按 1 云币 = 10 分计价并校验范围）：

| packId      | 云币 | 价格 |
| ----------- | ---- | ---- |
| `coin_100`  | 100  | ¥10  |
| `coin_500`  | 500  | ¥50  |
| `coin_1000` | 1000 | ¥100 |

## 5. 会员权益模式

平台给的是**事实**，不是**规则**。两种常见用法：

- **解锁功能**：`isMember` 为真就放开高级功能（你的应用自己定义哪些功能）。
- **会员免扣费**：某些按次扣费的功能，会员期内免费——**判断放在你的应用**：扣费前先看
  `coin.isMember.value`，是会员就跳过 `deductCoin`。平台 `deductCoin` 不感知「谁该免费」，保持解耦。

> 已上线规则：资产层正交 + 会员免扣费。**会员赠币已决定不做**；会员差异权益通过「每日签到免费 1 / 会员 2」与各应用自定义免扣费体现。

## 6. 关键约束 & 最佳实践

1. **幂等**：`deductCoin` 一定要传 `bizId`（业务唯一键，如 `export:<taskId>`）。同一 `bizId`
   重复调用只扣一次，返回 `{ deduped: true }`。这能防止重试/双击导致重复扣费。
2. **余额不足**：`deductCoin` 余额不足会抛错（message 含「余额不足」），不产生流水。捕获后引导充值。
3. **不可信前端金额**：扣费数量 `amount` 由你的**服务端逻辑**决定并校验，别让前端随意传大额；
   敏感扣费建议放到你自己的云函数里再调 `deductCoin`，而非前端直接调。
4. **云币是虚拟商品**：不可提现、不可转账、不可兑换人民币（已写入用户协议）。退款只退未消费部分。
5. **流水只追加**：`coin_transactions` 只增不改，是对账与客诉依据。

## 7. 接入 checklist

- [ ] 确认与云乐坊同 env、同 Auth、同商户号
- [ ] 给应用定一个 `appId`
- [ ] 接入 `@yunlefun/sso@^0.3.1` 与 `@cloudbase/js-sdk@^3.6.2`
- [ ] 轻量草稿/偏好写 `ylf_user_app_state`，业务内容建应用自己的集合
- [ ] 配置集合权限：所有用户私有数据均按 `auth.uid == doc.uid` 隔离
- [ ] 登录态就绪后调 `getAccount` 渲染余额/会员标识
- [ ] 定义本应用的 `level → features` 映射
- [ ] 按次扣费接 `deductCoin`（带 `bizId`，处理余额不足）
- [ ] 充值：跳转 `/wallet` 或内嵌 `useCoinRecharge`
- [ ] 自测：充值到账、扣费幂等、余额不足提示、会员免扣费

## 8. 受控 AI 日额度应用

`zero-echo-2026` 采用独立于云币的日额度策略：普通用户每天 9 次成功生成，活跃会员每天
27 次。额度按 Asia/Shanghai 自然日归档在 `ai_usage_daily`，模型失败会回滚本次预占。

该应用不能由浏览器直接免费调用 `ai-gateway`。EdgeOne 服务端必须用
`ZERO_ECHO_APP_SIGNING_SECRET` 对 `appId + bizId + timestamp + messages digest` 进行 HMAC
签名；CloudBase 端在读取账户、预占额度和调用模型前校验签名。签名密钥只配置在两端服务端，
不得写入仓库、浏览器环境变量或日志。
