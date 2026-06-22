# 服务端职责划分：CloudBase vs Nuxt Server（EdgeOne Pages）

> 2026-06：站点已部署在 EdgeOne Pages（`nuxt generate` → `dist` 静态托管），
> EdgeOne Pages 已支持 Node Functions / Edge Functions，可按需启用 Nuxt server 能力。
> 本文约定哪些功能放 CloudBase，哪些放 Nuxt server，避免两边重复实现。

## 一句话原则

**身份与钱（auth、钱包、订单、支付回调）留在 CloudBase；
页面与展示层的轻量服务（SEO、代理、缓存、表单）放 Nuxt server。**

秘密边界保持单一：CloudBase 的管理密钥、支付私钥（微信商户私钥、App Store 私钥）
只存在于 CloudBase 云函数环境变量中，**不要**下发到 EdgeOne。

## 留在 CloudBase 的功能（现状保持）

| 功能                       | 载体                                                         | 原因                                                                         |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 登录 / OAuth / 绑定 / 解绑 | Web SDK（纯浏览器）                                          | CloudBase Auth 是身份源，token 由 SDK 管理在 localStorage，不需要自建 server |
| 账号 / 钱包 / 会员 API     | `cloudfunctions/account-api`                                 | 需校验 CloudBase access token + 同地域低延迟读写 NoSQL                       |
| 微信支付下单 / 回调        | `cloudfunctions/wxpay-order`、`cloudfunctions/wxpay-notify`  | 商户私钥隔离；回调 URL 已配置在微信商户平台                                  |
| Apple IAP 下单 / 通知      | `cloudfunctions/iap-order`、`cloudfunctions/appstore-notify` | App Store Server API 密钥隔离；通知 URL 已配置在 App Store Connect           |
| 定时任务（对账等）         | CloudBase 云函数定时触发器                                   | 离订单数据近，失败可重试                                                     |

## 适合放 Nuxt server（EdgeOne）的功能（按需启用）

| 功能                    | 形态                            | 收益                                                                                                                                                                                    |
| ----------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub API 代理         | `server/api/github/**`          | 当前 `GitHubRepoInput` 仅用匿名 API 校验公开仓库是否存在（限流 60 req/h/IP）；若需展示 stars / 最近提交或校验私有仓库，再在 server 侧用 GitHub App token + 缓存，勿回退到代理用户 token |
| 公开用户主页 SSR        | `server/api/profile` + `/u`     | SEO / 分享 OG；经 account-api HTTP 访问代理 getProfile（已实现 2026-06）                                                                                                                |
| OG 分享图生成           | `server/routes/og/**`           | 动态生成博客 / 应用分享图                                                                                                                                                               |
| sitemap / RSS / robots  | server route 或 generate 期产出 | SEO；纯静态也可在 generate 时生成                                                                                                                                                       |
| 轻量无状态接口          | `server/api/**`                 | 联系表单、健康检查、webhook 接收等，不碰 CloudBase 凭据                                                                                                                                 |
| 安全 header / 重定向    | Nitro routeRules / middleware   | 已用 routeRules 配置缓存 header，同处维护                                                                                                                                               |
| （远期）文档 / 博客 SSR | Nuxt SSR / ISR                  | 当前 `ssr: false`；如要做再整体评估，不必为上面几项开启 SSR                                                                                                                             |

## 判定规则（新功能往哪放）

1. 要读写 CloudBase 数据库 / 校验登录态？ → CloudBase 云函数。
2. 是第三方服务的回调（支付、商店、平台通知）？ → CloudBase 云函数（HTTP 触发）。
3. 只是页面展示、SEO、公开数据代理、表单收集？ → Nuxt server route（EdgeOne）。
4. 两边都能做？ → 看密钥在哪边：密钥在哪，逻辑就在哪。

## 注意事项

- **目录名冲突（已处理）**：EdgeOne Pages 约定用仓库根目录 `functions/` 作为
  Edge Functions 目录，与 CloudBase 云函数目录撞名。CloudBase 云函数目录已改名为
  `cloudfunctions/`（2026-06），即使以后改用 EdgeOne 仓库直连构建也不会被误识别。
- 启用 Nuxt server routes 后，部署产物从纯静态 `dist/` 变为 Nitro 输出，
  EdgeOne Pages 需按 Nuxt 框架预设部署（构建命令 `pnpm build`），不再是 `pnpm generate`。
- **公开用户主页 `/u/[login]` 已启用 SSR**（2026-06，为 SEO / 分享 OG）：资料经 `server/api/profile`
  代理 `account-api` 的 **HTTP 访问服务**（公开 action `getProfile`，无登录态、不下发任何 CloudBase 密钥）。
  生效三步：① EdgeOne 构建命令切 `pnpm build`（Nitro；首页等 `prerender` 页仍构建期静态，性能不受影响）；
  ② 控制台给 `account-api` 绑定 HTTP 访问路径；③ 填环境变量 `NUXT_ACCOUNT_API_HTTP_URL`。
  未配置时 `/u` 自动退化为客户端渲染（功能正常，仅无 SSR SEO），不阻断现有静态部署。
- OAuth 回调（`/auth/callback`）是纯客户端逻辑（CloudBase Web SDK），与 server 能力无关，
  不要迁到 server 端。
- 跨站 SSO 桥接页（`/auth/sso`）同样是纯客户端逻辑：读本站 localStorage 的 session 后
  用 `postMessage` 发给白名单子站，不涉及服务端。详见 [跨站 SSO 接入指南](./sso-integration.md)。
