---
name: add-app-website-links
overview: 为应用添加"网页链接"和"备用链接（可选）"两个字段，涉及类型定义、创建页、编辑页和详情页的同步修改。
todos:
  - id: update-types-and-composable
    content: 更新 app.ts 类型定义新增 websiteUrl/backupUrl 字段，同步修改 useApps.ts 的 createApp 写入逻辑
    status: completed
  - id: update-create-and-edit-forms
    content: 在 new.vue 和 edit.vue 表单中新增网页链接和备用链接输入框，补充表单数据和提交逻辑
    status: completed
    dependencies:
      - update-types-and-composable
  - id: update-detail-page
    content: 在 [slug].vue 详情页应用信息区域新增网页链接和备用链接的条件展示行
    status: completed
    dependencies:
      - update-types-and-composable
---

## 用户需求

在创建应用页面 (`/apps/new`) 中增加两个 URL 字段的设置能力。

## 产品概述

为应用管理流程新增"网页链接"和"备用链接"两个字段，贯穿创建、编辑、详情展示的完整生命周期。

## 核心功能

1. **创建应用时设置网页链接** - 在创建表单中新增"网页链接"输入框，用于填写应用的官方网站地址
2. **创建应用时设置备用链接（可选）** - 在创建表单中新增"备用链接"输入框，作为备选访问地址，标注为可选
3. **编辑应用时修改链接** - 编辑页面同步支持这两个字段的回填与修改
4. **详情页展示链接** - 应用详情页中展示网页链接和备用链接（存在时），点击可跳转外部页面

## 技术栈

- 框架：Nuxt 3 + Vue 3 (Composition API + `<script setup>`)
- UI 组件库：Nuxt UI (UInput, UFormField, UPageCard 等)
- 图标：Lucide Icons (项目已有 `i-lucide-globe`、`i-lucide-link`、`i-lucide-external-link` 等)
- 数据库：CloudBase NoSQL (`apps` 集合)
- 类型系统：TypeScript

## 实现方案

在现有应用 CRUD 流程中，为 `AppRecord` 和 `CreateAppForm` 类型新增 `websiteUrl` 和 `backupUrl` 两个可选字段，然后在创建页、编辑页的表单中添加对应输入控件，在详情页中添加展示行。`useApps` composable 中的 `createApp` 方法需要同步写入这两个新字段。由于字段是可选的，不需要做数据迁移，已有数据自然兼容。

### 关键技术决策

- **字段为可选类型 (`string?`)**：两个链接字段都不是必填项，备用链接明确标注为可选；网页链接虽然用户可能期望必填，但参照项目中 `githubRepo` 的模式也设为可选更灵活
- **URL 格式不做严格校验**：与项目中 `githubRepo` 的处理方式保持一致，不在前端做正则校验，保持简洁；用户可输入任意 URL
- **表单位置**：新增字段放在 GitHub 仓库字段之后、公开开关之前，符合逻辑分组（基本信息 -> 链接/仓库 -> 设置）

## 实现注意事项

- `useApps.ts` 中 `createApp` 方法直接透传表单字段到数据库，新增字段需要在写入对象中补充
- 编辑页数据回填时需处理字段可能不存在的情况（`data.websiteUrl || ''`）
- 详情页使用 `v-if` 条件渲染，仅在字段有值时展示对应行
- 链接展示行复用详情页已有的 GitHub 仓库行的布局模式（图标 + 标签 + 可点击链接 + 外链图标）

## 架构设计

变更范围非常小，不涉及架构调整。仅在现有数据流中透传两个新字段：

表单输入 -> `CreateAppForm` 类型 -> `useApps.createApp()` / `updateApp()` -> CloudBase NoSQL `apps` 集合 -> `AppRecord` 类型 -> 详情页展示

## 目录结构

```
app/
├── types/
│   └── app.ts                    # [MODIFY] AppRecord 和 CreateAppForm 新增 websiteUrl、backupUrl 字段
├── composables/
│   └── useApps.ts                # [MODIFY] createApp 方法写入对象中补充 websiteUrl、backupUrl
├── pages/apps/
│   ├── new.vue                   # [MODIFY] 表单新增网页链接和备用链接输入框，handleSubmit 传递新字段
│   ├── [slug].vue                # [MODIFY] 详情信息区域新增网页链接和备用链接展示行
│   └── [slug]/
│       └── edit.vue              # [MODIFY] 表单新增两个输入框，数据回填，提交时传递新字段
```