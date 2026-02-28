---
name: pricing-i18n-static
overview: 三项修改：1) /pricing 页面内容改为中文并使用人民币价格；2) 临时禁用国际化，默认中文；3) 站点关闭 SSR，改为纯静态站点托管模式。
todos:
  - id: disable-i18n-and-ssr
    content: "修改 nuxt.config.ts：移除 i18n 模块及配置块，设置 ssr: false，清理 routeRules/nitro/vite.ssr 相关配置"
    status: completed
  - id: replace-i18n-calls
    content: 移除 app.vue、AppHeader.vue、UserMenu.vue 中的 useI18n 调用，替换为中文硬编码；AppHeader 中移除 LanguageSwitcher 引用
    status: completed
    dependencies:
      - disable-i18n-and-ssr
  - id: localize-pricing
    content: 中文化 content/2.pricing.yml 全部内容（标题/描述/套餐/FAQ/价格改¥），修复 content.config.ts schema，更新 pricing.vue 和 payment.ts 中文文案
    status: completed
    dependencies:
      - disable-i18n-and-ssr
  - id: localize-navigation
    content: 中文化 useNavigation.ts 中的 links 标签（文档/会员/博客/日志）
    status: completed
    dependencies:
      - disable-i18n-and-ssr
---

## 用户需求

将 www.yunle.fun 站点进行以下三项调整：

1. /pricing 页面内容全部改为中文，价格从美元改为人民币
2. 临时禁用国际化（i18n），站点默认使用中文，保留 i18n 包以便未来重新启用
3. 关闭 SSR，确保站点可作为纯静态站点托管（使用 `nuxt generate` 预渲染模式）

## 产品概述

对现有 Nuxt 站点进行本地化和部署模式调整。将 pricing 页面的英文内容（标题、描述、套餐名称、价格、功能列表、FAQ 等）全部替换为中文，价格从  `美元改为 `¥` 人民币。同时禁用 `@nuxtjs/i18n` 模块，将所有使用 `$t()` / `useI18n()` 的组件改为直接使用中文字符串。最后关闭 SSR，改为静态生成模式。

## 核心功能

- pricing 页面全中文化：标题、描述、套餐名称/描述/价格/功能列表、FAQ 问答、合作伙伴标题、SEO 元信息、月/年切换标签、计费周期文案
- 套餐价格改为人民币：Basic ¥9.9/¥99.9、Standard ¥19.9/¥199.9、Premium ¥29.9/¥299.9
- 套餐名称中文化（PLAN_NAMES 映射更新）
- 禁用 i18n 模块：从 nuxt.config.ts modules 中移除，删除 i18n 配置块
- 替换 4 个文件中的 `$t()` / `useI18n()` 调用为中文硬编码字符串
- 移除 LanguageSwitcher 组件及其在 AppHeader 中的引用
- 关闭 SSR（`ssr: false`），清理 routeRules 中的 ssr/prerender 配置，移除 vite.ssr.external 配置
- useNavigation 中的英文 links 标签改为中文

## 技术栈

- 框架：Nuxt 3 + Vue 3 + TypeScript
- UI 库：@nuxt/ui
- 内容管理：@nuxt/content（YAML 数据源）
- 样式：Tailwind CSS
- 包管理：pnpm

## 实现方案

**策略**：三步走 —— 先禁用 i18n 并清理相关代码，再中文化 pricing 页面内容，最后关闭 SSR 切换为静态生成模式。

**关键技术决策**：

1. **i18n 禁用方式**：从 `nuxt.config.ts` 的 `modules` 数组中移除 `@nuxtjs/i18n`，同时删除整个 `i18n` 配置块。保留 `@nuxtjs/i18n` 在 `devDependencies` 中以及 `i18n/locales` 目录不删除，便于将来重新启用。`app.vue` 中的 `useI18n()` 和 locale 相关逻辑改为硬编码 `zh-CN`，UApp 的 locale prop 直接使用 `zh_cn`。

2. **$t() 替换策略**：涉及 4 个文件（app.vue、AppHeader.vue、UserMenu.vue、LanguageSwitcher.vue），其中 LanguageSwitcher.vue 整个组件不再使用（从 AppHeader 模板中移除引用即可，文件保留）。其余文件中将 `t('key')` 替换为对应的 `zh-CN.json` 中的中文值。

3. **SSR 关闭方案**：设置 `ssr: false`，移除 `routeRules` 中所有 `ssr: false` 和 `prerender: true` 的条目（因为全局已关闭 SSR，且改用 `nuxt generate` 生成静态文件时不再需要逐路由配置）。移除 `nitro.prerender` 配置块。移除 `vite.ssr.external` 配置（不再有 SSR 构建）。保留 `experimental.payloadExtraction`。

4. **content.config.ts schema 修复**：当前 pricing schema 中有 `billing_period` 和 `billing_cycle` 必填字段，但 YAML 中未提供，需移除或改为 optional，避免构建报错。同时 `planId` 字段在 schema 中未定义但 YAML 中存在，需补充到 schema。

## 实现注意事项

- `app.vue` 中 `htmlAttrs.lang` 改为硬编码 `'zh-CN'`，`UApp` 的 `:locale` 直接传 `zh_cn`，不再引入 `en` locale
- `useNavigation.ts` 中的 `links` 标签从英文改为中文（文档、会员、博客、日志）
- `PLAN_NAMES` 从英文 `Basic/Standard/Premium` 改为中文 `基础版/标准版/高级版`，保持与 pricing 页面一致
- 保留 `@nuxtjs/i18n` 包在 `devDependencies`，保留 `i18n/` 目录，仅从 modules 和配置中移除
- 关闭 SSR 后 `import.meta.server` 在 `usePayment.ts` 中仍然安全（Nuxt 会在客户端构建时将其替换为 `false`）

## 架构设计

本次修改不涉及架构变更，仅为配置调整和内容本地化。修改链路清晰：

```
nuxt.config.ts (配置变更)
  ├── 移除 @nuxtjs/i18n 模块
  ├── 删除 i18n 配置块
  ├── ssr: false
  ├── 清理 routeRules / nitro.prerender / vite.ssr.external
  │
content/2.pricing.yml (内容中文化)
  └── 标题、描述、套餐、FAQ 全部改中文，价格改 ¥
  │
content.config.ts (schema 修复)
  └── 移除/调整 billing_period、billing_cycle 字段
  │
app/app.vue (移除 i18n 依赖)
app/components/AppHeader.vue (移除 i18n，移除 LanguageSwitcher)
app/components/UserMenu.vue (移除 i18n)
app/pages/pricing.vue (中文化 tabs/billing-cycle)
app/composables/useNavigation.ts (links 中文化)
app/types/payment.ts (PLAN_NAMES 中文化)
```

## 目录结构

```
project-root/
├── nuxt.config.ts                        # [MODIFY] 移除 i18n 模块和配置块，ssr 改为 false，清理 routeRules/nitro/vite.ssr 配置
├── content.config.ts                     # [MODIFY] 修复 pricing schema：移除 billing_period/billing_cycle 必填字段，补充 planId/scale 可选字段
├── content/
│   └── 2.pricing.yml                     # [MODIFY] 全部内容中文化，价格改为 ¥ 人民币
├── app/
│   ├── app.vue                           # [MODIFY] 移除 useI18n()，htmlAttrs.lang 硬编码 'zh-CN'，UApp locale 直接用 zh_cn
│   ├── components/
│   │   ├── AppHeader.vue                 # [MODIFY] 移除 useI18n()，导航 items label 改中文硬编码，模板中移除 LanguageSwitcher 组件引用
│   │   └── UserMenu.vue                  # [MODIFY] 移除 useI18n()，所有 t() 调用替换为对应中文字符串
│   ├── composables/
│   │   └── useNavigation.ts              # [MODIFY] links 数组的 label 从英文改为中文
│   ├── pages/
│   │   └── pricing.vue                   # [MODIFY] 月/年切换 tabs label 改中文，billing-cycle 文案改中文
│   └── types/
│       └── payment.ts                    # [MODIFY] PLAN_NAMES 从英文改为中文（基础版/标准版/高级版）
```