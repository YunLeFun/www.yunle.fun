# 服务端职责划分：CloudBase vs Nuxt Server（EdgeOne Pages）

> 站点已部署在 EdgeOne Pages，并通过 `nuxt build` 托管 Nitro `node-server`
> 产物；Nuxt server routes / SSR 已启用。
> 本文约定哪些功能放 CloudBase，哪些放 Nuxt server，避免两边重复实现。

## 一句话原则

**身份与钱（auth、钱包、订单、支付回调）留在 CloudBase；
页面与展示层的轻量服务（SEO、代理、缓存、表单）放 Nuxt server。**

秘密边界保持单一：CloudBase 的管理密钥、支付私钥（微信商户私钥、App Store 私钥）
只存在于 CloudBase 云函数环境变量中，**不要**下发到 EdgeOne。

## 存储边界

- CloudBase 默认桶只承载头像等公开资产，权限采用所有用户可读、管理员写。
  用户资料持久化 SDK 返回的 `cloud://` 文件 ID；Web 与 App 通过明确配置的
  `NUXT_PUBLIC_CLOUDBASE_STORAGE_PUBLIC_ORIGIN` 映射到公共 URL，不持久化或
  每次生成临时签名。
- 头像上传由 `account-api` 校验身份、类型与大小后写入 `avatars/`，浏览器不
  获得默认桶写权限。
- 用户项目、画笔库和附件等私有内容使用独立私有 COS 桶，并由服务端校验所有权
  后签发短期 STS 或下载 URL；私有内容不得写回 CloudBase 默认公开桶。

## 留在 CloudBase 的功能（现状保持）

| 功能                       | 载体                                                         | 原因                                                                         |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 登录 / OAuth / 绑定 / 解绑 | Web SDK（纯浏览器）                                          | CloudBase Auth 是身份源，token 由 SDK 管理在 localStorage，不需要自建 server |
| 账号 / 钱包 / 会员 API     | `cloudfunctions/account-api`                                 | 需校验 CloudBase access token + 同地域低延迟读写 NoSQL                       |
| 微信支付下单 / 回调        | `cloudfunctions/wxpay-order`、`cloudfunctions/wxpay-notify`  | 商户私钥隔离；回调 URL 已配置在微信商户平台                                  |
| Apple IAP 下单 / 通知      | `cloudfunctions/iap-order`、`cloudfunctions/appstore-notify` | App Store Server API 密钥隔离；通知 URL 已配置在 App Store Connect           |
| 定时任务（对账等）         | CloudBase 云函数定时触发器                                   | 离订单数据近，失败可重试                                                     |

## 适合放 Nuxt server（EdgeOne）的功能

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

## 已规划：应用反馈与平台支持

应用反馈和平台工单尚未实现。其服务端职责按以下边界规划：

| 能力                               | 规划载体                               | 原因                                           |
| ---------------------------------- | -------------------------------------- | ---------------------------------------------- |
| 事项、回复、状态、授权、审计、限流 | 独立 CloudBase 云函数 `support-api`    | 需要校验登录态并读写私密 NoSQL 数据            |
| 私有附件与短时下载链接             | CloudBase 私有存储 + `support-api`     | 下载权限必须和事项权限一致                     |
| 用户提交、回复和“我的事项”页面     | `support.yunle.fun`                    | 支持中心作为统一用户门户                       |
| 应用详情入口、开发者处理后台       | `www.yunle.fun`                        | 应用上下文和所有权已在主站                     |
| 游戏与大厅的反馈入口               | `play.yunle.fun`                       | 只提供目标应用和运行场景，不另建反馈系统       |
| 站内提醒                           | 复用 `user_notifications`              | 默认不通过邮件发送普通回复通知                 |
| GitHub Issue 创建或关联            | CloudBase `support-api` + `github-api` | 凭据不下发客户端，且只发送人工确认后的公开摘要 |

共用底层事项引擎不代表应用开发者、平台客服和治理人员共用数据权限。具体决策见
[应用反馈与平台支持架构决策](./feedback-support-decision.md)，权限、流程和数据基线见
[应用反馈与平台支持系统规格](./feedback-support-system.md)。

上表的 GitHub 写入与前文的 GitHub API 代理不冲突：Nuxt 代理只适合公开展示、缓存和无私密事项上下文的校验；反馈外发的允许列表、审计和 GitHub App 写权限均留在 CloudBase。

## 注意事项

- **目录名冲突（已处理）**：EdgeOne Pages 约定用仓库根目录 `functions/` 作为
  Edge Functions 目录，与 CloudBase 云函数目录撞名。CloudBase 云函数目录已改名为
  `cloudfunctions/`（2026-06），即使以后改用 EdgeOne 仓库直连构建也不会被误识别。
- Nuxt server routes 的部署产物是 Nitro 输出；EdgeOne Pages 必须保持 Nuxt
  框架预设与 `pnpm build`，不得回退到 `pnpm generate` 的纯静态产物。
- **公开用户主页 `/u/[login]` 已启用 SSR**（2026-06，为 SEO / 分享 OG）：资料经 `server/api/profile`
  代理 `account-api` 的 **HTTP 访问服务**（公开 action `getProfile`，无登录态、不下发任何 CloudBase 密钥）。
  生效三步：① EdgeOne 构建命令切 `pnpm build`（Nitro；首页等 `prerender` 页仍构建期静态，性能不受影响）；
  ② 控制台给 `account-api` 绑定 HTTP 访问路径；③ 生产默认使用只读入口
  `https://api.yunle.fun/account-api`，本地 / 预发通过 `NUXT_ACCOUNT_API_HTTP_URL` 覆盖到对应环境。
  `/u/[identifier]` 统一由服务端按 `login → userId` 解析；公开资料不依赖浏览器登录态。
  代理只有在上游明确返回空资料时才返回 404，配置缺失 / 上游故障分别返回 503 / 502，
  页面不得把临时故障展示成“用户不存在”。
- OAuth 回调（`/auth/callback`）是纯客户端逻辑（CloudBase Web SDK），与 server 能力无关，
  不要迁到 server 端。
- 跨站 SSO 桥接页（`/auth/sso`）只验证当前 CloudBase session，并通过服务端签发绑定
  origin/return URL/nonce 的一次性授权码；主站 session 不再通过 `postMessage` 发送。
  授权码由 `sso-ticket` 事务性消费。详见 [跨站 SSO 接入指南](./sso-integration.md)。
