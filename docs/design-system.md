# 主站设计实现与迁移

> 共享规范统一维护在 [YunLeFun Design](https://github.com/YunLeFun/design/blob/main/packages/guide/design-system.md)：**晴空蓝为主，高饱和纯色点缀**。Design 负责设计原则和体验规范，`@yunlefun/ui` 提供样式与变量，`@yunlefun/vue` 提供 Vue 组件；完整职责见[子包说明](https://github.com/YunLeFun/design/blob/main/packages/guide/packages.md)。
>
> 主站已接入正式发布的共享样式与 Vue 组件。迁移顺序遵循[应用迁移](https://github.com/YunLeFun/design/blob/main/packages/guide/migration.md)；下方历史视觉记录仅供业务品牌模块对照，不再作为跨应用设计规范。

## 当前接入（2026-10-02）

- `@yunlefun/ui@0.0.6` 是主题值的来源；`main.css` 先加载共享 CSS，再加载 `design-tokens.css` 的单向兼容映射。
- Nuxt UI 的 `--ui-*`、本地控件的 `--background / --primary / --card / --popover`，以及正文、产品标题、圆角均读取共享 token。映射在 `.dark` 和局部主题边界重新解析，避免弹层或嵌套主题使用旧值。
- `AppBadge` 和 `AppSeparator` 显式导入 `@yunlefun/vue@0.4.2` 的 SFC，构建依赖 Sass；分隔线支持 `spectrum`，徽标保留状态文字与辅助图形。
- `AppButton`、卡片、选择器和开关保留现有行为封装，通过同一套主题和 `tone` 约定接入；颜色类型从共享 Vue 包导入。
- 本地 Reka 抽屉、Dialog、确认弹窗、滚动弹窗、通知、下拉菜单、Popover、Select 和两种导航浮层通过 `app/components/ui/surface.ts` 共用 Design 面板与遮罩样式。面板边框使用 `--ylf-c-border`，输入边框保留 `--ylf-c-border-strong`；基础层为未指定颜色的边框提供默认值，避免 Tailwind 的 `currentColor` 变成文字色描边。业务页面无需重复补边框色。
- 主操作采用共享纯色和配套前景，装饰色收敛到六色板。旧 `--ylf-dopa-violet` 名称暂作珊瑚橙文字色别名，避免继续维护独立的紫色主题。
- `SkyScene`、SSO 云图、会员卡渐变和站酷小薇本地展示字体仍属于业务品牌模块，本次保留。Design 主分支尚未发布的组件能力不通过 Git 依赖引入。

## 组件收口（2026-10-02）

- 抽屉的方向布局使用可合并的普通工具类，调用方的宽度不再被 `data-side` 选择器覆盖。主导航在 390px 屏幕下为 351px（90vw）；抽屉、弹窗和通知的关闭按钮在手机端至少 44px。
- 禁用 / 加载中的 `AppButton` 链接移除跳转地址和 Tab 顺序，底层 `Button` 阻止点击及辅助点击；加载时输出 `aria-busy`。恢复可用状态后恢复原路由或外链。
- 主色的 soft / outline 与明确指定 tone 的按钮使用同一套 Design 颜色规则；通知的状态图标使用共享 soft / text 配对色，面板保持统一边框。
- 玻璃按钮同时适配本地与 Nuxt UI 插槽，使用共享玻璃材质、可读前景和明暗主题。登录页已移除失效的旧插槽选择器，输入框和按钮样式交由公共组件维护。
- 滚动弹窗保留手机视口两侧 16px 留白，长内容可滚至末尾；不使用 viewport 的导航内容自行应用共享面板，使用 viewport 时由外层承载，避免双重边框。

尚保留本地 Reka 行为封装（路由按钮、表单、复杂弹层），这些组件已复用 Design 令牌，后续可随共享组件正式发布逐项替换。品牌云景与会员卡仍由业务组件维护；真实账号、支付和受限账户状态的浏览器验收不包含在本轮公开页面检查中。

## 品牌入口回流（2026-10-03）

首页「浏览应用」使用 `AppButton variant="hero" size="xl"`，恢复深蓝青渐变与柔光投影，点击高度为 56px。`xl` 不再复用 `lg`；日常主按钮继续使用纯色。

同一变体、主题 token、示例和使用边界已在本地 `YunLeFun/design` 的 `YlfButton` 中补齐，等待共享包发布。主站适配层通过 `var(--ylf-hero-*, fallback)` 暂时接入相同数值；安装包含该变体的正式版本后可删除 fallback，不需要改页面调用。未切换到本地路径依赖，也未发布 npm 包。

## 依赖兼容范围

Nuxt 维持最新稳定的 4.5.2；Vue 作为显式主依赖升级至 3.5.43，Nuxt UI 升至 4.11.3，Vite 8.3.2、Vitest 5.0.3、Vue 类型工具与图标依赖同步升级。TypeScript 维持 6.0.3，因为 `vue-tsc@3.3.12` 仍读取 `typescript/lib/tsc`，TypeScript 7 不再导出该接口。H3 保持 Nuxt 兼容的 1.x 稳定版，不采用 npm `latest` 指向的 2.x RC。Node 类型沿用 24.x；pnpm 继续使用仓库约定的 11.22.0。

验证覆盖 `pnpm lint`、`pnpm typecheck`、167 个测试文件的 983 项测试，以及生产构建的 48 条预渲染路由和 14 个 EdgeOne 客户端入口。浏览器检查首页、探索、登录和博客的明暗主题，覆盖 390px、768px 与桌面宽度，并确认嵌套主题的颜色映射。需要登录的设置与钱包交互通过组件测试验证，本次未执行真实账号或支付操作。

## 历史视觉记录

以下色值描述迁移前的本地实现；通用主题以已安装的 Design 包为准，业务云景、会员卡和展示字的实现说明仍适用。

## 现有实现：梦幻晴空

> 状态：已落地（登录 / 注册 / SSO 同步页 / 会员权益 / 个人中心 / 首页 / 钱包）。
> 关联代码：`app/assets/css/main.css`（设计令牌 + 工具类）、`app/components/SkyScene.vue` · `SkyHero.vue` · `MemberPass.vue`、`nuxt.config.ts`（字体加载）。
> 设计来源：本地设计稿 `~/Downloads/YunLeFun`（`dreamy*.jsx`、`会员体系设计.html`）与 `~/Downloads/YunLeFun Design System`。

云乐坊的品牌视觉是「**天气之子 / 云之彼端 · 梦幻晴空**」方向：以**晴空蓝**为主色呼应「云」的身份，辅以**多巴胺多彩**做点缀；圆润字体、玻璃质感、柔和投影，整体轻盈、明快、治愈。

---

## 1. 设计方向

- **主色 = 晴空蓝渐变**（蓝→天青→青）。品牌渐变只用一处变量 `--ylf-gradient-brand`，明暗自动切换。
- **多彩点缀**：权益卡图标、彩虹细条等局部用多巴胺色，**点缀而不抢戏**——主色仍是晴空蓝。
- **晴空背景**：`SkyScene` 组件用 CSS 画出渐变天空 + 蓬松云朵 + 飞鸟（可选太阳/光束）。浅色=晴朗白日，深色=新海诚式黄昏。
- **质感**：圆角（卡片 24px / 药丸 999px）、磨砂玻璃、navy 偏蓝的柔和投影；诗意「晴空」文案（「推开云层，遇见晴空」）。

---

## 2. 颜色令牌

定义在 `app/assets/css/main.css` 的 `:root` / `.dark`。**始终用变量，不要硬编码十六进制。**

### 品牌渐变

| 变量                     | 浅色                                                  | 深色                                                  |
| ------------------------ | ----------------------------------------------------- | ----------------------------------------------------- |
| `--ylf-gradient-brand`   | `linear-gradient(115deg,#2563eb,#0ea5e9 55%,#0891b2)` | `linear-gradient(115deg,#3b82f6,#22d3ee 55%,#06b6d4)` |
| `--ylf-gradient-rainbow` | 青→蓝→紫→粉→橙（多彩点缀用）                          | 同色系提亮                                            |

### 多巴胺调色板（点缀色）

浅色值（深色下统一提亮，保证在深底仍鲜活）：

| 变量                | 浅色      | 变量                | 浅色      |
| ------------------- | --------- | ------------------- | --------- |
| `--ylf-dopa-cyan`   | `#0891b2` | `--ylf-dopa-amber`  | `#f59e0b` |
| `--ylf-dopa-blue`   | `#2563eb` | `--ylf-dopa-orange` | `#f97316` |
| `--ylf-dopa-violet` | `#7c3aed` | `--ylf-dopa-green`  | `#10b981` |
| `--ylf-dopa-pink`   | `#ec4899` | `--ylf-dopa-lime`   | `#65a30d` |
| `--ylf-dopa-rose`   | `#fb7185` |                     |           |

### 语义 / 中性（沿用既有）

`--ui-primary`（蓝）、`--ui-bg` / `--ui-bg-elevated` / `--ui-text(-muted/-dimmed/-highlighted)` / `--ui-border(-muted)`，以及 `--ylf-surface(-muted/-hover)`、`--ylf-ring`。这些在 `.dark` 下整组切换。

---

## 3. 字体

| 变量                | 字体栈                                                                | 用途                 |
| ------------------- | --------------------------------------------------------------------- | -------------------- |
| `--ylf-font-dreamy` | `'ZCOOL XiaoWei','PingFang SC','Songti SC',ui-serif,serif`            | 站酷小薇品牌展示标题 |
| `--ylf-font-round`  | `ui-rounded,'PingFang SC','Hiragino Sans GB',ui-sans-serif,system-ui` | 圆润拉丁/数字        |

- 站酷小薇以本地 WOFF2 字符子集加载，只用于展示标题；正文和 UI 继续使用系统字体栈。
- 使用 `font-display: swap`，字体下载期间由苹方/宋体回退，不阻塞文字渲染。
- 大标题用工具类 `.ylf-dreamy-display`（= `--ylf-font-dreamy` + 字重 400 + 微字距）。
- 新增展示标题字符时，需要同步更新 `public/fonts/zcool-xiaowei-display.woff2` 子集。

---

## 4. 组件

### `<SkyScene>` — 晴空背景

CSS 绘制的晴空，填充到 `position:relative;overflow:hidden` 的父容器。自带 `isolation:isolate`，内部云朵 z-index 不会盖到兄弟内容。

| Prop            | 类型                         | 默认          | 说明                                    |
| --------------- | ---------------------------- | ------------- | --------------------------------------- |
| `theme`         | `'light' \| 'dark'`          | `'light'`     | 白日 / 黄昏                             |
| `sun`           | `boolean`                    | `false`       | 太阳 + 丁达尔光束（默认关，背景更干净） |
| `clouds`        | `'full' \| 'mini' \| 'none'` | `'full'`      | 云朵密度                                |
| `sunX` / `sunY` | `string`                     | `80%` / `20%` | 太阳位置（`sun` 开启时）                |

### `<SkyHero>` — 晴空头图（推荐用它做页面 hero）

圆角晴空区块 = `SkyScene` + 文案侧 scrim + 内容层。**自动跟随明暗**。内容走默认插槽，自行控制内边距/栅格。

```vue
<SkyHero>
  <div class="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[1.05fr_0.95fr]">
    <div class="text-white">
      <h1 class="ylf-dreamy-display ylf-hero-shadow text-4xl sm:text-5xl">推开云层，遇见晴空</h1>
      <!-- 白字记得加 .ylf-hero-shadow 提升可读性 -->
    </div>
    <MemberPass :member="false" />
  </div>
</SkyHero>
```

| Prop    | 类型      | 默认   | 说明                               |
| ------- | --------- | ------ | ---------------------------------- |
| `scrim` | `boolean` | `true` | 文案侧压暗层（白字 hero 建议开启） |

### `<MemberPass>` — 晴空玻璃会员卡

未开通显示「推开云层 · 点亮晴空」蒙层；开通显示昵称 + 有效期。**自动跟随明暗**（`theme` 可选覆盖）。

```vue
<MemberPass :member="isMember" :name="memberName" :expire="memberExpire" />
```

| Prop     | 类型                | 默认         | 说明                       |
| -------- | ------------------- | ------------ | -------------------------- |
| `member` | `boolean`           | `false`      | 是否已开通                 |
| `name`   | `string`            | `'晴空旅人'` | 会员昵称                   |
| `expire` | `string`            | `'—— / ——'`  | 有效期文案，如 `2026 / 07` |
| `theme`  | `'light' \| 'dark'` | 跟随站点     | 可选覆盖                   |

---

## 5. 工具类

定义在 `app/assets/css/main.css`，可在任意页面复用：

| 类名                                           | 用途                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `.ylf-dreamy-display`                          | 站酷小薇品牌展示标题                                              |
| `.ylf-gradient-text` / `…--rainbow` / `…--sun` | 晴空蓝 / 彩虹 / 暖阳渐变文字                                      |
| `.ylf-gradient-tile`                           | 品牌渐变实心贴片（白色前景，放 logo/重点图标）                    |
| `.ylf-dopa-tile`                               | 彩色图标贴片，通过 `style="--tile: var(--ylf-dopa-xxx)"` 注入颜色 |
| `.ylf-card`                                    | 晴空白卡（圆角 + 柔和投影），明暗自适应                           |
| `.ylf-brand-bg`                                | 晴空蓝渐变实底（大面积背景，如钱包余额卡）                        |
| `.ylf-glass` / `.ylf-glass-btn`                | 玻璃药丸 / 玻璃白字按钮（叠在晴空上）                             |
| `.ylf-brand-btn`                               | 晴空蓝渐变主 CTA（用在 `UButton` 上：`class="ylf-brand-btn"`）    |
| `.ylf-rainbow-bar`                             | 彩虹细条点缀                                                      |
| `.ylf-member-mark` / `.ylf-member-soft`        | 「云」朵会员标识 / 会员柔和底                                     |
| `.ylf-hero-shadow`                             | hero 白字文字阴影（叠在晴空上的标题/正文）                        |

彩色图标贴片示例：

```vue
<span class="ylf-dopa-tile inline-flex size-12 items-center justify-center rounded-2xl"
      :style="{ '--tile': 'var(--ylf-dopa-cyan)' }"
>
  <UIcon name="i-lucide-refresh-cw" class="size-6" />
</span>
```

---

## 6. 明暗模式

- 所有 `--ui-*` / `--ylf-*` 令牌在 `.dark` 下整组切换；用变量写样式即自动适配。
- 组件（`SkyHero` / `MemberPass`）内部用 `useColorMode()` 自动决定晴空白日/黄昏，**调用方无需传 theme**。
- 白字叠在晴空上时加 `.ylf-hero-shadow` + 文案侧 `scrim` 保证可读。

---

## 7. 约定（Do）

- 页面头图统一用 `<SkyHero>`；会员卡统一用 `<MemberPass>`；卡片优先 `.ylf-card`。
- 主 CTA 用 `.ylf-brand-btn`（晴空蓝渐变）；晴空上的次级按钮用 `.ylf-glass-btn`。
- 颜色一律用变量；多彩色仅用于点缀（图标贴片、徽标），主色保持晴空蓝。
- 第三方登录按 `ENABLED_OAUTH_PROVIDERS` 白名单展示（见 `app/utils/authProviders.ts`）。

实景示例：登录页 `app/pages/login.vue`、会员权益 `app/pages/pricing.vue`、个人中心 `app/pages/profile.vue`。
