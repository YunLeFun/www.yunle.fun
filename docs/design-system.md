# 云乐坊设计体系 —— 梦幻晴空（天气之子）

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

| 变量                | 字体栈                                                                | 用途          |
| ------------------- | --------------------------------------------------------------------- | ------------- |
| `--ylf-font-dreamy` | `'STKaiti','KaiTi','Kaiti SC','Songti SC',ui-serif,serif`             | 标志性大标题  |
| `--ylf-font-round`  | `ui-rounded,'PingFang SC','Hiragino Sans GB',ui-sans-serif,system-ui` | 圆润拉丁/数字 |

- 全站使用系统字体栈，不依赖第三方字体服务；避免中文字体分片占用首屏带宽，也不会发生 Web Font 切换闪动。
- 大标题用工具类 `.ylf-dreamy-display`（= `--ylf-font-dreamy` + 字重 400 + 微字距）。
- 若未来恢复品牌 Web Font，应采用自托管、按实际字形子集化，并重新通过 Lighthouse 性能预算。

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
| `.ylf-dreamy-display`                          | 站酷小薇大标题字体                                                |
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
