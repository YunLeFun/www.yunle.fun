# CloudBase 云函数

本目录包含 [www.yunle.fun](https://www.yunle.fun) 的全部 CloudBase 云函数：微信支付、Apple 内购、平台账户中心（云币 + 跨应用会员）、受控 AI 计费网关、桌面应用登录授权、跨站 SSO 登录票据、GitHub App 仓库连接、短链跳转解析与统计。

> 📖 云函数的概念、类型与调用方式见官方文档：[CloudBase 云函数介绍](https://docs.cloudbase.net/cloud-function/introduce)。

## 云函数列表

| 云函数                     | 用途                                                                                                     | 调用方式               | 超时 |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------- | ---- |
| `wxpay-order`              | 创建支付订单（会员 / 云币充值）+ 查询订单 + 对账自愈                                                     | SDK `callFunction`     | 30s  |
| `wxpay-notify`             | 接收微信支付异步回调通知                                                                                 | HTTP 访问服务          | 10s  |
| `account-api`              | 平台账户中心：账户 / 云币 / 会员 / 奖励 / 签到 / 投币 / 关注·粉丝                                        | SDK `callFunction`     | 10s  |
| `user-storage-api`         | 通用用户云空间：共享 quota / 上传预留 / 确认 / 文件索引 / 下载 / 删除 / app-kind policy                  | SDK `callFunction`     | 10s  |
| `ai-gateway`               | 通用「登录计费 + 受控 AI 生成」网关：验登录 + 按 `appId` 服务端计价 + 管理员身份调 AI + `bizId` 幂等扣费 | 登录态 `/v1/functions` | 30s  |
| `iap-order`                | Apple 内购（IAP）凭据校验 + 权益发放                                                                     | SDK `callFunction`     | 30s  |
| `appstore-notify`          | 接收 App Store Server Notifications V2（退款 / 撤销自动处理）                                            | HTTP 访问服务          | 30s  |
| `desktop-auth`             | 桌面 / 本地应用登录授权（设备授权码 + Ed25519 离线 entitlement）                                         | SDK + HTTP 双入口      | 10s  |
| `shortlink-resolve`        | 短链只读解析：按 `(domain, slug)` 读 `short_links` 返回跳转目标，供 EdgeOne 跳转函数回源                 | HTTP 访问服务          | 10s  |
| `shortlink-stat`           | 短链点击统计：接收 EdgeOne 跳转函数上报，分片 CAS 累加到 `shortlink_stats`；admin 经 SDK 读              | HTTP（写）+ SDK（读）  | 10s  |
| `sso-ticket`               | 签发/消费绑定 origin+nonce 的一次性 SSO 授权码，并在同源 HTTPS 响应中铸 CloudBase ticket                 | SDK + HTTP 双入口      | 10s  |
| `sso-security-sweeper`     | 清理过期 SSO 授权码审计记录与持久化限流窗口；不持有签票私钥                                              | timer，禁止直接调用    | 30s  |
| `session-security-sweeper` | 将到期的 Drive/CMS opaque session 置为 expired，并清理超过 90 天的终态记录                               | timer，禁止直接调用    | 30s  |
| `github-api`               | 多用户 GitHub App 仓库连接 / 列举 / 校验（含私有仓库），短期 installation token 不落库                   | SDK + HTTP 双入口      | 10s  |

> 云币 + 跨应用会员的整体设计见 [`docs/coin-and-membership.md`](../docs/coin-and-membership.md)。
> 其中 5 个支付 / 账户函数共享同一份 `lib/`：权威源在 `cloudfunctions/wxpay-order/lib`，`pnpm sync:wxpay-lib` 同步到
> `wxpay-notify` / `account-api` / `iap-order` / `appstore-notify`；`account-api` 无需任何 `WX_*` 环境变量。
> `desktop-auth`、`ai-gateway`、`github-api` 各有独立 `lib/`（不共用 wxpay lib）；`sso-ticket` 也使用独立的签票、Client Registry、授权码存储与请求校验模块。这些模块均不在同步范围内。

## 环境变量配置

在 [CloudBase 控制台 - 云函数](https://tcb.cloud.tencent.com/dev?envId=yunlefun-8g7ybcxc7345c490#/scf) 中，点击对应云函数进入详情页，在「函数配置」中设置环境变量。（`shortlink-resolve` / `shortlink-stat` 无需环境变量。）

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

| 变量名                       | 说明                                                                                                                                                                  | 获取方式                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `ACCOUNT_API_INTERNAL_TOKEN` | 内部服务调用 `deductCoinForUser` / `adminAdjustCoin` / `adminGrantReward` / `adminCorrectReward` 时校验用的共享密钥；调用方（其它云函数、admin 后台）需配置同一个值。 | 使用随机长字符串，勿暴露给前端。 |

### ai-gateway 环境变量

| 变量名                         | 说明                                                                                                                           | 获取方式                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `ACCOUNT_API_INTERNAL_TOKEN`   | 内部转调 `account-api`（查余额 `getAccountForUser` / 扣云币 `deductCoinForUser`）的共享密钥，**须与 `account-api` 配同一值**。 | 与 `account-api` / `desktop-auth` 中的值相同。                  |
| `ZERO_ECHO_APP_SIGNING_SECRET` | 《零点回声》EdgeOne 调用的 HMAC 应用签名密钥，只在服务端使用。                                                                 | 与 EdgeOne 的 `YUNLE_ZERO_ECHO_SIGNING_SECRET` 配置同一随机值。 |
| `CANGSHENG_APP_SIGNING_SECRET` | 《仓生》EdgeOne 调用的 HMAC 应用签名密钥，只在服务端使用。                                                                     | 与 EdgeOne 的 `YUNLE_CANGSHENG_SIGNING_SECRET` 配置同一随机值。 |

`ai-gateway` 是**通用**「登录计费 + 受控 AI 生成」网关：只收发通用 `messages` / `content`，**不含任何业务语义**（不认识「春联」之类业务概念）——prompt 构造与结果解析留在各接入应用自己手里。计价 / 模型 / AI 凭证全锁在服务端，端用户改不了。

日志只记录白名单化的请求 ID、动作、结果码、耗时和消息条数（超过 32 条统一记为 33），不记录 UID、IP、请求/响应正文、提示词、令牌、密钥或底层异常消息。意外错误仅向调用方返回通用错误文案。

**入口**：接入应用（如 `ai-sfc`）的服务端携带**用户登录态**（access_token）经 `/v1/functions/ai-gateway` 调用。

- action：`chat`
- 入参：`{ action: 'chat', appId, messages, bizId, attestation? }`（`messages` 为 OpenAI 风格 `{ role, content }` 数组，`bizId` 必填；要求应用签名的注册项还需 `attestation`）
- 返回：按云币计费时为 `{ ok: true, content, balance, deduped }`；按日额度时为 `{ ok: true, content, quota }`；失败统一为 `{ ok: false, code, message, quota? }`

**处理流程**：

1. `app.auth().getUserInfo().uid` 取登录态 uid（匿名 / `anon` 占位身份一律视为未登录，拒绝，避免命中共享占位账户）；
2. 按 `appId` 查**服务端权威**注册表 `APP_REGISTRY`（端用户无法篡改计价 / 模型 / group）。`ai-sfc` 与 `everything-generator` 按次扣 1 云币；`zero-echo-2026` 与 `cangsheng-2026` 按 Asia/Shanghai 自然日提供普通账号 9 次、有效会员 27 次成功生成；
3. 需要应用签名的注册项先校验 HMAC 和时间窗，再读取登录账户；云币策略执行余额预检，日额度策略在 `ai_usage_daily` 原子预占；
4. `app.ai()` 以**管理员身份**调 CloudBase AI 生成；
5. 云币策略生成成功后按 `bizId` 幂等扣费；日额度策略只保留成功生成的占用，模型失败会回滚本次预占。两种策略均不让失败生成消耗用户权益。

> 🔒 **防白嫖（与 CloudBase 网关权限策略配合）**：AI 由本函数以**管理员身份**（`app.ai()` 走函数内置服务凭证）调用，豁免 deny；而网关侧对 `ai` 资源 **deny 注册 / 匿名用户**，端用户的 access_token 无法直打 `/v1/ai/<group>`，只能经此函数计费生成。`account-api` **零改动**——与 `desktop-auth` 同一「内部服务令牌转调」代理模式（`lib/account-proxy.js`），编排与计费纯逻辑在 `lib/relay.js`、入参校验在 `lib/validation.js`，均有单测覆盖（`tests/ai-gateway/relay.test.js`）。云币 + 跨应用会员整体设计见 [`docs/coin-and-membership.md`](../docs/coin-and-membership.md)。

### iap-order 环境变量

| 变量名                  | 说明                                        | 获取方式                                                      |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| `APPSTORE_ISSUER_ID`    | App Store Connect API 的 Issuer ID          | App Store Connect → 用户与访问 → 集成 → App Store Connect API |
| `APPSTORE_KEY_ID`       | 上述 API 密钥的 Key ID                      | 同上，创建密钥后显示                                          |
| `APPSTORE_PRIVATE_KEY`  | `.p8` 私钥内容（PEM，含 `BEGIN/END` 行）    | 创建密钥时下载的 `AuthKey_xxx.p8` 完整内容                    |
| `APPSTORE_BUNDLE_ID`    | App 的 Bundle ID，默认 `fun.yunle.apps`     | Xcode 项目 / App Store Connect                                |
| `APPSTORE_APP_APPLE_ID` | App 的 Apple ID（纯数字），生产通知验签需要 | App Store Connect → App 信息 → 通用信息 → Apple ID            |

> `iap-order` 与 `appstore-notify` 共用同一组 `APPSTORE_*`，两个函数都要配齐。本地开发可用 `APPSTORE_PRIVATE_KEY_FILE` 指向 `.p8` 文件路径（见 `.env.example`），云端则直接填 `APPSTORE_PRIVATE_KEY` 内容。

### appstore-notify 环境变量

环境变量与 `iap-order` 完全相同（`APPSTORE_*` 全套）。另需在 App Store Connect 配置 **App Store Server Notifications V2** 回调地址，见下方「HTTP 访问服务端点」。

### desktop-auth 环境变量

| 变量名                             | 必填 | 说明                                                                                                                            |
| ---------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| `DESKTOP_AUTH_SIGNING_KEY`         | 是   | Ed25519 entitlement 签发私钥。支持 JWK JSON / PEM，或二者的 base64（base64 无引号换行，注入 `cloudbaserc` 的 `{{env}}` 更安全） |
| `ACCOUNT_API_INTERNAL_TOKEN`       | 是   | 转调 `account-api`（查余额 / 扣云币）的内部服务令牌，**须与 `account-api` 配同一值**                                            |
| `DESKTOP_AUTH_SIGNING_KID`         | 否   | 签发公钥 `kid`；缺省取 JWK 内嵌 `kid`，再兜底 `desktop-default`                                                                 |
| `DESKTOP_AUTH_VERIFICATION_URL`    | 否   | 设备授权页地址，默认 `https://www.yunle.fun/link`                                                                               |
| `DESKTOP_AUTH_PUBLIC_KEYS`         | 否   | 退役公钥集 JSON（`kid → jwk`），轮换期内仍能验签旧 entitlement                                                                  |
| `DESKTOP_AUTH_ENTITLEMENT_TTL_SEC` | 否   | entitlement 有效期（秒），默认见 `lib/validation.js`                                                                            |
| `DESKTOP_AUTH_REFRESH_TTL_SEC`     | 否   | refreshToken 有效期（秒），默认见 `lib/validation.js`                                                                           |

> 设计与接入详见 [`docs/desktop-sso.md`](../docs/desktop-sso.md) 与 [`docs/desktop-sso-integration.md`](../docs/desktop-sso-integration.md)。

### sso-ticket 环境变量

| 变量名                               | 必填 | 说明                                                                                                                                                             |
| ------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SSO_TICKET_PRIVATE_KEY_ID`          | 是   | 自定义登录私钥 ID（`private_key_id`）。CloudBase 控制台 → 登录授权 → 自定义登录 → 下载私钥获取                                                                   |
| `SSO_TICKET_PRIVATE_KEY`             | 是   | 自定义登录私钥 PEM（`private_key`）；env 注入建议用 `\n` 转义或 base64。未配置私钥时函数返回 `{ ok:false, reason:'not_configured' }`，桥接页据此回退（向后兼容） |
| `SSO_ISSUER_ENVIRONMENT`             | 是   | `production` 或 `development`；由部署注入，绝不信任请求参数                                                                                                      |
| `SSO_LOCAL_DEVELOPER_USER_IDS`       | 否   | 可使用 managed-local 注册项的 CloudBase UID，逗号分隔                                                                                                            |
| `SSO_ALLOW_PRODUCTION_LOCAL_CLIENTS` | 否   | break-glass；仅在显式为 `true` 且 UID 命中上项时允许生产 issuer 服务精确本地注册，默认 `false`                                                                   |
| `SSO_ALLOW_LEGACY_ORIGIN_CLIENTS`    | 否   | v2 → v3 迁移 Adapter；默认兼容，所有 Consumer 发送 `client_id` 后设 `false`                                                                                      |
| `SSO_ALLOWED_ORIGINS`                | 否   | 仅旧 origin-only Consumer 的迁移规则；新客户端必须进入版本化 Registry                                                                                            |
| `SSO_ALLOWED_RETURN_ORIGINS`         | 否   | 仅旧 origin-only Consumer 的迁移回跳规则                                                                                                                         |
| `SSO_ALLOWED_TARGET_ORIGINS`         | 否   | 仅供 v1 → v2 零停机迁移回退；新部署必须使用上面两个变量，迁移完成后删除                                                                                          |
| `SSO_TICKET_REFRESH_SEC`             | 否   | 票据派生会话的可续期时长（秒），默认 30 天                                                                                                                       |
| `SSO_ISSUE_PER_USER_PER_MINUTE`      | 否   | 每用户、每目标 origin 的签发上限，默认 10                                                                                                                        |
| `SSO_ISSUE_PER_IP_PER_MINUTE`        | 否   | 每 IP 的签发上限，默认 30                                                                                                                                        |
| `SSO_EXCHANGE_PER_IP_PER_MINUTE`     | 否   | 每 IP 的兑换上限，默认 60                                                                                                                                        |
| `SSO_EXCHANGE_PER_ORIGIN_PER_MINUTE` | 否   | 每 Consumer origin 的兑换上限，默认 300                                                                                                                          |

`sso-ticket` 的用户 SSO 是两步授权码流程，私钥始终只在本函数 env：

- **签发**（已认证 SDK `action='issueSsoCode'`）：uid 只从调用上下文派生；Client Registry 校验 `client_id`、issuer environment、精确 Origin/redirect URI 和开发者门禁；授权码绑定策略版本与 S256 PKCE challenge。
- **兑换**（HTTPS `action='exchangeSsoCode'`）：Registry 与授权码绑定再次校验后事务性消费，回显已校验的具体 Origin，仅返回短暂 custom ticket。
- **迁移兼容**：`SSO_ALLOW_LEGACY_DIRECT_TICKET=true` 时，旧桥接页可暂时通过无 action 的已认证 SDK 调用为当前调用者本人签票；不接受 HTTP/uid。完成 v2 发布后立即设回 `false`。
- 任何调用者选择 `uid`/`subject` 的输入都拒绝；主站 session 和 refresh token 不跨 origin。
- `sso_login_codes` 与 `sso_security_limits` 均为 server-only；独立 `sso-security-sweeper` 每小时清理，且 `aclRule.invoke=false`。

> 客户端用 `signInWithCustomTicket(() => ticket)` 换取自己独立、可同源续期的会话。设计详见 [`docs/cookie-session-migration.md`](../docs/cookie-session-migration.md)。

### github-api 环境变量

| 变量名                     | 必填 | 说明                                                                                                                   |
| -------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_APP_ID`            | 是   | GitHub App ID，用于以 RS256 签发 App JWT                                                                               |
| `GITHUB_APP_PRIVATE_KEY`   | 是   | GitHub App 私钥 PEM；支持直接 PEM 或其 base64（PEM 含换行，base64 注入更稳）                                           |
| `GITHUB_APP_CLIENT_ID`     | 是   | OAuth Client ID；安装回调用 `code` 换 user token 校验安装归属时必需                                                    |
| `GITHUB_APP_CLIENT_SECRET` | 是   | OAuth Client Secret，同上                                                                                              |
| `GITHUB_APP_STATE_SECRET`  | 是   | install `state` 的 HMAC 签名密钥（防伪造 / 防重放）；未单独配置则回退复用 `ACCOUNT_API_INTERNAL_TOKEN`，二者至少配一个 |
| `GITHUB_APP_SLUG`          | 否   | App slug（出现在公开安装 URL，非密）；缺省兜底 `yunlefun`                                                              |
| `GITHUB_APP_SITE_ORIGIN`   | 否   | 回调页 `postMessage` / 兜底跳转的站点 origin；缺省 `https://www.yunle.fun`                                             |

`github-api` 是多用户 GitHub App 连接后端，密钥（私钥 / client secret）只从 env 读取，不进客户端 / 仓库 / EdgeOne。双入口：

- **SDK actions**（均需登录，前端经 `callFunction({ name: 'github-api', data: { action } })`）：`getConnection` / `getInstallUrl` / `listRepos` / `checkRepo` / `disconnect`。
- **安装回调**（HTTP GET）：GitHub App 安装后重定向至此（带 `code` + `installation_id` + `state`），函数校验 `state`（HMAC + TTL）与安装归属后 upsert `github_installations`，再 `postMessage` 通知前端弹窗。

> 仓库读取统一走短期 installation token（warm 缓存），不持久化任何用户 token；user token 仅在安装回调时用于校验安装归属。配置与契约详见 [`docs/github-app-integration.md`](../docs/github-app-integration.md)。

---

## HTTP 访问服务端点

下列函数通过 CloudBase「HTTP 访问服务」对外暴露 HTTPS 端点供外部系统回调；其余函数只经 SDK `callFunction` 调用，无公网入口。

| 函数                | 默认端点                                                                                                                               | 配置到                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `wxpay-notify`      | `https://<envId>.service.tcloudbase.com/wxpay-notify`                                                                                  | 微信支付商户平台回调地址（即 `WX_NOTIFY_URL`）                                |
| `appstore-notify`   | `https://<envId>.service.tcloudbase.com/appstore-notify`                                                                               | App Store Connect → App Store Server Notifications（V2，生产与沙盒各配一次）  |
| `desktop-auth`      | `https://api.yunle.fun/desktop-auth`（设备侧 HTTP 入口，详见 [`docs/desktop-sso-integration.md`](../docs/desktop-sso-integration.md)） | 桌面客户端                                                                    |
| `shortlink-resolve` | `https://<envId>.service.tcloudbase.com/shortlink-resolve`                                                                             | EdgeOne 短链跳转边缘函数（KV 未命中回源），配为其 `RESOLVE_ENDPOINT` 环境变量 |
| `sso-ticket`        | `https://api.yunle.fun/sso-ticket`                                                                                                     | 第一方 SSO 一次性授权码兑换（精确 Origin CORS、no-store）                     |
| `github-api`        | `https://api.yunle.fun/github-api`                                                                                                     | GitHub App 设置 → Callback URL（安装回调；函数把任意 GET 当回调处理）         |

> 当前环境 `<envId>` = `yunlefun-8g7ybcxc7345c490`。这些函数的 HTTP 路径绑定在网关的**通配域名 `*`** 上，因此在所有已接入域名都可达：默认域名 `https://<envId>.service.tcloudbase.com`，以及自定义域名 `api.yunle.fun` / `tcb.yunle.fun` / `tcb.api.yunle.fun`（如 `https://api.yunle.fun/desktop-auth`）。
>
> **云托管与云函数共存于同一域名**：同一张网关路由表上，`api.yunle.fun/`（根路径）指向**云托管**服务 `api`，而 `/desktop-auth`、`/wxpay-notify`、`/appstore-notify` 指向**云函数**——按 **path 最长前缀优先**分流（精确路径优先于根路径 `/`），互不冲突。所以"`api.yunle.fun` 在控制台显示为云托管域名"并不代表函数没接入，函数路由在「云函数 → HTTP 访问服务」入口单独管理。绑定详情见 [CloudBase 控制台](https://tcb.cloud.tencent.com/dev?envId=yunlefun-8g7ybcxc7345c490#/scf)。

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
4. 查 `user_memberships` 集合：你的 uid 多一条记录，`expireAt` 按 Asia/Shanghai 自然月从 `paidAt` 顺延
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

# 部署单个云函数（-e 可省略，CLI 会读 cloudbaserc.json 的 envId）
tcb fn deploy account-api -e yunlefun-8g7ybcxc7345c490
tcb fn deploy user-storage-api -e yunlefun-8g7ybcxc7345c490
tcb fn deploy ai-gateway -e yunlefun-8g7ybcxc7345c490
tcb fn deploy wxpay-order -e yunlefun-8g7ybcxc7345c490
tcb fn deploy wxpay-notify -e yunlefun-8g7ybcxc7345c490
tcb fn deploy iap-order -e yunlefun-8g7ybcxc7345c490
tcb fn deploy appstore-notify -e yunlefun-8g7ybcxc7345c490
tcb fn deploy desktop-auth -e yunlefun-8g7ybcxc7345c490
tcb fn deploy sso-ticket -e yunlefun-8g7ybcxc7345c490
tcb fn deploy github-api -e yunlefun-8g7ybcxc7345c490
tcb fn deploy shortlink-resolve -e yunlefun-8g7ybcxc7345c490
tcb fn deploy shortlink-stat -e yunlefun-8g7ybcxc7345c490
```

> ⚠️ 改动了 `lib/`（同步源 `wxpay-order/lib/`）后，**所有共享 lib 的云函数都要重新部署**：
> `wxpay-order` / `wxpay-notify` / `account-api` / `iap-order` / `appstore-notify`——
> 只部署其中一个会导致各函数 `lib/` 版本不一致。先 `pnpm sync:wxpay-lib && pnpm test`，再逐个部署。
>
> （`desktop-auth`、`ai-gateway`、`github-api`、`user-storage-api` 各有独立 `lib/`，`sso-ticket` 仅用 `mint.js`，均不在此列——改它们自己的代码只需部署该函数本身；签到 / 投币 / 关注·粉丝功能是 `account-api` 本地代码、未改 `lib/`，只需部署 `account-api`。）

或在项目根目录执行：

```bash
tcb fn deploy --all -e yunlefun-8g7ybcxc7345c490
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

`_id` 固定为 CloudBase `uid`；历史 auto-id 会员文档由会员开通 / 账户读取路径兼容并迁移。

文档结构：

```jsonc
{
  "_id": "<cloudbase uid>",
  "userId": "<cloudbase uid>",
  "planId": "basic",
  "activeCycle": "month", // 或 "year"
  "expireAt": 1735689600000, // 毫秒时间戳
  "billingAnchorDay": 31, // Asia/Shanghai 账单日
  "billingAnchorIsMonthEnd": true, // 首次开通是否发生在月末
  "lastOrderId": "YLF1735689000000abcdef1234567890",
  "createdAt": 1735689000000,
  "updatedAt": 1735689600000
}
```

月付按 Asia/Shanghai 自然月、年付按自然年计算。月末开通由
`billingAnchorIsMonthEnd` 保持月末策略；非月末日期在短月份临时取月末，后续恢复
`billingAnchorDay`。IAP 会员以 Apple 签名交易的 `purchaseDate` 起算。固定天数运营奖励会在
调整到期时间后同步重置账单锚点。

IAP 会员退款只在发放快照与当前最后一笔订单一致时回滚该订单增加的时长；存在后续购买、
会员状态已变化或缺少可靠快照时，订单会标记 `manual_review_required`，不会直接清空用户的
全部会员权益。

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
> ✅ 充值、扣费、追回都在 CloudBase 事务内同时更新 `user_wallet` 并写入 `coin_transactions`：
> 同一 `(userId, type, refId)` 使用稳定的 24 位流水文档 ID，并发事务重试后可直接读到已存在流水。
> 钱包与流水要么同时提交，要么同时回滚，不会再出现“余额已改、流水被唯一索引拒绝”的中间态。
> `coin_transactions.idx_ref_uniq`（2026-06 已建，**唯一**）作为业务字段层的第二道幂等保护，并兼容上线前的随机 ID 历史流水。
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

### 运营奖励：云币 + 会员

admin owner 通过私有服务令牌调用 `account-api`：

- `adminGrantReward`：按稳定 `grantId` 发放固定的 100 云币和/或 30 天会员；会员从 `max(当前时间, 当前到期时间)` 顺延，不覆盖已有付费时长。
- `adminCorrectReward`：创建不可变的关联纠正记录；云币余额不允许为负，无法追回的部分记为差额；会员仅在当前到期时间仍与原奖励结果完全一致时自动纠正，否则返回 `manual_review_required`。
- `listRewardHistory`：登录用户查询自己的友好奖励名称、到账内容和到账时间，不返回 operator、内部原因或审批信息。

奖励到账同时写入 `user_notifications`；云币流水的 `meta` 只包含可公开的来源标识、奖励名称和稳定业务 ID，钱包页面会显示友好来源。所有操作使用稳定文档 ID 和资产级幂等键，批次部分失败后可安全重试。

以下集合均应配置为 `ADMINONLY`，由 admin 仓库的 `scripts/ensure-reward-resources.mjs` 初始化：

| 集合                                  | 主要索引                                                         |
| ------------------------------------- | ---------------------------------------------------------------- |
| `reward_operations`                   | `grantId` 唯一；`userId + completedAt`；`campaignId + createdAt` |
| `reward_corrections`                  | `grantId` 唯一；`userId + createdAt`                             |
| `membership_entitlement_transactions` | `userId + createdAt`；`grantId + type`；`originalGrantId + type` |

admin 自身另使用 `reward_campaigns` 和 `reward_grant_items` 保存批次控制面。部署顺序为：初始化资源 → 部署 `account-api` → 发布 admin。

### 云空间配额：`user_storage_quotas` + `user_storage_files`（需新建）

云空间配额属于账号体系的全局权益，所有应用共享同一个 `uid` 维度的额度和用量。
规则：普通用户 100MB，会员用户 1GB，单文件 200MB；超限后禁止新上传，但允许下载 / 删除。
详细接口见 [`docs/storage-quota.md`](../docs/storage-quota.md)。

上线前需在 CloudBase 控制台**新建这两个集合并配置索引**：

| 集合                  | 索引名                     | 字段                                                      | 唯一性 |
| --------------------- | -------------------------- | --------------------------------------------------------- | ------ |
| `user_storage_quotas` | `idx_user`                 | `userId` ASC                                              | 唯一   |
| `user_storage_files`  | `idx_user_status_time`     | `userId` ASC, `status` ASC, `createdAt` DESC              | 非唯一 |
| `user_storage_files`  | `idx_user_app_status_time` | `userId` ASC, `appId` ASC, `status` ASC, `createdAt` DESC | 非唯一 |
| `user_storage_files`  | `idx_user_file_id`         | `userId` ASC, `fileId` ASC                                | 非唯一 |
| `user_storage_files`  | `idx_user_storage_key`     | `userId` ASC, `storageKey` ASC                            | 唯一   |

```text
// user_storage_quotas（一个用户一条，_id 固定为 CloudBase uid）
{
  _id: userId, userId,
  baseQuotaBytes, addonQuotaBytes, bonusQuotaBytes, quotaBytes,
  usedBytes, reservedBytes,
  membershipActive, membershipLevel, membershipExpireAt,
  version, createdAt, updatedAt
}

// user_storage_files（文件索引；不扫描 Storage 目录做配额）
{
  reservationId, userId, appId, kind, slotKey,
  status: "reserved", // reserved | finalizing | active | deleted | expired
  fileName, contentType, storageKey, fileId,
  sizeBytes, reservedSizeBytes,
  reservationExpiresAt, createdAt, updatedAt
}
```

> ⚠️ `user_storage_quotas._id` 必须固定为 CloudBase uid；`idx_user` 继续保持唯一用于兼容查询与防重复。
>
> 上传必须走 `reserveStorageUpload -> uploadFile(storageKey) -> finalizeStorageUpload`；删除优先走
> `deleteStorageFile`，不要只删 Storage 对象。会员开通 / 到期通过 `getStorageQuota`、reserve、finalize、delete
> 入口懒同步 `quotaBytes`，不会因降级删除存量文件。

安全规则：用户只读自己的配额和文件索引（`auth.uid == doc.userId`），写入由 `user-storage-api` 完成。
所有接入应用必须调用 `user-storage-api`；`account-api` 只保留账户、钱包、会员、资料、关注和通知职责。

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

### 关注 / 粉丝：`user_profiles` + `user_follows`（需新建）

用户身份源是 CloudBase 内置 Auth，资料（昵称/头像/用户名）存在 `user_metadata`，前端 SDK 只能取
**自己**。关注 / 粉丝要展示「对方是谁」，故落一张去规范化公开资料表 `user_profiles`（uid → 资料 + 计数），
关注关系明细存 `user_follows`（最终真相源，计数漂移可由明细重算）。上线前在控制台**新建这两个集合并配置索引**：

| 集合            | 索引名                   | 字段                                | 唯一性       |
| --------------- | ------------------------ | ----------------------------------- | ------------ |
| `user_profiles` | （主键 `_id` = uid）     | `_id`                               | 唯一（天然） |
| `user_profiles` | `idx_login`              | `login` ASC                         | 非唯一       |
| `user_follows`  | `idx_follower_following` | `followerId` ASC, `followingId` ASC | 唯一         |
| `user_follows`  | `idx_following_time`     | `followingId` ASC, `createdAt` DESC | 非唯一       |
| `user_follows`  | `idx_follower_time`      | `followerId` ASC, `createdAt` DESC  | 非唯一       |

> ⚠️ `user_follows.idx_follower_following` 必须**唯一**：关注的应用层「先查后写」（`findFollow`）在并发同
> (follower, following) 下有 TOCTOU 窗口，唯一索引堵住它，保证「关注幂等、计数不重复」（与 `coin_transactions.idx_ref_uniq` 同理）。
>
> `user_profiles.login` **不设唯一**：用户名唯一性已由 CloudBase Auth `username` 保证，`login` 只是其快照；
> 设唯一会因多个未设用户名的 `login: null` 互撞。`idx_login` 仅为 `/u/[login]` 主页查询加速。
>
> `idx_following_time` / `idx_follower_time` 服务 P2「粉丝 / 关注列表」分页（按时间倒序），P0+P1 暂未用到，可后建。
> 计数 `followersCount` / `followingCount` 挂在 `user_profiles` 上（CAS `version` 维护），以 `user_follows` 为真相源可重算。

```text
// user_profiles（一个用户一条，_id = uid）
{ _id, login, nickname, avatar, description, followersCount, followingCount, version, createdAt, updatedAt }

// user_follows（一条关注关系）
{ followerId, followingId, createdAt }
```

安全规则：两者均 **ADMINONLY**（仅云函数读写）。关注 / 取关、资料同步、关系与资料读取都经 `account-api`，
前端不直读这两个集合（公开主页的资料与关系也走云函数返回），无需放开客户端读权限。

### 通知：`user_notifications`（需新建）

关注等事件给被关注者写一条通知（MVP `type:'follow'`），前端进站拉未读数、按需翻列表（actor 资料读时
join `user_profiles`）。通知是异步可拉取的，**不走 WebSocket**。上线前在控制台**新建集合并配置索引**：

| 集合                 | 索引名            | 字段                           | 唯一性 |
| -------------------- | ----------------- | ------------------------------ | ------ |
| `user_notifications` | `idx_user_time`   | `userId` ASC, `createdAt` DESC | 非唯一 |
| `user_notifications` | `idx_user_unread` | `userId` ASC, `read` ASC       | 非唯一 |

> `idx_user_time` 服务通知列表分页；`idx_user_unread` 服务未读数统计。**ADMINONLY**（仅 `account-api` 读写）。
> 关注首次成立时写入（重复关注不重复发），写入失败不阻断关注主流程。

```text
// user_notifications（一条通知）
{ userId（接收者）, type, actorId, read, createdAt, readAt? }
```

### 短链：short_links（需新建）

短链跳转规则，由 admin 控制面（`/shortlinks` 页）CRUD 维护，是跳转的**源真相**；`shortlink-resolve`
按 `(domain, slug)` 读取，EdgeOne 边缘函数缓存到 KV 后 302。上线前在控制台**新建集合并配置索引**：

| 集合          | 索引名            | 字段                     | 唯一性 |
| ------------- | ----------------- | ------------------------ | ------ |
| `short_links` | `idx_domain_slug` | `domain` ASC, `slug` ASC | 唯一   |
| `short_links` | `idx_updatedAt`   | `updatedAt` DESC         | 非唯一 |

> ⚠️ `idx_domain_slug` 必须**唯一**：同一域名下 slug 不可重复（不同域名可同名），也是 `shortlink-resolve`
> 与 admin upsert 唯一性校验的依据。`idx_updatedAt` 服务后台列表按更新时间倒序分页。

```text
// short_links（一条短链）
{
  domain: "u.yunle.fun",   // 绑定域名（host），与 slug 组成唯一键
  slug: "abc",              // 路径，对应 https://{domain}/{slug}
  target: "https://…",      // 跳转目标（http/https 绝对地址）
  enabled: true,            // 停用后跳转函数返回未找到
  expireAt: 0,              // 过期时间戳(ms)，缺省/0 = 永不过期
  clicks: 0,                // 点击数（Phase 3 计数接入前恒为 0）
  createdBy: "yunyoujun",
  createdAt, updatedAt
}
```

安全规则：**ADMINONLY**（仅 admin 管理端 SDK 与 `shortlink-resolve` 云函数读写），前端不直读。

### 短链统计：shortlink_stats（需新建）

`shortlink-stat` 接收 EdgeOne 跳转函数上报，按 `(domain, slug)` 分片累加点击数；admin 控制面经 SDK
读取时按同一组字段聚合分片。上线前在控制台**新建集合并配置索引**：

| 集合              | 索引名            | 字段                     | 唯一性 |
| ----------------- | ----------------- | ------------------------ | ------ |
| `shortlink_stats` | `idx_domain_slug` | `domain` ASC, `slug` ASC | 非唯一 |

安全规则：**ADMINONLY**（仅 `shortlink-stat` 云函数读写），前端不直读。

### GitHub 安装映射：github_installations（需新建）

`github-api` 把 CloudBase uid 与用户的 GitHub App installation 一一对应（`_id = uid`，一个用户一条），
仓库读取时凭 `installationId` 换取短期 installation token，**不持久化任何用户 token**。上线前在控制台**新建集合并配置索引**：

| 集合                   | 索引名               | 字段                 | 唯一性       |
| ---------------------- | -------------------- | -------------------- | ------------ |
| `github_installations` | （主键 `_id` = uid） | `_id`                | 唯一（天然） |
| `github_installations` | `idx_installation`   | `installationId` ASC | 非唯一       |

> `idx_installation` 给 webhook（Phase 4）按 `installationId` 反查用户用（`installation.deleted` 时据此删映射）；当前 SDK actions 都按 `_id`(uid) 直接读写，故非唯一即可。

```text
// github_installations（一个用户一条，_id = uid）
{ _id, installationId, githubLogin, accountType, repositorySelection, createdAt, updatedAt }
```

安全规则：**ADMINONLY**（仅 `github-api` 云函数读写），前端经 SDK `callFunction` 间接访问，不直读。

## 共享代码：lib/

5 个支付 / 账户云函数下都有一份 `lib/`，包含签名、加解密、校验、订单状态机等纯函数。
**权威源在 `cloudfunctions/wxpay-order/lib/`**，`wxpay-notify` / `account-api` / `iap-order` / `appstore-notify` 的 `lib/` 由 `pnpm sync:wxpay-lib` 自动同步，禁止直接修改。

修改流程：

```bash
# 1. 仅修改 cloudfunctions/wxpay-order/lib/ 下的文件
# 2. 同步到 wxpay-notify
pnpm sync:wxpay-lib

# 3. 跑测试
pnpm test
```

CI 会跑 `pnpm sync:wxpay-lib --check`，如果发现 drift 直接 fail。
