# 移除 @nuxt/content 说明

> 状态：移除中 / 已移除（2026-06）。本文记录**移除原因、替代方案，以及未来可切换回来的条件**。

## 为什么移除

www.yunle.fun 正在做 [httpOnly cookie 会话迁移](./cookie-session-migration.md)，需要 **Nitro SSR 服务端运行时**（`/api/session/*` 端点种 / 读 sealed cookie、SSR 正确首屏灭闪）。

但 EdgeOne Pages 托管构建自动套用的 `@edgeone/nuxt-pages` 适配器，其 `onPreBuild` **硬编码**了一条规则：

```js
if (await checkModules(ctx, "@nuxt/content")) {
  console.warn("⚠️ @nuxt/content detected, switching to static deployment.")
  recordOldEdgeOneConfig = useStaticBuild(projectRoot)
}
```

即**只要检测到 `@nuxt/content` 就强制退回纯静态部署**——没有服务端运行时，`/api/*` 全部 404（实测线上 `/api/session/*`、`/api/profile` 均 404），cookie 会话彻底跑不起来。

根因：`@nuxt/content` v3 把内容存进 SQL 数据库，默认后端是原生模块 `better-sqlite3`，而 **serverless / 边缘运行时跑不了 file-based SQLite**（每请求全新实例、FS 只读不持久，Nuxt Content 官方明确）。适配器为避免"content 站塞进边缘函数炸"，干脆替你退静态。

权衡后——内容量很小（~13 个 markdown 共 ~800 行 + 8 个 YAML 落地页数据）——选择**移除 `@nuxt/content`**，一刀消除 SQL DB / better-sqlite3 / 适配器退静态触发，让 www 全站 SSR 直接通：**不用外部 DB（Turso/PG）、不碰适配器、不写边缘函数双实现**。

## 替代方案（移除后怎么渲染内容）

| 原 `@nuxt/content` 用法 | 替代 |
|---|---|
| YAML 落地页（index / pricing / developer / apps / blog 元 / changelog 元），`queryCollection(...).first()` | `app/data/*.ts` 数据模块，直接 `import`；原 zod schema → TS 类型 |
| Markdown 正文（docs / blog / changelog / 法律页），`<ContentRenderer>` | `@nuxtjs/mdc`（Content 底层就是它）：继续写 `.md`、保留 MDC 组件语法，`parseMarkdown` + `<MDCRenderer>` 渲染，无 SQL |
| docs 导航 `queryCollectionNavigation` | 构建期按 `content/` 文件结构 + `.navigation.yml` 生成的导航数据 |
| docs 搜索 `queryCollectionSearchSections` | 构建期抽取标题 / 正文索引 + 客户端 `minisearch` 模糊搜索 |

`.md` 源文件仍放在 `content/`，写作体验基本不变（少了 collection schema 校验与 Studio 可视化编辑）。

## 未来什么时候可以切回来

任一条件成熟即可重新评估：

1. **EdgeOne 支持 `@nuxt/content` + SSR 共存**（适配器去掉硬编码退静态 / 提供 opt-out），或 Nuxt Content 出**无需外部 DB 的 serverless 服务端方案**（打包 dump + 服务端 WASM SQLite 等）——届时可直接装回 `@nuxt/content`。
2. **docs 长成真正的文档门户**（大量页面 / 版本化 / 重搜索）——更优解是**独立的静态 `docs.yunle.fun`**：纯静态正是 content 想要的，与 www 的 SSR 完全不冲突，全套工具链原样保留；把 `content/` 的 markdown 搬过去即可，www 这边继续保持无 content 的 SSR。

详见 [cookie-session-migration.md](./cookie-session-migration.md)（会话迁移整体方案）。
