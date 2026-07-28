# [www.yunle.fun](https://www.yunle.fun)

云乐坊 - 开发者工具与资源平台

## 功能特性

- **首页** - 展示平台概览与由 SSO Client Registry 驱动的统一账号应用云图
- **开发者平台** - 提供完整的开发工具链与云服务支持
- **定价页面** - 会员订阅与微信支付集成
- **文档中心** - 完整的 API 文档与开发指南
- **博客** - 技术文章与更新日志
- **用户系统** - GitHub OAuth 登录认证
- **应用管理** - GitHub 仓库集成与应用创建

## 技术栈

- **前端框架**: Nuxt 4 + Vue 3
- **UI 组件**: Nuxt UI 4
- **样式方案**: Tailwind CSS
- **国际化**: @nuxtjs/i18n
- **云服务**: 腾讯云 CloudBase (认证、数据库、云函数)

## Quick Start

[![Nuxt UI](https://img.shields.io/badge/Made%20with-Nuxt%20UI-00DC82?logo=nuxt&labelColor=020420)](https://ui.nuxt.com)

Based on [nuxt-ui-templates/saas](https://github.com/nuxt-ui-templates/saas).

## Development Server

Start the development server on `http://localhost:3000`:

```bash
pnpm dev
```

## Production

Build the application for production:

```bash
pnpm build
```

构建结束后会校验预渲染的客户端路由壳是否包含 Nuxt 模块入口；校验脚本兼容本地/EdgeOne 的
`.output/public`、EdgeOne 打包目录 `.edgeone/assets` 和 Cloudflare Pages 的 `dist`。

Locally preview production build:

```bash
pnpm preview
```

## 部署

项目有**两条相互独立**的发布线：

### 前端（EdgeOne Pages）

前端由腾讯 [EdgeOne Pages](https://edgeone.ai/) 托管，**已接入 Git 自动部署**：推送到 `main` 分支即自动触发构建并发布，无需手动操作。

> 🔁 **仓库使用 `nuxt build`（Nitro SSR，preset `node-server`，`ssr:true` hybrid）**，线上 EdgeOne 已启用 Nuxt 服务端运行时并托管 `.output/server`。发布前必须确认 `NUXT_SESSION_PASSWORD` 等服务端环境变量完整；共享领取功能还要求 `NUXT_REWARD_CLAIM_RATE_TICKET_SECRET` 与 `account-api.REWARD_CLAIM_RATE_TICKET_SECRET` 完全一致。详见 [docs/cookie-session-migration.md](docs/cookie-session-migration.md)。

Cloudflare Pages 连接同一 `main` 分支，作为 `cloudflare-pages` preset 的兼容性镜像与第二条构建检查；正式域名和生产流量仍以 EdgeOne Pages 为准。

> ⚠️ GitHub Actions 不负责网站部署——`ci.yml` 仅跑 lint / typecheck / test，`release.yml` 仅在打 `v*` tag 时生成 Release changelog。

### 云函数（CloudBase）

支付、账户和授权相关云函数部署在腾讯云 CloudBase，**不随前端自动发布**，改动后需单独部署：

```bash
node scripts/deploy-function.mjs <function-name>
```

该脚本会先加载 `.env` / `.env.local`，并校验 `cloudbaserc.json` 中该函数引用的全部
`{{env.*}}` 占位符；缺少任何变量时会在构建和部署前终止，避免把线上配置覆盖为空。

`sso-ticket` 和 `desktop-auth` 依赖工作区内的 `@yunlefun/authorization-core`。修改 Client Registry
或授权核心后，必须先生成包含 vendored core 的函数产物，再以“仅更新函数代码”的方式分别发布两个产物；
不能直接上传 `cloudfunctions/<name>` 源目录：

```bash
node scripts/build-cloud-function.mjs sso-ticket desktop-auth
```

Client Registry 的存储、首页读取和同步发布约定见
[`docs/sso-integration.md`](./docs/sso-integration.md#registry-存储与发布模型)。
环境变量配置、数据库索引、平台证书轮换等详见 [`cloudfunctions/README.md`](./cloudfunctions/README.md)。
