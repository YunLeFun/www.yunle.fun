# [www.yunle.fun](https://www.yunle.fun)

云乐坊 - 开发者工具与资源平台

## 功能特性

- **首页** - 展示平台概览与核心功能
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

Locally preview production build:

```bash
pnpm preview
```

## 部署

项目有**两条相互独立**的发布线：

### 前端（EdgeOne Pages）

前端由腾讯 [EdgeOne Pages](https://edgeone.ai/) 托管，**已接入 Git 自动部署**：推送到 `main` 分支即自动触发构建并发布，无需手动操作。

> 🔁 **仓库构建已切到 `nuxt build`（Nitro SSR，preset `node-server`，`ssr:true` hybrid）**，但**线上 EdgeOne 目前仍按静态托管、无服务端运行时**（实测 `POST /api/session/*` 返回 404）。要让 httpOnly cookie 会话 / SSR 首屏真正生效，还需在 EdgeOne 启用 Nuxt SSR serving（`@edgeone/nuxt-pages` 适配或原生识别，托管 `.output/server`）并配 `NUXT_SESSION_PASSWORD` 等 env。详见 [docs/cookie-session-migration.md](docs/cookie-session-migration.md)。

> ⚠️ GitHub Actions 不负责网站部署——`ci.yml` 仅跑 lint / typecheck / test，`release.yml` 仅在打 `v*` tag 时生成 Release changelog。

### 云函数（CloudBase）

支付 / 账户相关云函数（`wxpay-order`、`wxpay-notify`、`account-api`、`iap-order`、`appstore-notify`）部署在腾讯云 CloudBase，**不随前端自动发布**，改动后需单独部署：

```bash
tcb functions deploy <function-name> --envId yunlefun-8g7ybcxc7345c490
```

环境变量配置、数据库索引、平台证书轮换等详见 [`cloudfunctions/README.md`](./cloudfunctions/README.md)。
