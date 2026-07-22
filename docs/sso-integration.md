# 跨站 SSO 接入指南：一次性授权码 + 应用独立会话

适用范围：云乐坊完全控制的第一方 Web 应用，例如 `drive.yunle.fun`、CMS 和后续 AdvJS 示例。第三方应用必须使用 OAuth/OIDC，不得加入本 SSO 信任白名单。

实现由 [`@yunlefun/sso`](https://github.com/YunLeFun/ylf/tree/main/packages/sso)、主站 `/auth/sso` 和 CloudBase `sso-ticket` 函数组成。

## 1. 不会重复的三层职责

| 层       | 组件                           | 生命周期                     | 保存内容                                                                                     |
| -------- | ------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------- |
| 身份联邦 | `@yunlefun/sso` + `sso-ticket` | 一次登录握手，默认 60 秒     | 一次性授权码的 SHA-256、clientId、issuer、origin、策略版本、nonce、PKCE challenge、uid、状态 |
| 身份证明 | CloudBase Auth                 | 仅 BFF exchange 前的临时桥接 | CloudBase SDK 内存 session                                                                   |
| 应用会话 | `@yunlefun/server-session`     | idle/absolute TTL、设备撤销  | opaque token 的 SHA-256 与安全设备元数据                                                     |

SSO 只证明“这是哪个 CloudBase 用户”；`server-session` 决定 Drive/CMS 是否仍允许该设备访问。二者不能合并，也不应互相保存对方的 bearer token。

## 2. 推荐流程

```text
Consumer                www.yunle.fun             sso-ticket              CloudBase Auth       App BFF
   | top-level redirect       |                         |                         |                 |
   | client_id+target+exact redirect+nonce+S256 ------->|                         |                 |
   |                          | getSession()            |                         |                 |
   |                          | issueSsoCode ---------->| current caller uid      |                 |
   |<-- #code + nonce + iss --|                         |                         |                 |
   | POST code+nonce+verifier+Origin ------------------>| consume once + PKCE      |                 |
   |<-- transient custom ticket ------------------------|                         |                 |
   | signInWithCustomTicket ---------------------------------------------------->|                 |
   | getSession(); reject error/missing/anonymous                              |                 |
   | access-token proof ------------------------------------------------------------------------>|
   |<-- __Host- opaque app cookie ----------------------------------------------------------------|
   | signOut temporary CloudBase session                                        |                 |
```

关键性质：

- 顶层跳转每一跳都处于第一方上下文，不依赖第三方 Cookie/iframe storage。
- fragment 只携带随机授权码；不携带 CloudBase ticket、access token 或 refresh token。
- Provider 页面只做语法与同源回跳检查；`sso-ticket` 的版本化 Client Registry 是唯一授权真源。
- `client_id` 是公开标识，不是浏览器 secret；Registry 将其绑定到 issuer environment、精确 HTTPS Origin 和精确 redirect URI。
- redirect 响应携带并校验 Provider `iss`，避免 Consumer 在 production/development authorization server 间发生 mix-up。
- 授权码绑定 client ID + issuer/client environment + target origin + policy version + nonce + S256 PKCE challenge，数据库事务保证只有一个消费请求成功；verifier 只保存在 Consumer 当前 tab 的 `sessionStorage`，不进入 URL。
- 签发端 uid 只来自 `contextApp.auth().getUserInfo()`；任何 `uid`、`userId`、`subject` 或 `customUserId` 输入均拒绝。
- CloudBase custom-login 私钥只保存在函数受管 secret/env，不进入仓库、日志或客户端。

## 3. Consumer 代码

> 发布状态（2026-07-22）：npm 上的 `@yunlefun/sso@0.4.0` 尚未暴露下文的 `clientId` 参数与 `iss` 校验合约。下方示例是支持 v3 合约的待发布 Consumer API，不应直接套用到 `0.4.0`。当前只可执行 Provider 端迁移第 2 阶段，并保持 `SSO_ALLOW_LEGACY_ORIGIN_CLIENTS=true`，直到 v3-capable 版本发布且所有 Consumer 升级完成。

安装：

```bash
pnpm add @yunlefun/sso
```

登录按钮：

```ts
import { startSsoRedirect } from '@yunlefun/sso'

await startSsoRedirect({
  clientId: 'cms-web',
  returnUrl: 'https://cms.yunle.fun/',
})
```

应用启动：

```ts
import cloudbase from '@cloudbase/js-sdk'
import { adoptSsoCode, consumeSsoRedirect } from '@yunlefun/sso'

const app = cloudbase.init({
  env: 'yunlefun-8g7ybcxc7345c490',
  region: 'ap-shanghai',
  accessKey: '<publishable-key>',
  auth: { detectSessionInUrl: true },
})
const auth = app.auth

const result = consumeSsoRedirect()
if (result?.ok && 'code' in result) {
  await adoptSsoCode(auth, result.code, {
    clientId: 'cms-web',
    nonce: result.nonce,
    codeVerifier: result.codeVerifier,
  })
}

const { data, error } = await auth.getSession()
if (error || !data?.session || data.session.user?.is_anonymous) {
  throw new Error('LOGIN_REQUIRED')
}

// 只把 access token 作为一次性身份证明交给 BFF；禁止发送/保存 refresh token。
await $fetch('/api/v1/session/exchange', {
  method: 'POST',
  headers: { Authorization: `Bearer ${data.session.access_token}` },
})

await auth.signOut() // BFF 已设置应用自己的 opaque session
```

不要使用 `getLoginState()`、`getUser()` 或 `uid` 是否存在来判断真实登录。初始化含 publishable key 时，这些旧判断可能把轻量匿名状态误认为登录；唯一允许的守卫是 `getSession()` 并同时检查 `{ data, error }` 与 `is_anonymous`。

## 4. Client Registry 与 issuer 配置

授权策略以 [`sso-client-registry.snapshot.js`](../cloudfunctions/sso-ticket/sso-client-registry.snapshot.js) 为版本化 policy-as-code。每个客户端必须登记稳定 `clientId`、状态、允许的 issuer environment、精确 Origin、精确 redirect URI 和访问策略。页面不保存第二份白名单。

生产 issuer 的安全默认值：

```dotenv
SSO_ISSUER_ENVIRONMENT=production
SSO_LOCAL_DEVELOPER_USER_IDS=
SSO_ALLOW_PRODUCTION_LOCAL_CLIENTS=false
SSO_ALLOW_LEGACY_ORIGIN_CLIENTS=true
NUXT_PUBLIC_SSO_ALLOW_LEGACY_REDIRECT=false
SSO_ALLOW_LEGACY_DIRECT_TICKET=false
```

`SSO_ALLOWED_ORIGINS`、`SSO_ALLOWED_RETURN_ORIGINS` 与 `SSO_ALLOWED_TARGET_ORIGINS` 仅属于 v2 origin-only 迁移 Adapter。所有客户端迁入 Registry 并开始发送 `client_id` 后，将 `SSO_ALLOW_LEGACY_ORIGIN_CLIENTS=false`，再删除旧变量。新注册禁止通配符。

共享团队和 CI 使用相同代码的独立 development tenant：独立 CloudBase env、自定义登录私钥、账号、限流与审计，设置 `SSO_ISSUER_ENVIRONMENT=development`。本地应用使用 `https://<app>.yunle.localhost:<fixed-port>`，无需 hosts；Registry 仍物化为精确 Origin/redirect URI。生产 issuer 的 `SSO_ALLOW_PRODUCTION_LOCAL_CLIENTS=true` 只是人工联调的 break-glass，且还要求登录 UID 位于 `SSO_LOCAL_DEVELOPER_USER_IDS`。

### 新应用标准接入

1. 分配稳定的小写 kebab-case `clientId`，例如 `support-web`；它跨环境不变且不是凭据。
2. 分配互不冲突的本地 hostname/port，例如 `https://support.yunle.localhost:3445`；不修改 hosts，不使用通配符。
3. 在 Registry snapshot 中提交 production 与 managed-local 两条精确 registration；完整 redirect URI 通常固定为应用根路径或专用 `/auth/callback`。
4. Consumer 的 `startSsoRedirect` 与 `adoptSsoCode` 都传同一个 `clientId`；本地启动命令只覆盖 SSO Provider、exchange endpoint、Origin 和 redirect URI。
5. development tenant 验收后再登记 production URI。自动化测试只能使用 development tenant 或既有 Test Identity Broker。

Registry 变更属于认证权限变更，必须通过代码评审。未来若由 Admin 发布，Admin 只能生成不可变、带版本号的 snapshot；`sso-ticket` 仍通过同一个 Registry Interface 裁决，普通 `apps.websiteUrl` 编辑绝不能直接扩大 SSO 权限。

### 零停机迁移顺序

1. Consumer 先固定 redirect URI，但继续使用现有 v2 Provider；旧 Provider 的同源规则兼容该改动。
2. 部署 Provider 页面与 `sso-ticket` v3，保持 `SSO_ALLOW_LEGACY_ORIGIN_CLIENTS=true`；新 code 写 schema v3，兑换端短暂接受最长 60 秒的 schema v2 code。
3. 发布并逐个升级支持 `client_id` 与 `iss` 校验的 `@yunlefun/sso`；观察 Registry decision/audit。
4. 所有第一方 Consumer 完成登记后设置 `SSO_ALLOW_LEGACY_ORIGIN_CLIENTS=false`，再删除三个旧 origin env。

顺序不可反转：先让新 Consumer 强制校验 `iss` 会拒绝旧 Provider 响应；先关闭迁移 Adapter 会中断未升级客户端。

协调升级时，可短时同时打开页面端 `NUXT_PUBLIC_SSO_ALLOW_LEGACY_REDIRECT` 和函数端 `SSO_ALLOW_LEGACY_DIRECT_TICKET`。该兼容只接受缺少 PKCE 参数的旧版顶层 redirect，仅在 fragment 返回一次性 ticket，不返回主站 session；所有 Consumer 升级到支持 v3 合约的版本后必须同时关闭。任一开关关闭即 fail closed。

所需资源：

- `sso_login_codes` server-only 集合；schema v3 绑定 client/issuer/origin/policy/rule/PKCE，短暂兼容消费 schema v2 code。
- `sso_security_limits` server-only 集合，用于跨实例持久化限流。
- `sso_login_codes` 的 `(status ASC, expiresAt ASC)` 与 `(expiresAt ASC)` 索引；`sso_security_limits` 的 `(expiresAt ASC)` 索引。
- `sso-ticket` 已认证 SDK 调用权限，以及 HTTPS `/sso-ticket` 兑换网关。
- `sso-security-sweeper` 禁止直接调用，仅由小时级 timer trigger 清理 24 小时前的 code 审计记录和已过期限流窗口。
- 函数环境中的 custom-login private key、issuer profile 与开发者 UID 配置。
- 校验具体 Origin 后动态回显的 CORS（响应值绝不使用部分通配符），并设置 `no-store`。

资源创建、ACL/网关变化和生产环境变量更新必须按变更审批单独执行。

## 5. 失败处理

| reason                                          | 含义                                | Consumer 行为              |
| ----------------------------------------------- | ----------------------------------- | -------------------------- |
| `not_authenticated`                             | 主站没有真实登录                    | 跳主站登录后重新发起       |
| `client_unknown` / `client_disabled`            | 客户端未注册或已停用                | 停止，修 Registry          |
| `client_required`                               | 迁移 Adapter 关闭后未传 `client_id` | 停止，升级 Consumer        |
| `origin_not_allowed` / `return_url_not_allowed` | 客户端 Origin 或精确回跳绑定失败    | 停止，修 Registry/Consumer |
| `environment_mismatch` / `developer_required`   | issuer 隔离或本地开发者门禁失败     | 切换 development tenant    |
| `code_expired` / `code_used`                    | 过期或重放                          | 从头重新发起，不重试同一码 |
| `code_binding_invalid`                          | Origin/nonce 不一致                 | 停止并记录安全事件         |
| `pkce_required` / `pkce_invalid`                | 缺少或不匹配 PKCE                   | 停止并从头重新发起         |
| `rate_limited`                                  | 持久化速率限制命中                  | 有界退避后重新发起         |
| `not_configured`                                | custom-login secret/provider 未就绪 | 停止发布，修复控制面       |
| `error`                                         | 短暂服务错误                        | 有界退避后从头重新发起     |

不得因这些错误回退到主站 session 转发。`adoptSession`、`setSession(mainSiteRefreshToken)` 和隐藏 iframe 静默 SSO 都属于 legacy 兼容面，Drive/CMS 新接入禁止使用。

## 6. 验收清单

- 正常顶层重定向可以登录同一 uid。
- 错误 origin、lookalike 域名、跨 origin return URL、弱 nonce 均拒绝。
- 同一授权码并发兑换只有一个成功。
- 过期码、已消费码、错误 nonce、错误 PKCE verifier 均拒绝。
- fragment 在消费后从地址栏和 history 中移除。
- SSO payload、数据库文档、日志和应用 cookie 中都不存在 refresh token。
- Consumer 最终只保留 host-only opaque session；设备撤销即时生效。
- Registry 中只有逐客户端的精确 HTTPS Origin 和精确 redirect URI；生产/开发 issuer 隔离；迁移 Adapter 可关闭；`sso-security-sweeper` 无公网调用权限且定时清理成功。
