# 云乐坊

[![CI](https://github.com/YunLeFun/www.yunle.fun/actions/workflows/ci.yml/badge.svg)](https://github.com/YunLeFun/www.yunle.fun/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

云乐坊是面向独立开发者的工具与资源平台。本仓库包含 [www.yunle.fun](https://www.yunle.fun) 的 Nuxt 应用、CloudBase 云函数，以及跨应用统一登录使用的授权核心。

## 功能

- 平台首页与由 SSO Client Registry 驱动的应用导航
- GitHub OAuth、统一账号和跨站 SSO
- 开发者平台、应用管理、文档和博客
- 会员、微信支付、App Store 内购与奖励领取
- 测试身份、事务邮件和后台运维能力
- 中文、英文与日文界面

公开展示页面优先使用可缓存和预渲染能力；登录、账户、支付等功能使用 Nuxt 服务端运行时和 CloudBase 私有服务。

## 技术架构

- Nuxt 4、Vue 3、Nuxt UI 4 和 Tailwind CSS
- pnpm workspace，内部授权包位于 `packages/authorization-core`
- 腾讯云 CloudBase：认证、数据库和云函数
- EdgeOne Pages：正式网站；Cloudflare Pages：兼容性构建与预览
- Vitest、ESLint 和 Nuxt TypeScript 检查

## 本地开发

### 环境要求

- Node.js 22 或更高版本
- pnpm 11（仓库通过 `packageManager` 固定版本）

### 启动

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

应用默认运行在 `http://localhost:3000`。只修改公开页面时，可保留大多数可选服务变量为空；账号、支付、邮件或云函数开发必须使用自己的 development 环境和密钥。不要把真实凭据写入仓库。

常用命令：

| 命令                            | 用途                           |
| ------------------------------- | ------------------------------ |
| `pnpm dev`                      | 启动本地 Nuxt 开发服务器       |
| `pnpm build`                    | 构建生产应用并校验客户端路由壳 |
| `pnpm preview`                  | 本地预览生产构建               |
| `pnpm lint`                     | 运行 ESLint                    |
| `pnpm typecheck`                | 运行 Nuxt TypeScript 检查      |
| `pnpm test`                     | 运行完整 Vitest 测试           |
| `pnpm build:authorization-core` | 构建共享授权核心               |

所有可配置项及用途见 [.env.example](./.env.example)。只有 `NUXT_PUBLIC_*` 变量可以进入浏览器；其他变量必须只保存在本地忽略文件或部署平台的 Secret 中。

## 目录结构

| 目录                           | 内容                              |
| ------------------------------ | --------------------------------- |
| `app/`                         | Nuxt 页面、组件、状态和客户端逻辑 |
| `server/`                      | Nitro 服务端 API 与中间件         |
| `cloudfunctions/`              | CloudBase 云函数源码              |
| `packages/authorization-core/` | Registry、签名和授权共享实现      |
| `content/`                     | 文档与博客内容                    |
| `docs/`                        | 架构、集成、迁移和运维说明        |
| `tests/`                       | 单元、集成和工作流回归测试        |

## SSO Client Registry

应用展示、允许的 Origin、回调地址和接入类型统一由 Client Registry 管理。开发环境可以自动生成、校验、合并并部署 Registry；production 发布必须经过审批和显式环境门禁。

不要手工修改 `packages/authorization-core/src/generated/*-registry.json` 或 `*-release.json`。接入方式、静态页面适配器和发布模型见 [SSO 集成指南](./docs/sso-integration.md)。

## 部署

### 网站

`main` 分支由 EdgeOne Pages 的 Git 集成部署到正式站点。Cloudflare Pages 连接同一分支，用作 `cloudflare-pages` preset 的构建检查和预览；正式域名与生产流量仍以 EdgeOne Pages 为准。

仓库使用 `nuxt build` 和 Nitro `node-server` hybrid 运行时。上线前必须在平台配置服务端变量，特别是 `NUXT_SESSION_PASSWORD`。会话迁移与共享领取密钥要求见 [Cookie Session 迁移说明](./docs/cookie-session-migration.md)。

### CloudBase 云函数

普通云函数不会随网站自动发布。部署脚本会先检查目标环境和 `{{env.*}}` 占位符，缺少任何变量都会在构建前失败：

```bash
node scripts/deploy-function.mjs <function-name>
```

`sso-registry-admin`、`sso-ticket` 和 `desktop-auth` 依赖 vendored `@yunlefun/authorization-core`，必须同步构建和发布：

```bash
node scripts/build-cloud-function.mjs sso-registry-admin sso-ticket desktop-auth
```

完整的环境变量、数据库索引、密钥轮换和函数部署说明见 [cloudfunctions/README.md](./cloudfunctions/README.md)。任何 production 变更都应先在 development 完成 smoke，并保留显式审批。

## 包发布

根项目和两个 workspace 包当前均为 `private: true`。开源源码不依赖 npm 发布；只有未来需要让其他仓库独立安装稳定 SDK 时，才应单独设计公开包、版本兼容策略和 npm provenance 发布链路。

## 参与贡献

提交问题或代码前请阅读 [贡献指南](./CONTRIBUTING.md) 与 [行为准则](./CODE_OF_CONDUCT.md)。安全漏洞请按 [安全策略](./SECURITY.md) 私下报告，不要创建公开 Issue。

## 许可证

[MIT](./LICENSE) © YunLeFun contributors
