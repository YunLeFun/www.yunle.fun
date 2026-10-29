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

## 认证页面（2026-10-29）

登录、注册与授权页使用共享中性背景、20px 卡片圆角、系统标题字体和晴空蓝主操作。来源说明只保留应用标识、真实域名、必要的来源警告和完整设备码；授权确认时再展示账号、数据用途与继续 / 切换账号 / 取消操作。

认证页保留静态淡云、小尺寸吉祥物和轻微光晕，玻璃材质用于返回按钮这类悬浮操作；表单内容保持清晰实底。吉祥物只随输入焦点转移视线，授权进行时的小飞云跟随真实状态出现，并遵循减少动态效果设置。登录方式直接切换，保留已保存的方式偏好、键盘操作与长表单滚动；未知进度复用 `YlfProgress`，状态文字使用可读屏的即时反馈。成功后直接返回目标应用，不为成功动画增加等待。

分段切换使用共享 14px 外框与 10px 内项圆角，边框和内边距形成 4px 内缩；第三方登录分隔线由两条 `AppSeparator` 与透明背景的文字组合。

每日签到和新手引导在离开认证页面后再执行，避免在授权期间增加请求或遮挡主流程。会话恢复、账号准入、客户端注册表、PKCE 和一次性授权码校验继续在原有边界执行。

信息层级参考 [Google 授权流程](https://developers.google.com/identity/oauth2/web/guides/how-user-authz-works)、[Apple 登录体验](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple/)和 [GitHub 授权确认](https://docs.github.com/en/apps/oauth-apps/using-oauth-apps/authorizing-oauth-apps)，视觉和控件由 YunLeFun Design 统一维护。

## 品牌入口回流（2026-10-03）

首页「浏览应用」使用 `AppButton variant="hero" size="xl"`，恢复深蓝青渐变与柔光投影，点击高度为 56px。`xl` 不再复用 `lg`；日常主按钮继续使用纯色。

同一变体、主题 token、示例和使用边界已在本地 `YunLeFun/design` 的 `YlfButton` 中补齐，等待共享包发布。主站适配层通过 `var(--ylf-hero-*, fallback)` 暂时接入相同数值；安装包含该变体的正式版本后可删除 fallback，不需要改页面调用。未切换到本地路径依赖，也未发布 npm 包。

## 菜单圆角与材质（2026-10-04）

`design-tokens.css` 为共享圆角尺度提供用途别名：菜单 `--ylf-radius-menu`（14px）、菜单项 `--ylf-radius-menu-item`（10px）、账户面板 `--ylf-radius-panel`（20px）、底部抽屉 `--ylf-radius-sheet`（28px）。下拉菜单、Select、Popover 与账户菜单读取同一组变量，实际数值仍由 `@yunlefun/ui` 维护。

弹层外框负责背景、边框、阴影、背景模糊和圆角裁切；`UserAccountPanel` 只负责内容与分组，不重复绘制外框。账户菜单使用 `surface.ts` 的共享面板材质，避免透明外层保留模糊、内外圆角不一致时露出背景边角。

## 社交图标与图标按钮（2026-10-04）

导航和页脚的纯图标入口统一使用 `AppButton / Button size="icon-lg"`：44×44px 点击区域、20px 图标、无文字按钮的左右内边距。图标大小由底层按钮变体统一维护，兼容 Iconify 的 `data-icon` 节点和 SVG 图标。

页脚与联系页复用 `YlfSocialIcons`。圆角使用 `--ylf-radius`（14px），链接间距使用 `--ylf-space-1`（4px），默认图标颜色使用 `text-muted-foreground`。悬停与键盘焦点使用 `design-tokens.css` 中统一维护的 `--ylf-social-*` 品牌色。品牌色在明暗模式下保持原值，背景通过 `--ylf-social-hover-tint` 使用浅色 8% / 深色 14% 的同色淡底；GitHub 按规范切换黑白版本。邮件使用主站主题色。平台色仅用于社交标志，不扩展应用语义色板。焦点环继续使用 `--ring`，动效读取 `--ylf-duration-fast / --ylf-ease-standard` 并遵循减少动态效果设置。窄屏允许换行；每个外链保留可读标签和新窗口提示。

色值来源（2026-10-04 核对）：

| 平台         | 交互颜色                        | 来源与适用范围                                                                                                                                                                                                         |
| ------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QQ           | `#1EBAFC`                       | [QQ 官方色板](https://qq.design/brand/BrandDesign/Color/)中标注的 QQ 蓝；完整标志的背景规则另见[标志规范](https://qq.design/brand/BrandDesign/Logo/)                                                                   |
| 微信         | `#07C160`                       | [微信官方品牌指引](https://wechat.design/brand/main-brand/)的核心色板                                                                                                                                                  |
| Bilibili     | `#0CB6F2`                       | [官方投资者网站](https://ir.bilibili.com/)实际使用的[蓝色 logo SVG](https://ir.bilibili.com/media/mwvbaepv/logoenblue.svg)填充色；不将其称为所有 B 站场景唯一标准色                                                    |
| GitHub       | 浅色 `#000000` / 深色 `#FFFFFF` | [GitHub 官方标志规范](https://brand.github.com/foundations/logo)允许的黑白版本                                                                                                                                         |
| Twitter 小鸟 | `#1D9BF0`                       | 官方[历史 Twitter 资源包](https://about.x.com/content/dam/about-twitter/en/brand-toolkit/downloads/twitter-logo-01282021.zip)内 `Twitter logo/SVG/Logo blue.svg` 的填充色；适用于当前保留的小鸟图形，不代表现行 X 身份 |
| 微博         | `#E6162D`                       | [Simple Icons 色值目录](https://github.com/simple-icons/simple-icons/blob/develop/data/simple-icons.json)的参考值；官方开放平台资源页当前不可用，尚未核验官方色板，不标记为官方认证色                                  |

当前图形来自 Remix Icon，此次同步的是交互颜色；完整 VI 还包含图形版本、允许的单色版本、背景、留白和尺寸要求。调整主题时不再用自行调亮、调暗后的近似值替代品牌色。

配置入口：

- 全站的图标、链接、名称和顺序：`app/config/social.ts` 中的 `socialList`。
- 全站品牌色与主题背景：`app/assets/css/design-tokens.css` 中的 `--ylf-social-*`、`--ylf-social-hover-tint`。
- 单项颜色：`SocialItem.hoverColor`，支持 HEX、RGB 或 `var(--custom-token)`。固定 HEX 会在明暗模式下保持同一色值；主题差异通过自定义 token 控制。省略时使用默认平台 token。
- 单处列表覆盖：`<YlfSocialIcons :items="customSocialList" />`；默认复用全站配置。

例如微信条目可显式设置 `hoverColor: '#07c160'`；省略时已默认使用这个色值。覆盖只影响交互颜色，固定 HEX 在明暗模式下保持一致；如需自定义主题策略，可以传入 `var(--custom-brand-color)`。

## 顶部导航节奏（2026-10-04）

共享实现已回流至 `YunLeFun/design` 的 `YlfNavigation`、`YlfNavigationLink`、`YlfNavigationTrigger`，包含中英文示例与行为测试。当前新增能力尚未发布；主站保留本地实现，待固定共享包版本升级后替换并删除相应局部样式，详见 Design 的 `packages/guide/migration.md`。

参考 [Header navigations — Untitled UI / Dribbble](https://dribbble.com/shots/17564385-Header-navigations-Untitled-UI) 的文字导航与分组留白，主站沿用共享晴空蓝和正文字体：导航文字为 14px / 500，点击区域至少 44px 高，链接之间保留 8px，品牌与站点切换入口之间保留 12px。

「官网」采用轻量文字下拉入口；桌面当前页使用蓝色文字和 16×2px 短线，悬停使用中性浅底，键盘焦点使用内收的 2px 轮廓，避免相邻链接的状态挤在一起。移动抽屉沿用浅蓝选中背景，并提供 `aria-current="page"`。颜色、圆角和动效均读取共享主题变量，减少动态效果设置通过共享时长令牌生效。

## 个人中心、内容页与插画（2026-10-18）

个人中心、设置、钱包、关注动态、个人主页、博客、更新日志、首页与会员页统一到同一套层级、圆角与动效规则。新页面直接复用下列令牌与组件，不再逐页手写字号和圆角。

### 字号与层级

`main.css` 的 `:root` 定义 `--ylf-type-*`，对应同名工具类；字号随视口平滑缩放。

| 层级     | 令牌 / 类名                                 | 范围      | 用途                                    |
| -------- | ------------------------------------------- | --------- | --------------------------------------- |
| display  | `--ylf-type-display` / `.ylf-display`       | 36 → 56px | 首页、会员页头图主标题（站酷小薇）      |
| headline | `--ylf-type-headline` / `.ylf-headline`     | 26 → 36px | 营销页的区块标题                        |
| title    | `--ylf-type-title` / `.ylf-title`           | 20 → 24px | 应用页页头标题（`SubpageHero`）         |
| section  | `--ylf-type-section` / `.ylf-section-title` | 16 → 18px | 卡片、区块标题（`AppSection`）          |
| body     | `--ylf-type-body`                           | 15px      | 正文；阅读页由 `.ylf-prose` 放大到 16px |
| caption  | `--ylf-type-caption` / `.ylf-caption`       | 12px      | 说明、时间、计数                        |

> 站酷小薇（`--ylf-font-dreamy`）是精简子集，只覆盖固定文案里的字。它只用于文案固定、已确认字形齐全的 display 主标题（首页、会员页头图）；区块标题、应用名等会变化的内容一律用圆体标题字 `--ylf-font-heading`，避免同一行混排两种字体。

### 圆角与留白

- 头图横幅 `--ylf-radius-xl`（28px），卡片与列表项容器 `--ylf-radius-lg`（20px），控件与图标块 `--ylf-radius` / `--ylf-radius-sm`。`.ylf-card` 已改为 20px，页面不再使用 `rounded-3xl`、`rounded-[2rem]`。
- 卡片内边距：手机 16px、桌面 20px；页面区块间距 24px。

### 公共组件

| 组件                  | 作用                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `SkyHero`             | 晴空头图；`clouds="full / mini / none"`。云朵是可戳的 `CuteCloud`，画在压暗层之上；内容层只有控件接收指针 |
| `SubpageHero`         | 子页面窄横幅：返回按钮 + 标题；内容页传 `:back="false"` 与 `icon`                                         |
| `AppSection`          | 标准内容卡片：`title`、`description`、`icon`、`#actions`，`rise` 控制进场序号                             |
| `CuteCloud`           | 扁平卡通云：`shape="round / long / small"`、`face`、`mood="happy"`；颜色读 `--ylf-cloud-*`                |
| `AppCountUp`          | 数字滚动，读屏只读最终值                                                                                  |
| `ContentIllustration` | 可交互插画入口（见下）                                                                                    |

### 动效

- 时长与缓动只用 `--ylf-duration-*`、`--ylf-ease-standard / spring`；全部在 `prefers-reduced-motion` 下关闭。
- 进场：`.ylf-rise` + `--i` 错开（70ms 步长）；按压：`.ylf-press`；加载：`.ylf-shimmer` 骨架，不用转圈。
- **常驻循环只放在装饰区域**（头图云朵、空状态插画、交互插画）。列表与表单只保留进场和点击反馈：更新日志最新节点呼吸 3 次后停止；会员入口的光带进场扫两次、悬停再扫一次；设置页里的云不做漂浮。
- 交互插画离开视口时暂停全部动画。
- 跨页共享元素过渡（`plugins/shared-element-transition.client.ts`）：链接写 `data-vt-link="kind"`，起点与落点都写 `data-vt="kind"`；只有点中这类链接才启动 View Transition，时长 360ms + `--ylf-ease-standard`，不支持或减少动态效果时直接跳转。现有 kind：`blog-cover`（博客卡片封面 → 文章头图）、`avatar`（个人中心头像 → 设置页横幅头像）、`page-header`（SkyHero / 帮助页页头，抽屉明信片与个人中心头图都落到这里）。

### 可交互插画

`app/components/illustration/` 下用 HTML / CSS / SVG 绘制场景，替代图库配图：

- `launch`：浮在云海里的浏览器窗口，随鼠标倾斜，点击撒六色纸屑。
- `site`：同一扇窗口的「官网」版本，文档 / 博客 / 日志标签自动轮换，点击切换。
- `apps`：手机放飞应用气球，点气球炸开，点手机多放一只。
- `studio`：山坡上的工坊，烟囱冒小云，点击亮灯。

使用方式：

- 博客、更新日志 frontmatter 写 `illustration: apps`，卡片与封面优先显示插画，`image` 继续作为分享图和兜底。
- Markdown 正文嵌入：`::content-illustration{name="studio" ratio="2 / 1"}`。
- 新场景放在 `illustration/` 下，内部用 `cqw / cqh` 排版、包在 `IllustrationFrame` 里，并在 `content/Illustration.global.vue` 的 `SCENES` 登记名字。

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
- 子集只覆盖展示字体实际渲染的字，由脚本从源码生成，测试保证不缺字（见下）。

### 展示字体子集

`public/fonts/zcool-xiaowei-display.woff2` 由 `scripts/subset-display-font.mjs` 生成，字符清单来自 `scripts/lib/display-font-text.mjs`：

- 自动扫描 `app/` 下模板里静态 class 为 `.ylf-display` / `.ylf-dreamy-display` 的元素，以及 `AppPageHero` 调用处的 `title` / `#title` 插槽，收集静态文本、插值里的字符串字面量和同文件可静态求值的 `const` / `computed`。
- 无法静态求值的插值（props、`v-for` 变量、接口或 YAML 数据）必须在 `DYNAMIC_TEXT` 声明可能渲染的字符；`EXTRA_CHARACTERS` 固定保留可打印 ASCII、`¥`、`，`、`—`。
- 用 `:class` 绑定、TS 字符串或新的 `var(--ylf-font-dreamy)` 使用展示字体会直接报错，因为这些写法无法收集文案。

`tests/styles/display-font.test.ts` 解析 woff2 的 cmap，任何展示文案缺字、或有未声明的动态插值都会失败；同时保持子集小于 100KB。改了展示标题后：

```bash
node scripts/subset-display-font.mjs --check
node scripts/subset-display-font.mjs --source path/to/ZCOOLXiaoWei-Regular.ttf
```

源字体不入库，从 [google/fonts](https://github.com/google/fonts/tree/main/ofl/zcoolxiaowei) 获取（OFL，许可证见 `public/fonts/OFL.txt`）；生成依赖 fontTools 的 `pyftsubset`，未安装时脚本会用 `uvx` 临时运行。

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

可以拿在手里把玩的会员卡，**自动跟随明暗**（`theme` 可选覆盖）：

- 指针在卡面移动时轻微倾斜，表面一道随光移动的虹彩高光（仅 `hover: hover` 的精确指针设备）。
- 已开通：轻点翻到背面「晴空通行证」，显示剩余天数进度条、会员编号与 6 项已点亮权益。
- 未开通：两团卡通云遮住卡面，悬停 / 聚焦时向两侧推开；点击发出 `unlock`，页面据此滚动到方案区。
- `prefers-reduced-motion` 下关闭倾斜、翻面与云层动画。

```vue
<MemberPass
  :member="isMember"
  :name="memberName"
  :expire="memberExpire"
  :expire-at="expireAt"
  cycle="year"
  serial="7285 0944"
  @unlock="scrollToPlans"
/>
```

| Prop          | 类型                | 默认         | 说明                         |
| ------------- | ------------------- | ------------ | ---------------------------- |
| `member`      | `boolean`           | `false`      | 是否已开通                   |
| `name`        | `string`            | `'晴空旅人'` | 会员昵称                     |
| `expire`      | `string`            | `'—— / ——'`  | 有效期文案，如 `2026 / 07`   |
| `expireAt`    | `number \| null`    | `null`       | 到期时间戳，背面计算剩余天数 |
| `cycle`       | `'month' \| 'year'` | `'month'`    | 决定剩余进度条的满格长度     |
| `serial`      | `string`            | `''`         | 背面的会员编号               |
| `theme`       | `'light' \| 'dark'` | 跟随站点     | 可选覆盖                     |
| `interactive` | `boolean`           | `true`       | 关闭后是一张不可点的静态卡片 |

会员页的方案卡、权益卡与钱包会员卡沿用同一套语言：方案卡顶部是一扇「晴空小窗」（月付清晨薄云、年付正午晴空），权益卡按 `--tile` 着色、会员态显示「已点亮」，钱包会员卡用剩余晴空进度条提示续费。

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
