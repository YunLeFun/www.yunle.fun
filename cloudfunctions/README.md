# 云函数 - 微信支付

本目录包含微信支付相关的 CloudBase 云函数。

## 云函数列表

| 云函数         | 用途                                      | 超时时间 |
| -------------- | ----------------------------------------- | -------- |
| `wxpay-order`  | 创建支付订单（会员 / 云币充值）+ 查询订单 | 30s      |
| `wxpay-notify` | 接收微信支付异步回调通知                  | 10s      |
| `account-api`  | 平台账户中心：查账户 / 扣云币 / 云币流水  | 10s      |

> 云币 + 跨应用会员的整体设计见 [`docs/coin-and-membership.md`](../docs/coin-and-membership.md)。
> 三个云函数共享同一份 `lib/`：权威源在 `wxpay-order/lib`，`pnpm sync:wxpay-lib` 同步到
> `wxpay-notify/lib` 与 `account-api/lib`，`account-api` 无需任何 `WX_*` 环境变量。

## 环境变量配置

在 [CloudBase 控制台 - 云函数](https://tcb.cloud.tencent.com/dev?envId=yunlefun-8g7ybcxc7345c490#/scf) 中，分别点击两个云函数进入详情页，在「函数配置」中设置环境变量。

### wxpay-order 环境变量

| 变量名                | 说明                                                 | 获取方式                                                                                                        |
| --------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `WX_MCH_ID`           | 微信支付商户号                                       | [微信支付商户平台](https://pay.weixin.qq.com/) → 账户中心 → 商户信息 → 商户号                                   |
| `WX_APPID`            | 微信应用 AppID                                       | 使用 **云乐坊工作室服务号**：`wxe6749827b67dfc25`（网站应用不支持绑定微信开放平台，需使用已认证服务号的 AppID） |
| `WX_SERIAL_NO`        | API 证书序列号                                       | 见下方「API 证书获取步骤」第 4 步                                                                               |
| `WX_PRIVATE_KEY`      | API 证书私钥（PEM 格式）                             | 见下方「API 证书获取步骤」第 3 步                                                                               |
| `WX_APIV3_KEY`        | APIv3 密钥（32 字节）                                | 见下方「APIv3 密钥获取步骤」                                                                                    |
| `WX_NOTIFY_URL`       | 支付回调通知地址                                     | 见下方「回调地址获取」                                                                                          |
| `WX_ALLOW_TEST_ORDER` | 是否允许自定义金额的测试下单接口（生产环境务必留空） | 设置为 `true` 时启用 `createTestOrder`，默认禁用                                                                |

### wxpay-notify 环境变量

| 变量名                     | 说明                                                                      | 获取方式                                                                                  |
| -------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `WX_APIV3_KEY`             | APIv3 密钥（32 字节）                                                     | 与 wxpay-order 中的值相同                                                                 |
| `WX_APPID`                 | 商户 AppID（用于回调字段校验）                                            | 与 wxpay-order 中的值相同                                                                 |
| `WX_MCH_ID`                | 商户号（用于回调字段校验）                                                | 与 wxpay-order 中的值相同                                                                 |
| `WX_PLATFORM_CERTIFICATES` | **必填**。微信平台证书 JSON：`{"<序列号>": "<PEM 公钥>"}`，支持多证书轮换 | 商户平台 → API 证书 → 「平台证书」中下载，或调用 `GET /v3/certificates` 由 APIv3 Key 解密 |
| `WX_TIME_TOLERANCE`        | 验签允许的时钟漂移秒数（默认 300）                                        | 一般保持默认                                                                              |

> 💡 `WX_PLATFORM_CERTIFICATES` 的 PEM 字符串中换行可写作 `\n`，代码会自动还原；多证书时直接增加 JSON key 即可，旧证书在轮换期内可与新证书并存。

### account-api 环境变量

| 变量名                       | 说明                                                                                                                                       | 获取方式                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `ACCOUNT_API_INTERNAL_TOKEN` | 内部服务调用 `deductCoinForUser` / `adminAdjustCoin`（管理员人工调账）时校验用的共享密钥；调用方（其它云函数、admin 后台）需配置同一个值。 | 使用随机长字符串，勿暴露给前端。 |

---

## 参数获取指南

### 1. 商户号 (WX_MCH_ID)

1. 登录 [微信支付商户平台](https://pay.weixin.qq.com/)
2. 点击 **账户中心** → **商户信息**
3. 页面顶部显示的 **商户号**（10 位数字），即为 `WX_MCH_ID`

> 如果还没有商户号，需要先在 [微信支付](https://pay.weixin.qq.com/index.php/apply/applyment_home/guide_normal) 完成商户入驻申请。

### 2. 微信应用 AppID (WX_APPID)

当前项目使用 **云乐坊工作室服务号** 的 AppID：

```
wxe6749827b67dfc25
```

> ⚠️ **为什么不用微信开放平台的网站应用 AppID？**
> 本网站不支持绑定微信开放平台的网站应用，因此 CloudBase 微信支付的 `WX_APPID` 需要使用已认证服务号的 AppID。服务号支持 JSAPI 支付和 Native 支付。

> ⚠️ AppID 必须与商户号进行关联。在商户平台 → 产品中心 → AppID 账号管理中添加绑定 `wxe6749827b67dfc25`。

### 3. API 证书 (WX_SERIAL_NO + WX_PRIVATE_KEY)

API 证书用于微信支付 V3 接口的请求签名。

#### 获取步骤

1. 登录 [微信支付商户平台](https://pay.weixin.qq.com/)
2. 点击 **账户中心** → **API 安全** → **API 证书**
3. 点击 **申请证书**，按提示下载证书工具并生成证书
4. 生成后会得到以下文件：
   - `apiclient_key.pem` — **私钥文件**，即 `WX_PRIVATE_KEY` 的值
   - `apiclient_cert.pem` — 证书文件
   - `apiclient_cert.p12` — PKCS12 格式证书
5. 证书的 **序列号** 可在商户平台 API 证书页面查看，即 `WX_SERIAL_NO` 的值

#### 配置 WX_PRIVATE_KEY 的格式

将 `apiclient_key.pem` 文件的 **完整内容** 粘贴为环境变量值，包括首尾行：

```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhki...
...
-----END PRIVATE KEY-----
```

> 如果控制台环境变量不支持多行，可将换行符替换为 `\n`，代码中已处理了这种情况：
>
> ```
> -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhki...\n...\n-----END PRIVATE KEY-----
> ```

### 4. APIv3 密钥 (WX_APIV3_KEY)

APIv3 密钥用于解密微信支付回调通知中的加密数据。

1. 登录 [微信支付商户平台](https://pay.weixin.qq.com/)
2. 点击 **账户中心** → **API 安全** → **APIv3 密钥**
3. 点击 **设置密钥**，输入一个 **32 字节的字符串**（可自行生成随机字符串）
4. 妥善保存该密钥，它只会展示一次

> 可使用以下命令生成 32 位随机密钥：
>
> ```bash
> openssl rand -hex 16
> ```

### 5. 支付回调通知地址 (WX_NOTIFY_URL)

`wxpay-notify` 云函数已配置了 HTTP Access，回调地址格式为：

```
https://<envId>.service.tcloudbase.com/wxpay-notify
```

对于当前环境，即：

```
https://yunlefun-8g7ybcxc7345c490.service.tcloudbase.com/wxpay-notify
```

> ⚠️ 请在 [CloudBase 控制台 - 云函数](https://tcb.cloud.tencent.com/dev?envId=yunlefun-8g7ybcxc7345c490#/scf) 中确认 `wxpay-notify` 的 HTTP 触发路径，确保与此 URL 一致。

---

## 商户平台配置清单

除了云函数环境变量，还需要在微信支付商户平台完成以下配置：

### 1. 关联 AppID

- 商户平台 → **产品中心** → **AppID 账号管理** → 添加 AppID 并确认关联

### 2. 开通支付产品

根据需要的支付方式，在商户平台开通对应产品：

| 支付方式           | 产品名称    | 开通路径                          |
| ------------------ | ----------- | --------------------------------- |
| Native 扫码        | NATIVE 支付 | 产品中心 → 我的产品 → Native 支付 |
| JSAPI（微信内）    | JSAPI 支付  | 产品中心 → 我的产品 → JSAPI 支付  |
| H5（微信外浏览器） | H5 支付     | 产品中心 → 我的产品 → H5 支付     |

> **注意**：H5 支付默认关闭，需在 `.env` 中设置 `NUXT_PUBLIC_ENABLE_H5_PAY=true` 开启。开启前需先在商户平台完成 H5 支付产品申请。

### 3. 配置支付授权目录（JSAPI 支付）

- 商户平台 → **产品中心** → **开发配置** → **支付授权目录**
- 添加你的网站域名，如 `https://www.yunle.fun/`

### 4. 配置 H5 支付域名（H5 支付，可选）

- 商户平台 → **产品中心** → **开发配置** → **H5 支付域名**
- 添加你的网站域名，如 `https://www.yunle.fun`

---

## 测试支付链路（自定义金额小额回归）

正式上线前，可用极小金额（如 0.01 元）跑通「下单 → 支付 → 回调 → 开通会员」全链路。

### 入口

- 页面：`/test/pay`（对应 `app/pages/test/pay.vue`）
- 该接口走 `wxpay-order` 的 `action: 'createTestOrder'`，支持任意 `1~10000` 分的金额

> ⚠️ `/test/*` 页面**默认被排除**，不会随生产构建上线（由 `nuxt.config.ts` 的 `pages:extend` 钩子确定性移除）。
> 需要在本地调试测试页时，显式开启：`ENABLE_TEST_PAGES=true pnpm dev`。
> （早期版本曾用 `ignore: ['pages/test/**']`，但该方案在 `nuxt generate` 下不生效，已废弃。）

### 启用开关（默认关闭，必须显式开启）

`createTestOrder` 默认被禁用，避免被人滥用刷单。需在 **wxpay-order** 云函数加环境变量：

| 变量名                | 值     | 说明                                     |
| --------------------- | ------ | ---------------------------------------- |
| `WX_ALLOW_TEST_ORDER` | `true` | 仅测试期开启；任何其它值（或不设）= 禁用 |

> 未开启时调用会抛 `测试下单已禁用，请设置 WX_ALLOW_TEST_ORDER=true`，前端表现为 `FUNCTION_INVOCATION_FAILED`。这是预期的保护行为，不是 bug。

### 验证步骤

1. 在 wxpay-order 设 `WX_ALLOW_TEST_ORDER=true`（控制台 → 云函数 → wxpay-order → 环境变量）
2. **登录后** 打开 `/test/pay`，用 native 方式下 0.01 元订单，微信扫码完成支付
3. 查 `orders` 集合：该订单 `status: paid`、`transactionId` 有值、`userId` 为你的 CloudBase uid（**不是** openid）
4. 查 `user_memberships` 集合：你的 uid 多一条记录，`expireAt ≈ paidAt + 31 天`
5. 前端 `useMembership().isActive` 应为 `true`

### ⚠️ 测试完成后务必关闭

回归通过后，**立即删除 `WX_ALLOW_TEST_ORDER` 或改为 `false`**，否则任意登录用户都能用任意金额调起正式微信下单。

---

## 平台公钥 / 证书轮换 checklist

`wxpay-notify` 用 `WX_PLATFORM_CERTIFICATES` 验签，需要在微信侧轮换时同步更新。本商户当前用的是 **微信支付公钥模式**（2024 年起新商户的默认机制）。

`WX_PLATFORM_CERTIFICATES` 的值是一个 JSON：`{ "<公钥ID 或证书序列号>": "<PEM 公钥>" }`，**支持同时放多个 key**，因此轮换可以无缝过渡——新旧并存一段时间，等微信完全切到新公钥后再删旧的。

### A. 公钥模式（当前商户）

1. 商户平台 → **API 安全** → **微信支付公钥** → 下载新公钥 PEM + 记下新的「公钥 ID」（形如 `PUB_KEY_ID_xxx`）
2. 在 `wxpay-notify` 的 `WX_PLATFORM_CERTIFICATES` JSON 里**新增**一个 key（保留旧的）：
   ```jsonc
   {
     "PUB_KEY_ID_旧": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
     "PUB_KEY_ID_新": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
   }
   ```
   （PEM 换行写成 `\n`，代码会自动还原）
3. 等微信回调全部携带新公钥 ID 后，再删掉旧 key

### B. 平台证书模式（若未来切回传统证书）

证书每年到期前需轮换，可用脚本自动拉取解密：

```bash
WX_MCH_ID=xxx WX_SERIAL_NO=xxx WX_APIV3_KEY=xxx \
WX_PRIVATE_KEY="$(cat apiclient_key.pem)" \
node scripts/fetch-wxpay-certificates.mjs
```

脚本会输出可直接粘贴的 `WX_PLATFORM_CERTIFICATES` JSON（含证书序列号 → PEM 映射）。同样建议新旧并存过渡。

> 验签兼容性已被单测覆盖（`tests/wxpay/signature.test.js` 的 `parsePlatformCertificates` / `verifyCallbackSignature`），公钥 ID 与证书序列号都按同一套 `serial → PEM` 逻辑处理，无需改代码。

---

## 部署命令

云函数已部署到 CloudBase。如需重新部署，可使用 CloudBase CLI：

```bash
# 安装 CLI
npm i -g @cloudbase/cli

# 登录
tcb login

# 部署单个云函数
tcb functions deploy wxpay-order --envId yunlefun-8g7ybcxc7345c490
tcb functions deploy wxpay-notify --envId yunlefun-8g7ybcxc7345c490
tcb functions deploy account-api --envId yunlefun-8g7ybcxc7345c490
```

> ⚠️ 改动了 `lib/`（同步源 `wxpay-order/lib/`）后，**所有共享 lib 的云函数都要重新部署**：
> `wxpay-order` / `wxpay-notify` / `account-api` / `iap-order` / `appstore-notify`——
> 只部署其中一个会导致各函数 `lib/` 版本不一致。先 `pnpm sync:wxpay-lib && pnpm test`，再逐个部署。
>
> （签到 / 投币功能是 `account-api` 本地代码、未改 `lib/`，只需部署 `account-api`。）

或在项目根目录执行：

```bash
tcb functions deploy --envId yunlefun-8g7ybcxc7345c490
```

## 数据库

支付订单存储在 CloudBase NoSQL `orders` 集合中，已创建以下索引：

| 索引名              | 字段                       | 唯一性 |
| ------------------- | -------------------------- | ------ |
| `idx_outTradeNo`    | `outTradeNo` ASC           | 唯一   |
| `idx_userId_status` | `userId` ASC, `status` ASC | 非唯一 |

> ⚠️ `idx_outTradeNo` 必须**唯一**，否则回调的"条件更新"语义（`status: pending`）在极端并发下无法保证幂等。

订单文档新增字段（多租户 + 云币）：`appId`（应用归属，缺省 `yunle`）、`orderType`
（`membership` | `recharge_coin`）；会员订单带 `level`/`billingCycle`，云币订单带 `packId`/`coinAmount`。

**发放状态字段 `grantedAt`**：订单确认支付（`status: paid`）后，权益发放成功会回写 `grantedAt`（毫秒时间戳）。
「`status: paid` 但无 `grantedAt`」表示回调在标记已支付之后、发放权益之前中断（漏发场景），
由 `wxpay-order` 的 `reconcileOrders` 扫描自愈补发；补发依赖底层幂等（会员 `lastOrderId` / 云币 `refId` / 订单 `grantedAt`），重入安全、不会重复发放。

会员状态存储在 `user_memberships` 集合，索引：

| 索引名     | 字段         | 唯一性 |
| ---------- | ------------ | ------ |
| `idx_user` | `userId` ASC | 唯一   |

文档结构：

```jsonc
{
  "_id": "<doc>",
  "userId": "<cloudbase uid>",
  "planId": "basic",
  "activeCycle": "month", // 或 "year"
  "expireAt": 1735689600000, // 毫秒时间戳
  "lastOrderId": "YLF1735689000000abcdef1234567890",
  "createdAt": 1735689000000,
  "updatedAt": 1735689600000
}
```

安全规则：用户只能读取自己的订单与会员（`auth.uid == doc.userId`），写入由云函数完成。

[查看 orders 集合 →](https://tcb.cloud.tencent.com/dev?envId=yunlefun-8g7ybcxc7345c490#/db/doc/collection/orders)

### 云币：`user_wallet` + `coin_transactions`（需新建）

云币钱包跨应用共享余额，一个用户一条 `user_wallet`；每笔变更写一条 `coin_transactions` 流水。
上线前需在 CloudBase 控制台**新建这两个集合并配置索引**：

| 集合                | 索引名          | 字段                                  | 唯一性 |
| ------------------- | --------------- | ------------------------------------- | ------ |
| `user_wallet`       | `idx_user`      | `userId` ASC                          | 唯一   |
| `coin_transactions` | `idx_user_time` | `userId` ASC, `createdAt` DESC        | 非唯一 |
| `coin_transactions` | `idx_app_time`  | `appId` ASC, `createdAt` DESC         | 非唯一 |
| `coin_transactions` | `idx_ref_uniq`  | `userId` ASC, `type` ASC, `refId` ASC | 唯一   |

> ⚠️ `user_wallet.idx_user` 必须**唯一**，否则余额的乐观锁（`version` 比对）在并发下可能产生多条钱包记录。
>
> ✅ `coin_transactions.idx_ref_uniq`（2026-06 已建，**唯一**）把云币幂等下沉到数据库兜底：
> 应用层 `findTxByRef` 先查后写在并发同 `refId`（如同一 `bizId` 并发扣费）下有 TOCTOU 窗口，唯一索引堵住它。
> 该索引要求 `refId` 非空——故 `deductCoin` 的 `bizId` 已改为**必填**（`lib/validation.js`），杜绝空 `refId` 互撞约束；
> 充值（`refId=outTradeNo`）、调账（`refId` 必填）本就非空，不受影响。

```text
// user_wallet（一个用户一条）
{ userId, balance: 1280, version: 7, createdAt, updatedAt }

// coin_transactions（只追加不修改）
{
  userId, appId: "yunle",
  type: "recharge",   // recharge | consume | refund | gift
  amount: 1000,        // 正=入账，负=扣减
  balanceAfter: 1280,
  refId: "YLF…",      // 充值=outTradeNo；消费=业务 bizId（幂等键）
  meta: {}, createdAt
}
```

安全规则：用户只读自己的钱包与流水（`auth.uid == doc.userId`），写入仅由云函数完成。

### 投币 / 支持榜：`app_tip_stats` + `app_supporters`（需新建）

投币打赏把用户云币转为应用「热度」（**不进开发者钱包、不可提现**）。两张去规范化计数表服务
排行榜与「支持者」标识，以 `coin_transactions`（`type=consume`、`refId` 前缀 `tip:`）为最终真相源，
计数漂移可由流水重算。上线前在控制台**新建这两个集合并配置索引**：

| 集合             | 索引名         | 字段                      | 唯一性 |
| ---------------- | -------------- | ------------------------- | ------ |
| `app_tip_stats`  | `idx_app`      | `appId` ASC               | 唯一   |
| `app_supporters` | `idx_app_user` | `appId` ASC, `userId` ASC | 唯一   |

> ⚠️ 两个唯一索引都关键：`app_tip_stats.idx_app` 保证热度计数的乐观锁（`version`）不产生多条；
> `app_supporters.idx_app_user` 既为「支持者人数」去重，也是「我是否支持过」的查询依据。
>
> 投币每日上限（每应用 2 次/天）由 `refId = tip:<uid>:<appId>:<东八区日>:<slot>` 的 slot 占位实现，
> 复用 `coin_transactions.idx_ref_uniq` 幂等，无需额外计数表。

```text
// app_tip_stats（一个应用一条）
{ appId, totalCoins, tipCount, supporterCount, version, createdAt, updatedAt }

// app_supporters（一个用户对一个应用一条）
{ appId, userId, totalCoins, tipCount, firstTipAt, lastTipAt }
```

安全规则：两者均 **ADMINONLY**（仅云函数读写）——支持榜与「我是否支持过」都经 `account-api`
读取，前端不直读这两个集合，无需放开客户端读权限。

## 共享代码：lib/

两个云函数下都有一份 `lib/`，包含签名、加解密、校验、订单状态机等纯函数。
**权威源在 `functions/wxpay-order/lib/`**，`wxpay-notify/lib/` 由 `pnpm sync:wxpay-lib` 自动同步，禁止直接修改。

修改流程：

```bash
# 1. 仅修改 functions/wxpay-order/lib/ 下的文件
# 2. 同步到 wxpay-notify
pnpm sync:wxpay-lib

# 3. 跑测试
pnpm test
```

CI 会跑 `pnpm sync:wxpay-lib --check`，如果发现 drift 直接 fail。
