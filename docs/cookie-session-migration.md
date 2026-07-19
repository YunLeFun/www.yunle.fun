# httpOnly Cookie 会话迁移方案（双层会话 hybrid）

> 历史迁移记录：本文保留用于追溯旧的 token-bearing cookie 迁移过程，其中
> `mintForUser(uid)`、主站 session 转发和 cookie 内保存 CloudBase token 的设计不再允许用于新代码。
> 当前规范以 [跨站 SSO 接入指南](./sso-integration.md) 和 `@yunlefun/server-session` 文档为准。

> 状态：Phase 1 代码与本地 E2E 已完成；生产激活仍依赖 EdgeOne 真正托管 Nuxt SSR 运行时。本文是迁移的唯一权威设计参考，按阶段推进，每阶段独立可发布。

## 1. 背景与目标

当前 Web 端登录态由 `@cloudbase/js-sdk` 以 `persistence: 'local'` 存于 **localStorage**（[useCloudbase.ts:31](../app/composables/useCloudbase.ts)）。这带来两个长期问题：

1. **安全**：access/refresh token 暴露给 JS，任一 XSS / 被投毒依赖即可窃取「解锁云币/支付 + 经 SSO 关联子应用」的皇冠凭证。OWASP 明确不建议 localStorage 存 token。
2. **体验**：服务端渲染时不知道用户是谁，首屏必为未登录态 → 刷新/落地闪「登录/注册」。骨架屏只能遮，不能根治。

目标：把**持久会话**变成服务端可读的 **httpOnly cookie**，让 SSR 渲染正确首屏（无闪）、持久凭证离开 JS（防 XSS），同时把 yunle.fun 收敛成标准 IdP 形态（cookie on auth-origin + 子站 redirect/ticket）。

## 2. 现状基线（源码事实，迁移设计以此为准）

| 事实                                                                                                                          | 证据                                                                                                                                                          | 影响                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **repo 构建已是 `nuxt build`（Nitro `node-server`、`ssr:true` hybrid）**，但**线上 EdgeOne 当前仍按静态托管、无服务端运行时** | `package.json` `build:"nuxt build"` + 本地 `.output/nitro.json` `preset:"node-server"`；**实测 prod `POST /api/session/*` 全 404（`server: edgeone-pages`）** | 代码就绪，但 cookie 端点在线上不存在；须让 EdgeOne 真正 serve SSR 运行时（托管 `.output/server`）才能种/读 cookie |
| 账号页 `ssr:false`（SPA 壳）                                                                                                  | [nuxt.config.ts:87-98](../nuxt.config.ts)                                                                                                                     | 灭闪需翻回 SSR                                                                                                    |
| `@cloudbase/js-sdk` 无 httpOnly cookie 会话模式                                                                               | SDK 从 JS 存储读 token 贴到 callFunction                                                                                                                      | cookie 只能是「我们自己的会话」，不是 SDK 的                                                                      |
| 31 处 `callFunction` + 2 集合直连 + 1 storage 共用客户端 token                                                                | 影响面盘点（6 云函数：account-api ~22、wxpay-order、desktop-auth、github-api、sso-ticket）                                                                    | 不能简单删 token，否则全站数据访问失效                                                                            |
| **所有云函数 uid 来自运行时注入**                                                                                             | [account-api/index.js:71](../cloudfunctions/account-api/index.js) `getCallerUid()` 读 `getUserInfo().uid`                                                     | 只要 SDK 有内存登录态，函数零改动                                                                                 |
| **服务端铸票原语已在用**                                                                                                      | [sso-ticket/index.js](../cloudfunctions/sso-ticket/index.js) `auth().createTicket(uid)`（RS256 JWT，票据 10 分钟过期）                                        | 保留给跨站 SSO；本站自恢复已改为原始会话 `setSession`                                                             |
| 已有内部服务 token 范式                                                                                                       | `ACCOUNT_API_INTERNAL_TOKEN`（[.env.example:31](../.env.example)）；account-api `deductCoinForUser` 等                                                        | sso-ticket 服务端代签路径照搬此鉴权范式                                                                           |

## 3. 目标架构：双层会话

- **第一层（持久、安全）= 自有 httpOnly cookie**：Nuxt SSR 服务端用 `nuxt-auth-utils`（sealed cookie，底层 `iron-webcrypto`）封装 `{ uid, 最小资料 }`。SSR 阶段 `useUserSession()` 直接读出 → 正确首屏。持久凭证不进 JS。
- **第二层（临时、功能）= CloudBase SDK 内存 token**：登录时把原始 CloudBase access/refresh token 封进 cookie secure 段；页面启动时由 `/api/session/bootstrap` 取回，客户端 `auth.setSession()` 恢复同一 CloudBase 会话。**SDK 照常直连 31 处数据访问，零改动。**

```
浏览器                         Nuxt SSR 服务端(www)            CloudBase(api)
─ httpOnly cookie(持久真值)  ─ 读 cookie → 正确首屏          ─ /auth/v1/user/me 校验 token
─ CloudBase SDK(内存 token)  ─ /session: 设cookie · 取令牌    ─ account-api 等 6 函数(uid运行时注入·不变)
─ 数据直连 ×31(不变)         ─ OAuth code 交换搬这           ─ DB / storage(不变)

① 登录 → set-cookie    ② cookie→原始令牌→setSession    ③ 数据调用: SDK→CloudBase(内存token·不变)
```

### 为什么不是纯 BFF / 纯 nuxt-auth-utils 替换 CloudBase Auth

纯 BFF（浏览器只持 cookie、所有数据走 Nuxt 代理）要把 31 处直连重写成服务端代理，并丢弃 CloudBase Auth 的 OTP/OAuth/密码机制——是过度工程且推翻在用基建。双层 hybrid 保留 CloudBase 作数据后端与身份校验器，仅在其上加一层 Web 会话，是适配 CloudBase 约束的最佳实践形态。

### CloudBase WebV3 对齐（来源：[docs.cloudbase.net/api-reference/webv3/authentication](https://docs.cloudbase.net/api-reference/webv3/authentication)）

实现须贴合 WebV3（`@cloudbase/js-sdk` v3）实际 API，已核对：

- **启动恢复 = `auth.setSession({ access_token, refresh_token })`**：客户端启动时从 `/api/session/bootstrap` 取回 cookie secure 段封存的原始 token，恢复同一 CloudBase 会话；`signInWithCustomTicket` 保留给跨站 SSO 子站凭票登录。
- **persistence 实况（已实测，重要）**：`@cloudbase/js-sdk@3.3.13` 的 `persistence` **只认 `'local'`**——浏览器实测 `'session'` 与 `'none'` 都回落到 localStorage（`credentials_<env>` 始终写 localStorage）。**故无法靠 `persistence` 把 refresh token 移出 JS 可读区，XSS 硬化这一安全目标本方案当前并未达成。** 已把 useCloudbase 的 persistence 改回 `'local'`。
  - **自定义内存 storage 适配器：已验证可行（关键结论：不必上纯 BFF）。** `AuthOptions.storage?: SimpleStorage`（6 方法）是注入点；注入 Map 内存实现后实测 `credentials_<env>` **不再落 localStorage**，会话由 cookie→setSession 重建、鉴权数据访问（账户余额等）正常。实现见 [useCloudbase.ts](../app/composables/useCloudbase.ts) `createMemoryStorage`。
  - **但内存化引入「启动竞态」**：内存每次 load 都为空，bootstrap（cookie→setSession）完成前提前触发的鉴权调用会 403（实测 `apps` 集合直读、`加载个人数据失败`）。**同一竞态也存在于基础 cookieSession 路径的「新标签/清存储」恢复场景**（普通 reload 因 localStorage 有 token 不受影响，实测干净）。
  - **修复 = 「会话就绪前不发鉴权请求」门控**（数据加载 composable 等 bootstrap/`authReady` 完成再发）。完成后内存化即可常开。当前内存化挂在 opt-in 开关 `NUXT_PUBLIC_COOKIE_SESSION_MEMORY`（默认关），避免污染主路径。
  - **纯 BFF**（浏览器只持 cookie、所有 CloudBase 调用走 Nuxt 代理）= 最彻底但最重（重写 31 处直连），**鉴于内存化已验证可行，不推荐**，除非要「token 绝不进浏览器」的极致硬化。
- **OAuth（WebV3）**：`signInWithOAuth()` 生成授权 URL + `verifyOAuth()` 校验回调；现有 callback.vue 用的是更底层的 `grantProviderToken`/`signInWithProvider`。Phase 2 服务端化时按 WebV3 形态重写。
- **服务端校验会话**：WebV3 文档建议用 Manager Node SDK（`getUserInfo`/`getEndUserInfo`）；本方案 `login.post.ts` 暂用已在生产验证的「身份认证 HTTP API」`/auth/v1/user/me`（Bearer），两者等价，后续可换 Node SDK。

## 4. 分阶段计划

每阶段独立可发布；迁移期间 app 始终能跑，到 Phase 1 cutover 才切走 localStorage。

### Phase 0 · 上服务端运行时（基建）

- **改动**：构建从 `nuxt generate` → `nuxt build`（Nitro，preset `node-server`）；装 `nuxt-auth-utils`、注册模块、配 `NUXT_SESSION_PASSWORD`。
- **已验证**：`pnpm build` → `.output/nitro.json` preset 由 `static` 翻为 `node-server`，产出 `.output/server/index.mjs`，三个 `/api/session/*` 端点打进 server bundle；起 `node .output/server/index.mjs` 实测端点 400/401/200 + httpOnly Set-Cookie，首页 SSR 200。
- **EdgeOne 部署（平台侧动作，需账号）——⚠️ 实测尚未生效**：线上 `POST /api/session/*` 仍 404（`server: edgeone-pages`），即当前部署没有 serve SSR 运行时。仍需：
  - 装 `@edgeone/nuxt-pages`（官方适配，build 阶段把 preset 设 `node-server`、输出 remap 到 `.edgeone/`），或用 EdgeOne 原生 Nuxt SSR 识别；
  - EdgeOne 控制台构建命令 `nuxt generate` → `pnpm build`（或适配器编排），输出目录相应调整；
  - EdgeOne env 配 `NUXT_SESSION_PASSWORD`（≥32 字符）；生产激活 cookie 会话时再配 `NUXT_PUBLIC_COOKIE_SESSION=true`。
- **风险**：EdgeOne SSR 冷启动、`/u` SSR 同时真正生效。

### Phase 1 · 会话层 + 启动恢复（安全核心，token 出 localStorage）

- **改动**：
  - `server/api/session/login.post.ts`：收前端 CloudBase 登录后的 access_token + refresh_token → 服务端向 `/auth/v1/user/me` 校验并取 uid（杜绝伪造）→ `setUserSession({ user:{ uid }, secure:{ accessToken, refreshToken } })`。
  - `server/api/session/bootstrap.post.ts`：`requireUserSession` 读取 cookie secure 段 → 返回原始 accessToken + refreshToken，客户端用 `auth.setSession()` 恢复同一 CloudBase 会话。
  - `server/api/session/logout.post.ts`：`clearUserSession`。
  - CloudBase：sso-ticket 的 `mintForUser(uid)` 路径保留给跨站 SSO，本站自恢复不再依赖它。
  - 客户端 [useCloudbase.ts](../app/composables/useCloudbase.ts) 在 cookie 会话 + memory 模式下使用内存 storage；启动流程：加载 → `$fetch('/api/session/bootstrap')` → `auth.setSession()` → 数据直连照常。
- **验收**：refresh_token 不再落 localStorage；刷新后经 cookie+bootstrap 恢复同一 CloudBase 会话；数据访问正常。

### Phase 2 · 改造登录入口去种 cookie

- OTP / 密码：CloudBase 登录成功后把会话交给 `/session/login` 种 cookie（当前已由 `useAuthCore.fetchUser()` 在 `NUXT_PUBLIC_COOKIE_SESSION=true` 时统一接入，随登录态刷新续封 cookie）。
- **OAuth（最大重写）**：code 交换搬服务端——第三方 `redirect_uri` 指向 server route，服务端做 `grantProviderToken`/`signInWithProvider` 等价交换、建会话、`setUserSession`。[callback.vue](../app/pages/auth/callback.vue) 退化为「服务端已建好，跳转即可」，`detectSessionInUrl` 取舍删除。
- 登出：`clearUserSession` + SDK `signOut`。

### Phase 3 · SSR 首屏，彻底灭闪

- 账号页 routeRules `ssr:false` → `ssr:true`（/profile、/wallet、/settings…）。SSR 读 cookie → 直接渲染头像。已做的三态骨架/乐观缓存退居纯 SPA 跳转兜底。

### Phase 4 · SSO 桥收敛 + 桌面端

- [sso.vue:174](../app/pages/auth/sso.vue) postMessage 通道不再发整个 session（JS 没 token 了）→ **只发 ticket**（redirect 通道本就只发 ticket，已兼容）；子站统一 `signInWithCustomTicket`。
- 桌面 `/link`：逻辑不动，`approveDevice` 的 uid 随会话源自动跟着变；设备码 + Ed25519 entitlement 链路完全不碰。

### Phase 5 · 清理 + 安全收口

- 删客户端直读 access_token 的 3 处（enrichPasswordStatus 的 Bearer、支付门禁、SSO 判断）。
- cookie flags：httpOnly + Secure + SameSite=Lax + 合理 maxAge。
- **CSRF / 滥用防护**：`/session/*` 已加 SameSite=Lax + `Origin` 同源校验 + 进程内固定窗口限速（见 [session-security.ts](../server/utils/session-security.ts)）。剩余纵深为 CSP、短 token TTL、全局共享限速（KV/Redis）与安全 review。

## 5. CloudBase 铸票端点契约（`mintForUser`）

新增（或在 sso-ticket 内分支）一个内部 token 鉴权的服务端调用。该能力当前保留给跨站 SSO / 服务端代签票据，本站 cookie 启动恢复已改为原始会话 `setSession`，不再调用本端点。

- **输入**：`{ action:'mintForUser', uid }` + header `x-internal-token: <ACCOUNT_API_INTERNAL_TOKEN 同范式>`。
- **校验**：内部 token 相等；uid 满足 `createTicket` 的 `validateUid`（4–32 长度、受限字符集，CloudBase uid 天然满足）。
- **输出**：`{ ok:true, ticket }`（`createTicket(uid,{ refresh, expire })`，票据本身 10 分钟有效）。
- **密钥**：复用 `SSO_TICKET_PRIVATE_KEY_ID/_KEY`，私钥不出 CloudBase。
- **注意**：现有 sso-ticket 从「调用者上下文」取 uid（杜绝越权），新路径改为「内部 token 信任 + 显式 uid」，二者并存、互不影响。

## 6. 新增环境变量

| 变量                                | 用途                                                | 位置                      |
| ----------------------------------- | --------------------------------------------------- | ------------------------- |
| `NUXT_SESSION_PASSWORD`             | nuxt-auth-utils 封 sealed cookie 的密钥（≥32 字符） | Nuxt 服务端 / EdgeOne env |
| `NUXT_PUBLIC_COOKIE_SESSION`        | 生产激活 cookie 会话启动恢复                        | EdgeOne env               |
| `NUXT_PUBLIC_COOKIE_SESSION_MEMORY` | 生产激活内存 token，不落 localStorage               | EdgeOne env               |
| `SSO_TICKET_INTERNAL_TOKEN`         | sso-ticket 服务端代签路径的内部调用鉴权             | CloudBase 函数 env        |

## 7. 影响清单

| 流程                                  | 类型         | 说明                                                                   |
| ------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| OAuth 回调（callback.vue）            | **桥要重写** | code 交换从客户端搬服务端（Phase 2）                                   |
| SSO postMessage 通道                  | **桥要改**   | 改为只发 ticket；redirect 通道已兼容（Phase 4）                        |
| 桌面 `/link` + desktop-auth           | 自动跟随     | 仅依赖全站 `isAuthenticated`/`getCallerUid`；设备码 + entitlement 不碰 |
| 31 处数据直连 + 6 云函数              | **不变**     | uid 运行时注入，SDK 有内存登录态即可                                   |
| SSO 白名单 / nonce、App deeplink 回调 | 不受影响     | —                                                                      |

## 8. 验收与回退

- 每阶段以「现有功能不回归 + 该阶段新能力可验证」为准。
- 回退：Phase 0-1 为新增端点 + 客户端启动流程，可通过 `persistence` 切回 `'local'` + 关闭 bootstrap 快速回退；Phase 2/3 涉及登录入口与 routeRules，回退需还原对应 commit。
- 安全 review 在 Phase 5 收口：CSP、短 token TTL、共享限速、cookie flags、私钥边界。

## 9. 进度 Checklist

- Phase 0：
  - [x] 装 nuxt-auth-utils + 注册模块（[nuxt.config.ts](../nuxt.config.ts)）+ runtimeConfig 铸票配置 + `.env.example`
  - [x] `nuxt build`（Nitro `node-server`）本地验证：preset `static`→`node-server`，`.output/server` 产出 + 端点 400/401/200+cookie 实测通过
  - [ ] **EdgeOne 真正 serve SSR 运行时（实测未生效）**：repo `build` 已是 `nuxt build`，但线上 `POST /api/session/*` 仍 404（`server: edgeone-pages`）→ 当前部署无服务端运行时。需构建命令 `pnpm build` + **`@edgeone/nuxt-pages` 适配或原生 SSR（真正托管 `.output/server`）** + EdgeOne env（至少 `NUXT_SESSION_PASSWORD`；激活时加 `NUXT_PUBLIC_COOKIE_SESSION=true`）。控制台需账号；适配器可在 repo 内加。
- Phase 1：
  - [x] `/session/{login,bootstrap,logout}` 端点（[server/api/session/](../server/api/session/)）+ `#auth-utils` 类型（[shared/auth.d.ts](../shared/auth.d.ts)）；本地验证：cookie 种/清/守卫 OK
  - [x] CloudBase sso-ticket 加内部 token `mintForUser(uid)` 路径（[mint.js](../cloudfunctions/sso-ticket/mint.js) + [index.js](../cloudfunctions/sso-ticket/index.js)，既有调用者路径不变）+ 单测 [tests/sso-ticket/mint.test.js](../tests/sso-ticket/mint.test.js)（4/4）
  - [x] 客户端编排 composable [useServerSession.ts](../app/composables/auth/useServerSession.ts)
  - [x] **CloudBase 配置（MCP，prod yunlefun）**：部署 sso-ticket 代码 + 设 `SSO_TICKET_INTERNAL_TOKEN`（merge 保留私钥）+ 建 HTTP 网关 `/sso-ticket`；prod 三路径实测：`ok+ticket` / `forbidden` / `invalid_uid` 全通过
  - [x] **cutover 代码**（flag `NUXT_PUBLIC_COOKIE_SESSION` 门控）：[useCloudbase](../app/composables/useCloudbase.ts) persistence `session`/`local` + [useAuthCore](../app/composables/auth/useAuthCore.ts) 接 `setServerSession`（登录）/`bootstrapFromCookie`（启动恢复）/`clearServerSession`（登出）；本地 flag on 验证：boot/guest 重定向/无错
  - [x] **真实账号 E2E（本地 dev + flag on）**：邮箱 OTP 登录→httpOnly cookie 种上；`/api/session/bootstrap` 200 + 原始 access/refresh token；**清空 localStorage+sessionStorage 后 reload，仍留在 /wallet、头像恢复、无登录闪、无控制台错误**——会话纯由 cookie 恢复 ✅
  - [x] **内存化适配器已验证（不必上 BFF）**：persistence `'session'`/`'none'` 都回落 localStorage（无效）；改用 `createMemoryStorage` 注入 `AuthOptions.storage`，实测 token 不落 localStorage、会话由 cookie 重建、鉴权数据访问正常。挂 opt-in `NUXT_PUBLIC_COOKIE_SESSION_MEMORY`（默认关）。
  - [x] **会话就绪门控**：新增 [onUserSession](../app/composables/onUserSession.ts)（会话就绪后再发鉴权请求）+ [useRequireAuth](../app/composables/useRequireAuth.ts)（authReady 后才跳登录，cookie 恢复窗口内不误踢）；两者在 `!authReady` 时主动触发 `checkAuthStatus`（公开路由不经中间件恢复登录态，需自行触发）。已应用于 [profile](../app/pages/profile.vue)、[apps/index](../app/pages/apps/index.vue)、[apps/new](../app/pages/apps/new.vue)、[apps/[slug]/edit](../app/pages/apps/%5Bslug%5D/edit.vue)。实测 memory-only 下：protected 路由（中间件门控）、home、/profile、/feed、/apps 均 0 错、不误跳、token 不落 localStorage。
  - [x] **bootstrap 重构为 setSession 恢复原始会话（取代 custom-ticket）——真实账号 E2E 已通过。**
    - **机制**：login 时把**原始** access/refresh token 封进 cookie 的 `secure` 段（仅服务端可读，见 [shared/auth.d.ts](../shared/auth.d.ts)）；启动 [bootstrap](../server/api/session/bootstrap.post.ts) 取回，客户端 `auth.setSession({ access_token, refresh_token })`（内部用 refresh_token 刷新）恢复**同一会话**；恢复后重新封 cookie 处理轮换。见 [useServerSession.ts](../app/composables/auth/useServerSession.ts)。匿名两阶段自测得 `sameSession: true`。
    - **真实账号 E2E（memory-only，云游君）已验证**：邮箱 OTP 登录 → 清空 localStorage+sessionStorage + reload → setSession 恢复 → **非匿名、token 不落 localStorage、无闪、无控制台错误**；`/wallet` 余额 1006（callFunction）、**会员有效（`user_memberships` 直读）** 全部正常。**证明恢复的会话对 callFunction 与直读都完整鉴权。**
    - 安全：原始 refresh_token 存 sealed httpOnly cookie（iron-webcrypto 加密、仅服务端），客户端仅内存；durable 凭证不进 localStorage。
    - sso-ticket 的 `mintForUser` 不再用于本站自恢复（保留给跨站 SSO）；Nuxt 侧 `NUXT_SSO_TICKET_*` 已移除。
  - [x] **`apps` 集合直读 403 —— 已修复（独立的 apps 安全规则 + 数据问题，非会话/迁移回归）。**
    - **根因（已用真实 owner 会话在 prod 实测确认）**：① 规则归属分支按 `doc._openid`，而 getMyApps 按 `.where({ ownerId })` 查询；CloudBase 读规则要求「查询条件必须含规则引用的字段」，`ownerId ≠ _openid` → 整查询被拒 `DATABASE_PERMISSION_DENIED`。② **22 条历史 apps 文档根本没有 `ownerId` 字段**（早期种子数据只有 `_openid`/`ownerLogin`），仅改规则仍 0 命中、「我的应用」仍空。
    - **修复（CloudBase MCP，prod env yunlefun，已生效无需部署）**：先回填 `ownerId = _openid`（22/22 modified）；再改规则 `read: "doc.isPublic == true || auth.uid == doc.ownerId"`、`update/delete: "auth.uid == doc.ownerId"`、create 不变；顺带去掉 vestigial 的 `status == 'approved'` 门槛（类型 `AppRecord` 无 status、createApp 不写、UI 用「公开」开关 → 公开门槛即 isPublic）。`user_memberships` 本就是 `auth.uid == doc.userId`，无需改（即对齐参照）。
    - **实测（prod，真实 owner token，replay DB 端点）**：`{ownerId}`→200/22 条；`{slug,isPublic:true}`→200/1；`{slug}` 单字段→仍 403（符合预期，证明规则仍正确拒绝无字段查询）。
    - **公开读路径同类修复（前端，⚠️ 待重新部署才在 prod 生效）**：`getAppBySlug` 改 `.where({ slug, isPublic:true })`、新增 owner 版 `getMyAppBySlug`（编辑页改用）、`isSlugTaken` 收敛为 owner 域（全局唯一性建议加 `slug` 唯一索引兜底）；见 [useApps.ts](../app/composables/useApps.ts) + [apps/[slug]/edit.vue](../app/pages/apps/%5Bslug%5D/edit.vue)。`getUserApps` 本就带 `isPublic:true`，规则改完即恢复（无需部署）。
    - **附带观察（与本条无关，留痕）**：prod `/apps` 在本地有有效 owner 凭证时仍被守卫跳 `/login`（已部署的旧构建早于 onUserSession/useRequireAuth 会话恢复改造）——属会话恢复/守卫问题，本迁移上线后即解。
  - [x] `/session/*` 基础防护：SameSite=Lax + Origin 同源校验 + 进程内限速（见 [server/utils/session-security.ts](../server/utils/session-security.ts)）
  - [ ] 纵深防御（Phase 5）：严格 CSP + 短 token TTL + 全局共享限速（KV/Redis）+ 安全 review
  - [ ] **prod 激活**：EdgeOne env 置 `NUXT_PUBLIC_COOKIE_SESSION=true` + `NUXT_PUBLIC_COOKIE_SESSION_MEMORY=true` + `NUXT_SESSION_PASSWORD`
- [ ] Phase 2：OTP/密码种 cookie + OAuth code 交换服务端化
- [ ] Phase 3：账号页 routeRules 翻回 SSR，灭闪
- [ ] Phase 4：SSO 桥只发 ticket + 桌面端联调
- [ ] Phase 5：清理客户端 token 直读 + CSRF/cookie flags/限速 + 安全 review
