# 跨站 SSO 接入指南：一次性授权码 + 应用独立会话

适用范围：云乐坊完全控制的第一方 Web 应用，例如 `drive.yunle.fun`、CMS 和后续 AdvJS 示例。第三方应用必须使用 OAuth/OIDC，不得加入本 SSO 信任白名单。

实现由 [`@yunlefun/sso`](https://github.com/YunLeFun/ylf/tree/main/packages/sso)、主站 `/auth/sso` 和 CloudBase `sso-ticket` 函数组成。

## 1. 不会重复的三层职责

| 层       | 组件                           | 生命周期                     | 保存内容                                                         |
| -------- | ------------------------------ | ---------------------------- | ---------------------------------------------------------------- |
| 身份联邦 | `@yunlefun/sso` + `sso-ticket` | 一次登录握手，默认 60 秒     | 一次性授权码的 SHA-256、origin、nonce、PKCE challenge、uid、状态 |
| 身份证明 | CloudBase Auth                 | 仅 BFF exchange 前的临时桥接 | CloudBase SDK 内存 session                                       |
| 应用会话 | `@yunlefun/server-session`     | idle/absolute TTL、设备撤销  | opaque token 的 SHA-256 与安全设备元数据                         |

SSO 只证明“这是哪个 CloudBase 用户”；`server-session` 决定 Drive/CMS 是否仍允许该设备访问。二者不能合并，也不应互相保存对方的 bearer token。

## 2. 推荐流程

```text
Consumer                www.yunle.fun             sso-ticket              CloudBase Auth       App BFF
   | top-level redirect       |                         |                         |                 |
   | target+return+nonce+S256 challenge --------------->|                         |                 |
   |                          | getSession()            |                         |                 |
   |                          | issueSsoCode ---------->| current caller uid      |                 |
   |<-- #code + nonce --------|                         |                         |                 |
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
- `returnUrl.origin` 必须等于声明的 `targetOrigin`，两者都必须命中白名单。
- 授权码绑定 target origin + nonce + S256 PKCE challenge，数据库事务保证只有一个消费请求成功；verifier 只保存在 Consumer 当前 tab 的 `sessionStorage`，不进入 URL。
- 签发端 uid 只来自 `contextApp.auth().getUserInfo()`；任何 `uid`、`userId`、`subject` 或 `customUserId` 输入均拒绝。
- CloudBase custom-login 私钥只保存在函数受管 secret/env，不进入仓库、日志或客户端。

## 3. Consumer 代码

安装：

```bash
pnpm add @yunlefun/sso
```

登录按钮：

```ts
import { startSsoRedirect } from '@yunlefun/sso'

await startSsoRedirect()
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

## 4. Provider 与云函数配置

页面和函数必须使用相同的生产白名单：

```dotenv
NUXT_PUBLIC_SSO_ALLOWED_TARGET_ORIGINS=https://*.yunle.fun
SSO_ALLOWED_ORIGINS=https://*.yunle.fun
SSO_ALLOWED_RETURN_ORIGINS=https://*.yunle.fun
SSO_ALLOW_LOCAL_TARGET_ORIGINS=false
NUXT_PUBLIC_SSO_ALLOW_LEGACY_REDIRECT=false
SSO_ALLOW_LEGACY_DIRECT_TICKET=false
```

同一受控主域下可使用受限的 `https://*.yunle.fun`：它匹配一级或多级子域，但不匹配根域、HTTP、显式端口、路径、尾随点或伪后缀。只有在全部子域都由同一可信团队治理时才应启用；第三方或不同信任边界的 Consumer 仍必须登记精确 HTTPS origin。开发时可显式放行 loopback HTTP，但不得放行局域网地址。

协调升级时，可短时同时打开页面端 `NUXT_PUBLIC_SSO_ALLOW_LEGACY_REDIRECT` 和函数端 `SSO_ALLOW_LEGACY_DIRECT_TICKET`。该兼容只接受缺少 PKCE 参数的旧版顶层 redirect，仅在 fragment 返回一次性 ticket，不返回主站 session；所有 Consumer 升级到 0.4.0 后必须同时关闭。任一开关关闭即 fail closed。

所需资源：

- `sso_login_codes` server-only 集合。
- `sso_security_limits` server-only 集合，用于跨实例持久化限流。
- `sso_login_codes` 的 `(status ASC, expiresAt ASC)` 与 `(expiresAt ASC)` 索引；`sso_security_limits` 的 `(expiresAt ASC)` 索引。
- `sso-ticket` 已认证 SDK 调用权限，以及 HTTPS `/sso-ticket` 兑换网关。
- `sso-security-sweeper` 禁止直接调用，仅由小时级 timer trigger 清理 24 小时前的 code 审计记录和已过期限流窗口。
- 函数环境中的 custom-login private key 与白名单。
- 校验具体 Origin 后动态回显的 CORS（响应值绝不使用部分通配符），并设置 `no-store`。

资源创建、ACL/网关变化和生产环境变量更新必须按变更审批单独执行。

## 5. 失败处理

| reason                                          | 含义                                | Consumer 行为              |
| ----------------------------------------------- | ----------------------------------- | -------------------------- |
| `not_authenticated`                             | 主站没有真实登录                    | 跳主站登录后重新发起       |
| `origin_not_allowed` / `return_url_not_allowed` | 白名单或回跳绑定失败                | 停止，修配置               |
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
- 生产白名单只包含精确 HTTPS origin，或在全部子域由同一可信团队治理时使用受限的 `https://*.yunle.fun`；不得使用其他形式的通配符；`sso-security-sweeper` 无公网调用权限且定时清理成功。
