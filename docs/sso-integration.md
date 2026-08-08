# Web SSO v3 接入指南

适用范围：云乐坊控制的第一方 Web Consumer。第三方应用不加入此信任域；开放第三方时使用同一授权核心之上的标准 OIDC Authorization Code + PKCE Adapter。

当前实现由 `@yunlefun/authorization-core`、`@yunlefun/sso@0.6`、主站 `/auth/sso` 与 `sso-ticket` 组成。旧 origin-only、popup、iframe、session 转发和直接 ticket 通道均已删除；第一方 Apps 宿主只签发与同一套 Registry、nonce 和 PKCE 绑定的一次性授权码。

## 标识与职责

- `clientId` 是协议客户端标识，例如 `cms-web`、`wenta-web`、`skykeeper-desktop`。客户端发送它；它不是 secret。
- `appId` 是业务归属，例如 `cms`、`wenta`、`skykeeper`。只由服务端 Client Registry 从 `clientId` 派生，客户端无权指定。
- 同一业务以后可以有多个客户端，例如 `foo-web`、`foo-ios`；因此不把 `clientId` 简化成 `appId`。
- Web Consumer 只请求 `identity:bootstrap`。缺省 scope 不授予任何权限。

Client Registry 的静态裁决产物由
[`packages/authorization-core/src/registry.ts`](../packages/authorization-core/src/registry.ts) 加载，同时定义
production/development issuer、精确 HTTPS Origin、精确 redirect URI、允许 scope、consent 模式、状态、业务归属和客户端图标。Provider 页面与应用探索页不维护第二份白名单。

### Registry 存储与发布模型

CloudBase NoSQL 是 Registry 的受控管理源，保存草稿、不可变签名快照、审批、发布意图、outbox
与审计；仓库 generated JSON 仍是唯一授权裁决源。首页或授权请求期间不查询 Registry 数据库：

- 它属于安全策略而不是用户内容；变更需要代码评审、自动测试、版本记录和原子回滚。
- 主站构建直接导入 `productionRegistry`，因此首页和 `/explore` 的账号云图在部署时已经获得快照，刷新页面不依赖 CloudBase 查询，也不需要再维护一份运行时缓存。
- `sso-ticket` 与 `desktop-auth` 的部署产物会 vendoring 同一版本的 `@yunlefun/authorization-core`，避免前端展示、Web SSO 和桌面授权读取不同白名单。
- production 变更必须向 allowlist uid 当前绑定的严格已验证邮箱发送 12 位一次性审批码；development
  可跳过邮件，但仍生成签名发布意图并记录审计。
- 审批只创建活动管理快照和签名 release intent；私有 dispatcher 只把 releaseIntentId 交给 GitHub
  Actions。CI 重新验签、导出 generated-only PR、等待 PR checks，再按准确提交部署静态消费者。
- “审批通过”“管理快照活动”“消费者部署完成”是三个不同状态；compare 和 smoke 全部通过后才能记录
  `deployed`。

数据库化只覆盖管理控制面，不提供“无需部署即可改变授权”的动态运行时。授权函数固定消费同一版本的
generated JSON，避免配置写入瞬间造成消费者策略漂移；动态缓存、租约和远程 fallback 已明确延期。

`app/config/sso-explorer.ts` 只维护描述、主题色、失败回退字标、视觉坐标和可选的站内 Logo 覆盖。应用名称、状态、Origin 和客户端自有 `iconUrl` 必须继续来自 Registry。展示文案或图标变化不进入 registration fingerprint；`appId`、`clientId`、adapter、scope、consent、issuer 或状态变化会改变授权安全语义。

### 客户端图标注册规范

- 每个 Web SSO 客户端必须声明绝对 HTTPS `iconUrl`，且图标 Origin 必须与其注册 Origin 完全一致。
- `iconUrl` 直接指向客户端站点自己提供的稳定 SVG、PNG 或 ICO 资源；优先 SVG，不使用带构建哈希或版本查询参数的地址。
- production 与 development 使用相同图标路径、各自环境的 Origin，确保本地联调也验证客户端资源边界。
- 图标只在 Registry 注册一次，账号云图等消费端直接读取；加载失败时消费端可以显示本地字标，但不能再维护另一份图标路径。
- `iconUrl` 属于展示身份，不参与 authorization registration fingerprint；换图标不会使进行中的授权或 refresh grant 失效。

## 协议流程

```text
Consumer              www.yunle.fun              sso-ticket              CloudBase Auth
   | client_id + scope + redirect_uri + nonce + S256   |                        |
   |---------------- top-level redirect -------------->|                        |
   |                         getSession / real user     |                        |
   |                         issue code --------------->| hash-only + binding    |
   |<--------------- #code + nonce + iss --------------|                        |
   | POST code + verifier + complete binding --------->| consume once           |
   |                                                   | getEndUserInfo(uid) --->|
   |                                                   |<-- trusted phone field  |
   |<--------- custom ticket + signed assertion -------|                        |
   | signInWithCustomTicket(getTicket) --------------------------------------->|
   | access token + assertion + nonce ------> Consumer BFF verifies both        |
```

安全性质：

- 每一跳都是顶层第一方页面，不依赖第三方 Cookie、隐藏 iframe、popup 或 opener。
- fragment 只含 256-bit 一次性授权码、nonce 与 issuer；不含 ticket、access token、refresh token 或 session。
- 当前 tab 的 `sessionStorage` 只保存 10 分钟 transaction（nonce、PKCE verifier 和完整客户端绑定）；存储不可用时失败关闭。
- 授权码记录只保存哈希，绑定 issuer、clientId、服务端派生 appId、scope、Origin、redirect URI、nonce、PKCE challenge、policy version 与 registration fingerprint，并在数据库事务中至多消费一次。
- 兑换返回的 custom ticket 只存在于 `signInWithCustomTicket` 回调内。
- 普通账号只依据 CloudBase 服务端 `getEndUserInfo(uid)` 返回的顶层手机号字段做准入；不信任 access token payload、浏览器 profile、`custom_metadata` 或 `user_metadata`。受管测试号是唯一例外：必须同时满足精确的活动测试租约和 admin 持久化的 `authProfile.virtualPhoneBound=true`，且虚拟手机号不写入 CloudBase Auth。
- 手机号或虚拟绑定只在 Provider 侧归约为显式的验证事实，不跨应用传输。兑换响应附带最长 5 分钟的 Ed25519 身份断言，断言仅包含 `phone_number_verified: true`，并绑定 `iss`、`sub`、`aud`、`app_id`、`scope` 与本次 `nonce`；关闭虚拟绑定后，后续验证码、授权码兑换和断言签发立即失败关闭。
- Consumer BFF 必须同时验证 CloudBase access token 和身份断言，并确认两者 `sub` 一致；不能把断言当作登录凭据单独使用。

### 移动客户端账号切换

云乐坊 App 内的第一方 Consumer 可以通过统一 `HostRuntime` 协议请求当前账号授权，或使用
`prompt=select_account` 切换其他账号。其他账号登录必须在平台系统认证组件中完成：iOS 使用
`ASWebAuthenticationSession`，Android 使用 Custom Tabs；用户名、密码、Provider Cookie
和 CloudBase 会话不得进入宿主自定义 WebView。

系统认证请求保留原始 `client_id`、HTTPS `redirect_uri`、scope、nonce 与 S256 PKCE，另带
经过严格校验的 `native_callback_uri=yunlefun://auth/sso?state=<256-bit-state>`。Provider 完成
正常授权后，把原 HTTPS fragment 结果编码为原生回调的 `result` 参数。原生端必须精确校验
state、issuer、原 redirect URI、nonce 和 256-bit code，并拒绝任何 access token、refresh token、
ticket、session、额外 callback 参数或非 HTTPS 结果 URL。该 callback 只是系统浏览器到 App 的
结果传输层，不是 Registry 中的新 redirect URI，不改变 code 的绑定和消费规则。

发布时必须遵循以下顺序，避免已安装客户端调用尚不存在的回调传输：

1. 先发布 Provider `/auth/sso` 的 `native_callback_uri` 校验与结果封装；
2. 再发布 Consumer 的 HostRuntime `select_account` 接入与 Web 降级逻辑；
3. 最后发布 iOS / Android 客户端，并分别验证授权当前账号、切换其他账号、取消、伪造 state、
   返回按钮、超时和一次性 code 重放。

## Consumer 接入

```bash
pnpm add @yunlefun/sso@^0.6.0
```

登录：

```ts
import { startSsoRedirect } from '@yunlefun/sso'

await startSsoRedirect({
  clientId: 'cms-web',
  scope: ['identity:bootstrap'],
  redirectUri: 'https://cms.yunle.fun/',
  ssoOrigin: 'https://www.yunle.fun',
})
```

应用启动时消费回跳：

```ts
import cloudbase from '@cloudbase/js-sdk'
import { adoptSsoCode, consumeSsoRedirect } from '@yunlefun/sso'

const app = cloudbase.init({
  env: 'yunlefun-8g7ybcxc7345c490',
  region: 'ap-shanghai',
  accessKey: '<publishable-key>',
  auth: { detectSessionInUrl: false },
})
const auth = app.auth({ persistence: 'local' })

let identityAssertion = ''
const authorization = consumeSsoRedirect()
if (authorization?.ok) {
  await adoptSsoCode(auth, authorization, {
    exchangeUrl: 'https://api.yunle.fun/sso-ticket',
    fetch: async (input, init) => {
      const response = await fetch(input, init)
      const payload = await response
        .clone()
        .json()
        .catch(() => null)
      identityAssertion
        = typeof payload?.identityAssertion === 'string'
          ? payload.identityAssertion
          : ''
      return response
    },
  })
}
```

若应用使用自己的 BFF session，在 CloudBase 登录成功后把当前 access token、`identityAssertion`
和原始 authorization `nonce` 一并交给 BFF。BFF 需要：

1. 调用 CloudBase `/auth/v1/user/me` 验证 access token 并取得可信 `sub`。
2. 从 `https://api.yunle.fun/sso-ticket` 的 `GET` 响应获取 JWKS，按 `kid` 验证
   `alg=EdDSA`、`typ=ylf-identity+jwt` 和签名。
3. 精确校验 `iss`、`aud`、`app_id`、`scope`、`nonce`、`phone_number_verified=true`、
   `account_status=active`、有效期不超过 5 分钟，并要求 assertion `sub` 与 access token
   用户一致。
4. 建立自己的 HttpOnly session 后立即清除临时 CloudBase session。

禁止把主站或 Consumer 的 refresh token 跨 origin 发送，也禁止通过 JWT payload 解码、
手机号明文或用户可写 metadata 推断手机号已验证。

## 当前注册项

| clientId            | appId          | 展示名称         | production Origin                | scope                | status   |
| ------------------- | -------------- | ---------------- | -------------------------------- | -------------------- | -------- |
| `admin-web`         | `admin`        | YunLeFun Admin   | `https://admin.yunle.fun`        | `identity:bootstrap` | `active` |
| `saier-web`         | `saier`        | 云绘 Saier       | `https://saier.yunle.fun`        | `identity:bootstrap` | `active` |
| `cms-web`           | `cms`          | Yunle CMS        | `https://cms.yunle.fun`          | `identity:bootstrap` | `active` |
| `drive-web`         | `drive`        | 云乐盘           | `https://drive.yunle.fun`        | `identity:bootstrap` | `active` |
| `dayun-kicker-web`  | `dayun-kicker` | 暴力电驴         | `https://dayun-kicker.yunle.fun` | `identity:bootstrap` | `active` |
| `ai-sfc-web`        | `ai-sfc`       | AI 春联          | `https://ai-sfc.yunle.fun`       | `identity:bootstrap` | `active` |
| `home-web`          | `home`         | 云之彼端         | `https://home.yunle.fun`         | `identity:bootstrap` | `active` |
| `wenta-web`         | `wenta`        | 问 TA            | `https://wenta.yunle.fun`        | `identity:bootstrap` | `active` |
| `play-web`          | `play`         | 云乐坊间         | `https://play.yunle.fun`         | `identity:bootstrap` | `active` |
| `smap-web`          | `smap`         | SMAP 星际导航    | `https://smap.yunle.fun`         | `identity:bootstrap` | `active` |
| `studio-web`        | `studio`       | YunYouJun Studio | `https://studio.yunyoujun.cn`    | `identity:bootstrap` | `active` |
| `support-web`       | `support`      | 云乐坊支持中心   | `https://support.yunle.fun`      | `identity:bootstrap` | `active` |
| `skykeeper-desktop` | `skykeeper`    | Skykeeper        | 设备授权 Adapter，无 Web Origin  | `membership:read`    | `active` |

`play-web` 已在 Play Consumer 完成回跳、nonce、PKCE、错误 Origin/redirect URI 和失败
关闭测试，并于 2026-07-26 激活。其 development Origin 与 redirect URI 为
`https://play.yunle.localhost:3449` 和 `https://play.yunle.localhost:3449/`；两套 issuer
仍保持完全隔离。

`smap-web` 是纯静态 Consumer，仅接受 `https://smap.yunle.fun` Origin 与
`https://smap.yunle.fun/tabs/profile` 精确回跳，并只请求 `identity:bootstrap`。
默认 HTTP 本地开发环境不进入 production 或 development Registry。

`studio-web` 是 YunYouJun 的个人创作运营控制面，仅接受
`https://studio.yunyoujun.cn/` 精确回跳。Provider 只完成身份引导；Studio BFF 继续用
CloudBase UID 白名单限制唯一 owner。该客户端不出现在公开应用探索图谱中。其 development
Origin 与 redirect URI 为 `https://studio.yunle.localhost:3454` 和
`https://studio.yunle.localhost:3454/`。

`support-web` 使用 `https://support.yunle.fun/` 精确回跳。它只把短暂
CloudBase access token 交给 Support BFF 兑换 HttpOnly 应用会话，随后立即清除浏览器
CloudBase session；治理成员与 scope 由 Support 服务端独立授权。

`admin-web` 只完成 CloudBase UID 身份引导；管理员角色和权限继续由 Admin 的
`admin_users.userId` 准入表即时判定。GitHub numeric ID 仅用于备用登录和高风险
step-up。该控制面客户端不会出现在公开应用探索图谱或 Apps 工坊市场。

`saier-web` 通过 Apps 宿主取得一次性 PKCE 授权码，或在独立浏览器中使用顶层回跳。
Saier 直接调用 CloudBase storage、database 和 `saier-room-api`，因此采用授权码后建立
自己的 CloudBase 会话，不接收或复用 Apps 的 access token、refresh token 或 session。
其 development Origin 与 redirect URI 为 `https://saier.yunle.localhost:3452` 和
`https://saier.yunle.localhost:3452/`。

development issuer 为 `https://www.yunle.localhost:3000`，只接受 Registry 中的 `.yunle.localhost` HTTPS 回跳。production issuer 不接受本地回跳。部署统一使用：

```dotenv
AUTH_ISSUER_ENVIRONMENT=production
```

本地开发继续运行当前 Provider，不创建第二套实现。在 Provider 仓库配置开发租户的公开 Web Key：

```dotenv
NUXT_PUBLIC_CLOUDBASE_ACCESS_KEY=<yunlefun-dev publishable key>
```

然后执行：

```bash
pnpm dev:sso
```

该命令把同一 Nuxt Provider 暴露为 `https://www.yunle.localhost:3000`，并默认使用 `yunlefun-dev-0ge03bdod37093d1`；首次使用时在另一个终端执行 `pnpm dev:sso:trust` 信任 Caddy 本地 CA。Publishable Key 只授予客户端公开身份能力，函数私钥仍只存在于开发租户的 `sso-ticket` 环境变量中。

开发租户函数发布使用独立且固定 Env ID 的 `cloudbaserc.sso-development.json`。把自定义登录私钥、
独立的 `ACCOUNT_API_INTERNAL_TOKEN`、身份断言 Ed25519 私钥和 `kid` 放入 gitignored 的
`.env.sso-development.local` 后执行 `pnpm deploy:sso:development`；脚本会构建并部署当前
`authorization-core`、`account-api`、`sso-ticket` 和清理函数。不要用生产
`cloudbaserc.json` 发布开发 SSO。

体验套餐不能启用 CloudBase HTTP 访问服务，因此本地 Provider 的 `/api/sso-ticket` 是开发专用的传输适配器：它通过 Publishable Key 调用同一个 `sso-ticket` Event Function，并把请求包装成现有 HTTP 契约。开发租户允许公开调用该函数，但签发仍强制要求真实用户上下文，兑换仍强制校验 Registry、精确 Origin、nonce、一次性授权码和 S256 PKCE；生产清单继续保持 `auth != null` 和正式 HTTPS 网关。

没有 legacy 或 break-glass 开关。新增客户端必须同时提交 Registry 图标同源测试和 Consumer 回跳测试；Registry 的安全字段变化会改变 registration fingerprint，使已有未完成授权与 refresh grant 失败关闭。

### Registry 变更发布清单

1. 通过 `pnpm sso:registry seed --environment <env> ... --apply` 创建草稿，并用 `diff` 审核 security/display
   差异；Web 客户端保持图标与 Origin 同源。
2. production 使用 `request-approval`，再从独立邮件取得审批码并通过环境变量执行 `approve`；development
   使用 `queue`。两条路径都必须绑定当前 `main` 的完整 40 位 commit SHA。
3. dispatcher 仅传 releaseIntentId；`registry-release.yml` 重新验签、确认 main 未移动、运行
   lint/typecheck/test/build/compare，并生成只含两个 generated 文件的发布 PR。
4. 发布任务等待 PR checks 全部通过，再验证 PR head 与审批基线后自动 squash merge；main 上的
   `registry-deploy.yml` 再次验签并使用准确 merge commit。
5. development 只部署 `sso-ticket`；production 部署主站、`sso-ticket` 与 `desktop-auth`。每个环境都在
   compare/smoke 后回写准确消费者 commit，缺少任一消费者或 SHA 不一致时禁止标记 deployed。
6. rollback 选择历史签名快照，提升 generation，并重新走相同审批、PR、部署和 smoke 路径；不得直接改写
   generated 文件或历史快照。
7. production 在确认 development smoke 证据后，才允许仓库管理员把
   `SSO_REGISTRY_PRODUCTION_DEPLOY_ENABLED` 设为 `true`；缺省或其他值会同时阻断 production 发布 PR 与部署任务。
   CI 使用环境级 `CLOUDBASE_API_KEY` 与 `CLOUDBASE_ENV_ID`，不复用个人或全局腾讯云密钥。

## 运维资源

- `sso_login_codes`：server-only；授权码 hash 与完整绑定；终态审计保留 24 小时。
- `sso_security_limits`：server-only；跨实例持久化限流，存储不可用时失败关闭。
- `sso-security-sweeper`：无公网调用权限，定时清理过期码与限流窗口。
- `sso-ticket`：已认证 SDK 负责签发，HTTPS 网关负责兑换；响应必须 `no-store`。
- `sso-ticket` 的同一路径 `GET` 发布只含公钥的 JWKS，可缓存 5 分钟；`POST` 仍为
  `no-store`。
- `AUTH_ISSUER_ENVIRONMENT`、custom-login private key、身份断言 Ed25519 private key
  和限流参数均由部署注入。

### 身份断言密钥轮换

1. 生成新的 Ed25519 密钥对，为新私钥设置全新 `SSO_IDENTITY_SIGNING_KID`。
2. 把旧公钥以 `{ "<old-kid>": <public-jwk> }` 形式保留在
   `SSO_IDENTITY_PUBLIC_KEYS`，同时切换 `SSO_IDENTITY_SIGNING_KEY`。
3. 发布并确认 JWKS 同时包含新旧 `kid`，新断言已使用新 `kid`。
4. 至少等待 10 分钟（两倍 JWKS 缓存窗口，且超过断言最大 5 分钟寿命）后移除旧公钥。

私钥接受 PEM、JWK JSON 或其 base64 编码；公钥集合只允许 JWK。任何必填密钥配置缺失或
解析失败时，签发和 JWKS 都失败关闭。

## 验收清单

- 未注册/停用 client、错误 issuer、错误 Origin、非精确 redirect URI、缺省或越权 scope 全部拒绝。
- 错误 nonce、错误 PKCE verifier、过期码、重放码全部拒绝。
- 同一授权码并发兑换只有一个成功。
- 回跳 fragment 消费后立即从地址栏和 history 清除。
- 源码、URL、日志、授权码文档及跨站消息中都不存在 session/access token/refresh token。
- production/development issuer 与 Registry 完全隔离。
- 普通用户未绑定真实手机号时在兑换阶段返回 `phone_verification_required`；测试号未开启虚拟手机绑定、租约失效或绑定关系不一致时同样不签发验证码、ticket 或身份断言。
- 身份断言不含 `phone_number`，签名、`sub`/`aud`/`nonce` 绑定、过期与未知 `kid`
  任一校验失败时 Consumer BFF 都拒绝建立应用会话。
