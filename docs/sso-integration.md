# Web SSO v3 接入指南

适用范围：云乐坊控制的第一方 Web Consumer。第三方应用不加入此信任域；开放第三方时使用同一授权核心之上的标准 OIDC Authorization Code + PKCE Adapter。

当前实现由 `@yunlefun/authorization-core`、`@yunlefun/sso@0.5`、主站 `/auth/sso` 与 `sso-ticket` 组成。旧 origin-only、popup、iframe、session 转发、native bridge 和直接 ticket 通道均已删除。

## 标识与职责

- `clientId` 是协议客户端标识，例如 `cms-web`、`wenta-web`、`skykeeper-desktop`。客户端发送它；它不是 secret。
- `appId` 是业务归属，例如 `cms`、`wenta`、`skykeeper`。只由服务端 Client Registry 从 `clientId` 派生，客户端无权指定。
- 同一业务以后可以有多个客户端，例如 `foo-web`、`foo-ios`；因此不把 `clientId` 简化成 `appId`。
- Web Consumer 只请求 `identity:bootstrap`。缺省 scope 不授予任何权限。

Client Registry 位于 [`packages/authorization-core/src/registry.ts`](../packages/authorization-core/src/registry.ts)，同时定义 production/development issuer、精确 HTTPS Origin、精确 redirect URI、允许 scope、consent 模式、状态和业务归属。Provider 页面不维护第二份白名单。

## 协议流程

```text
Consumer              www.yunle.fun              sso-ticket             CloudBase Auth
   | client_id + scope + redirect_uri + nonce + S256  |                       |
   |---------------- top-level redirect ------------->|                       |
   |                         getSession / real user    |                       |
   |                         issue code -------------->| hash-only + binding   |
   |<--------------- #code + nonce + iss -------------|                       |
   | POST code + verifier + complete binding -------->| consume once          |
   |<-------------- transient custom ticket ----------|                       |
   | signInWithCustomTicket(getTicket) -------------------------------------->|
```

安全性质：

- 每一跳都是顶层第一方页面，不依赖第三方 Cookie、隐藏 iframe、popup 或 opener。
- fragment 只含 256-bit 一次性授权码、nonce 与 issuer；不含 ticket、access token、refresh token 或 session。
- 当前 tab 的 `sessionStorage` 只保存 10 分钟 transaction（nonce、PKCE verifier 和完整客户端绑定）；存储不可用时失败关闭。
- 授权码记录只保存哈希，绑定 issuer、clientId、服务端派生 appId、scope、Origin、redirect URI、nonce、PKCE challenge、policy version 与 registration fingerprint，并在数据库事务中至多消费一次。
- 兑换返回的 custom ticket 只存在于 `signInWithCustomTicket` 回调内。

## Consumer 接入

```bash
pnpm add @yunlefun/sso@^0.5.0
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

const authorization = consumeSsoRedirect()
if (authorization?.ok) {
  await adoptSsoCode(auth, authorization, {
    exchangeUrl: 'https://api.yunle.fun/sso-ticket',
  })
}
```

若应用使用自己的 BFF session，可在 CloudBase 登录成功后把当前 access token 作为一次性身份证明交给 BFF，再清除临时 CloudBase session。禁止把主站或 Consumer 的 refresh token跨 origin 发送。

## 当前注册项

| clientId            | appId          | production Origin                | scope                |
| ------------------- | -------------- | -------------------------------- | -------------------- |
| `cms-web`           | `cms`          | `https://cms.yunle.fun`          | `identity:bootstrap` |
| `drive-web`         | `drive`        | `https://drive.yunle.fun`        | `identity:bootstrap` |
| `dayun-kicker-web`  | `dayun-kicker` | `https://dayun-kicker.yunle.fun` | `identity:bootstrap` |
| `ai-sfc-web`        | `ai-sfc`       | `https://ai-sfc.yunle.fun`       | `identity:bootstrap` |
| `home-web`          | `home`         | `https://home.yunle.fun`         | `identity:bootstrap` |
| `wenta-web`         | `wenta`        | `https://wenta.yunle.fun`        | `identity:bootstrap` |
| `skykeeper-desktop` | `skykeeper`    | 设备授权 Adapter，无 Web Origin  | `membership:read`    |

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

开发租户函数发布使用独立且固定 Env ID 的 `cloudbaserc.sso-development.json`。把自定义登录私钥与独立的 `ACCOUNT_API_INTERNAL_TOKEN` 放入 gitignored 的 `.env.sso-development.local` 后执行 `pnpm deploy:sso:development`；脚本会构建并部署当前 `authorization-core`、`account-api`、`sso-ticket` 和清理函数。不要用生产 `cloudbaserc.json` 发布开发 SSO。

体验套餐不能启用 CloudBase HTTP 访问服务，因此本地 Provider 的 `/api/sso-ticket` 是开发专用的传输适配器：它通过 Publishable Key 调用同一个 `sso-ticket` Event Function，并把请求包装成现有 HTTP 契约。开发租户允许公开调用该函数，但签发仍强制要求真实用户上下文，兑换仍强制校验 Registry、精确 Origin、nonce、一次性授权码和 S256 PKCE；生产清单继续保持 `auth != null` 和正式 HTTPS 网关。

没有 legacy 或 break-glass 开关。新增客户端必须同时提交 Registry 测试和 Consumer 回跳测试；Registry 的安全字段变化会改变 registration fingerprint，使已有未完成授权与 refresh grant 失败关闭。

## 运维资源

- `sso_login_codes`：server-only；授权码 hash 与完整绑定；终态审计保留 24 小时。
- `sso_security_limits`：server-only；跨实例持久化限流，存储不可用时失败关闭。
- `sso-security-sweeper`：无公网调用权限，定时清理过期码与限流窗口。
- `sso-ticket`：已认证 SDK 负责签发，HTTPS 网关负责兑换；响应必须 `no-store`。
- `AUTH_ISSUER_ENVIRONMENT`、custom-login private key 和限流参数均由部署注入。

## 验收清单

- 未注册/停用 client、错误 issuer、错误 Origin、非精确 redirect URI、缺省或越权 scope 全部拒绝。
- 错误 nonce、错误 PKCE verifier、过期码、重放码全部拒绝。
- 同一授权码并发兑换只有一个成功。
- 回跳 fragment 消费后立即从地址栏和 history 清除。
- 源码、URL、日志、授权码文档及跨站消息中都不存在 session/access token/refresh token。
- production/development issuer 与 Registry 完全隔离。
