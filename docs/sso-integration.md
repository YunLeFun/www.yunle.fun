# 跨站 SSO 接入指南：一套账号，多站快捷登录

> 面向：想和云乐坊共享同一套账号体系、做到「在一处登录、各站点免登」的子应用。
> 关联：[子应用接入指南：支付 / 会员 / 云币](./sub-app-integration.md)。
> 实现：npm 包 [`@yunlefun/sso`](https://github.com/YunLeFun/ylf/tree/main/packages/sso)（消费端 + 协议层）；主站桥接页 `app/pages/auth/sso.vue`。

云乐坊把登录态沉淀成了平台级能力：用户在 `www.yunle.fun` 登录一次，其他子站点（`*.yunle.fun`、
`*.yunyoujun.cn` 等）可以**静默复用**这份登录态，`uid` 全平台一致，无需各站各自登录。

## 0. 为什么需要它

CloudBase Web SDK 把登录凭证存在 **localStorage**，而 localStorage 是**按 origin 隔离**的：
`apps.yunle.fun` 读不到 `www.yunle.fun` 的登录态。哪怕用的是同一个 CloudBase env、同一套 Auth，
跨域名也不会自动共享登录。

SSO 桥接就是用来**跨 origin 安全搬运这份登录态**的：主站把 session 通过 `postMessage` 发给
被许可的子站，子站再用 `auth.setSession()` 注入到自己的 SDK——于是两边变成同一个登录用户。

## 1. 前提

和[账户能力](./sub-app-integration.md#0-前提)一致，共享登录态要求：

1. **同一 CloudBase 环境**：子应用与云乐坊跑在同一个 env（`yunlefun-8g7ybcxc7345c490`）。
2. **同一登录体系**：同一套 CloudBase Auth，用户 `uid` 全平台一致。
3. **子站 origin 在主站白名单内**：见 [§6 配置](#6-配置主站侧)。第三方域名**不要**加进白名单（见 [§5 安全模型](#5-安全模型务必读)）。

> SSO 只搬运「登录态」。登录之后要查余额 / 判会员 / 扣云币，继续看
> [子应用接入指南](./sub-app-integration.md)——`account-api` 等接口都要求登录态，SSO 正是它们的前置。

## 2. 机制总览

两个半场，缺一不可：

| 角色                   | 位置                          | 职责                                                                  |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------- |
| **桥接页（Provider）** | 主站 `www.yunle.fun/auth/sso` | 读主站 localStorage 里的 session，校验请求方后用 `postMessage` 发回去 |
| **客户端（Consumer）** | 子应用                        | 打开桥接页、校验回传消息、把 session 注入自己的 CloudBase SDK         |

> 两端共用 npm 包 [`@yunlefun/sso`](https://github.com/YunLeFun/ylf/tree/main/packages/sso)：子应用用主入口 `@yunlefun/sso`，主站桥接页用 `@yunlefun/sso/protocol`。**消息契约（`type`/`nonce`/query 字段）只在这一个包里定义**，两端 import 同一份，杜绝跨仓漂移。

```
   子应用 (apps.yunle.fun)                     主站 (www.yunle.fun)
   ──────────────────────                     ─────────────────────
   signInWithSso()
     │  ① 打开 /auth/sso?mode=&targetOrigin=&nonce=
     │      （silent=隐藏 iframe / interactive=弹窗）
     ├───────────────────────────────────────▶  /auth/sso 桥接页
     │                                              │ ② 校验 targetOrigin∈白名单 且 nonce 存在
     │                                              │ ③ auth.getSession()（读主站登录态）
     │   ④ postMessage({ ok, nonce, session })      │    └─ 未登录 + interactive → 引导去 /login，登录后回到本页
     │ ◀───────────────────────────────────────────┘
     │  ⑤ 校验 origin + nonce + 来源窗口
     │  ⑥ auth.setSession({ access_token, refresh_token })
     ▼
   子应用已登录，uid 与主站一致
```

## 3. 两种模式

| 模式             | 载体        | 用户感知         | 未登录时                               | 典型场景                                         |
| ---------------- | ----------- | ---------------- | -------------------------------------- | ------------------------------------------------ |
| `silent`（默认） | 隐藏 iframe | 无感             | 立即返回 `not_authenticated`           | 子应用**进站时**自动尝试同步，主站登录过就直接进 |
| `interactive`    | 弹窗        | 看到主站登录弹窗 | 在弹窗内引导登录，登录完成回传 session | 用户点「用云乐坊账号登录」按钮                   |

推荐组合拳：**进站先 `silent` 静默探测**，失败再把「登录」按钮接到 `interactive`。

> ⚠️ `interactive` 必须用**弹窗**而非 iframe：未登录时桥接页会跳转到主站 `/login`，
> 跳转发生在隐藏 iframe 里用户是看不见、点不到的。客户端已为你保证 `interactive` 走弹窗。

## 4. 接入步骤（子应用侧）

### 第一步：装包

```bash
pnpm add @yunlefun/sso
```

> 包首次发布前，可临时从 ylf/ylf 仓库 `packages/sso/src` 拷贝 `client.ts` + `protocol.ts` 自用（零依赖、框架无关）。

按需取用三个层级的 API：

| 函数                            | 作用                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| `signInWithSso(auth, options?)` | **一站式**：发起 SSO 并在成功后直接注入登录态。多数子应用只用这一个 |
| `requestSso(options?)`          | 只取回 session，不注入（自己决定怎么用）                            |
| `adoptSession(auth, session)`   | 只把已拿到的 session 注入 SDK                                       |

### 第二步：进站静默同步

```ts
import cloudbase from '@cloudbase/js-sdk'
import { signInWithSso } from '@yunlefun/sso'

const app = cloudbase.init({ env: 'yunlefun-8g7ybcxc7345c490' })
const auth = app.auth({ persistence: 'local' })

// 已经是登录态就别重复同步
const { data } = await auth.getSession()
if (!data?.session || data.session.user?.is_anonymous) {
  const res = await signInWithSso(auth, { mode: 'silent' })
  // res.ok === true  → 已与主站同账号登录
  // res.ok === false → 主站也未登录（reason: 'not_authenticated'），保持未登录即可
}
```

### 第三步：按钮上的「用云乐坊账号登录」

```ts
async function loginWithYunLeFun() {
  const res = await signInWithSso(auth, { mode: 'interactive' })
  if (res.ok) {
    // 登录成功，刷新你的用户态 / 拉账户
  }
  else if (res.reason === 'closed') {
    // 用户关掉了弹窗，静默处理
  }
  else {
    toast('登录失败，请重试')
  }
}
```

`signInWithSso` 内部等价于：

```ts
const res = await requestSso({ mode: 'interactive' })
if (res.ok) {
  await auth.setSession({
    access_token: res.session.access_token,
    refresh_token: res.session.refresh_token,
  })
}
```

> `auth.setSession({ access_token, refresh_token })` 是 CloudBase Web SDK 注入登录态的官方入口——
> 这正是 SSO「在子站落地」的关键一步。

## 5. 安全模型（务必读）

跨站搬运的 session 里**含 `refresh_token`（长效凭证）**，等于把账号的钥匙递出去。所以三道闸全都不能少：

1. **origin 白名单（主站侧）**：桥接页只把 session 发给 `targetOrigin` 命中白名单的子站，
   且通配规则仅允许 **HTTPS 子域名**（`*.yunle.fun` 不含 `yunle.fun` 顶级域、不含 HTTP）。
2. **nonce（一次一令）**：客户端每次请求生成随机 nonce，桥接页原样回传，客户端只认本次 nonce 的消息，防重放 / 防串扰。
3. **来源窗口 + 精确 origin（客户端侧）**：客户端只接受「来自自己打开的那个 iframe/弹窗」且
   `event.origin` 恰为主站源的消息——校验逻辑见 `@yunlefun/sso` 的 `parseSsoResultMessage`，并有单测覆盖。

**红线**：白名单里**只能放你自己掌控的第一方域名**。给任何第三方 origin 放行，等于把用户 refresh_token
拱手送人。需要给不可信方做登录，应改用「授权码 + 后端换 token」之类的标准 OAuth 流程，而不是本 SSO 桥。

> 桥接页对**匿名 session**（`user.is_anonymous === true`）一律按未登录处理，不会把匿名态当成已登录广播出去。

### 关于退出登录（单点登出）

session 一经注入，子站就持有一份**独立的登录态**，与主站不再实时联动。当前桥接**不做单点登出（SLO）**：

- 主站退出登录后，子站**已注入**的 session 不会被主动失效，会一直用到 token 自然过期。
- 但主站退出后，子站**再次** `silent` 同步会拿到 `not_authenticated`——所以「进站静默同步」天然能反映最新登录态。

需要更强的登出一致性时，子站应缩短自身校验周期（如每次进站 / 定时 `getSession` 复核），
而不是依赖桥接推送登出事件。真正的全局 SLO 需要服务端会话登记表，属于后续演进，不在当前轻量桥范围。

## 6. 配置（主站侧）

白名单由环境变量驱动，定义在 `nuxt.config.ts` 的 `runtimeConfig.public.ssoAllowedTargetOrigins`：

```bash
# .env
# 逗号分隔，支持「精确 origin」与「HTTPS 通配子域名」两种写法
NUXT_PUBLIC_SSO_ALLOWED_TARGET_ORIGINS=https://*.yunle.fun,https://*.yunyoujun.cn
```

**新增一个子站**：把它的 origin 追加进去即可，例如再接一个独立域名 `https://example.com`
（精确写法）或一整组子域 `https://*.example.com`（通配写法），重新部署主站生效。

**本地联调**：桥接页内置放行了常见本地端口（`localhost` / `127.0.0.1` 的
`3000 / 2333 / 3333 / 5173 / 5174 / 5175 / 4173`），无需改配置即可在本地跑通两端。
其它端口在本地调试时临时加进 `NUXT_PUBLIC_SSO_ALLOWED_TARGET_ORIGINS` 即可。

子应用侧若主站不是默认的 `https://www.yunle.fun`（如本地起的主站），用 `ssoOrigin` 指定：

```ts
await signInWithSso(auth, { ssoOrigin: 'http://localhost:5173', mode: 'silent' })
```

### 主站桥接页：已接入 `@yunlefun/sso/protocol`

主站 `app/pages/auth/sso.vue` 已改为从包导入协议，本地副本 `app/utils/ssoBridge.ts` 已删除——
主站与各子应用共用同一份契约：

```ts
// app/pages/auth/sso.vue
import {
  isAnonymousSession,
  readSsoMode,
  readSsoNonce,
  readSsoTargetOrigin,
  SSO_RESULT_TYPE,
} from '@yunlefun/sso/protocol'
```

依赖经 catalog 引入（`package.json` 的 `"@yunlefun/sso": "catalog:"` + `pnpm-workspace.yaml` 的 `'@yunlefun/sso': ^0.1.0`）。

> ⚠️ **发布门控**：`@yunlefun/sso` 首次 `npm publish` 后，在 www 跑一次 `pnpm install` 即补齐锁文件；
> 发布前 `pnpm install` 会因拉不到包而失败（本地 `node_modules` 已有副本，不影响当前 dev/build）。

## 7. 协议参考

### 请求（子站 → 桥接页，URL query）

| 参数           | 必填 | 说明                              |
| -------------- | ---- | --------------------------------- |
| `mode`         | 否   | `silent`（默认）或 `interactive`  |
| `targetOrigin` | 是   | 子站自身 origin，须命中主站白名单 |
| `nonce`        | 是   | 本次请求随机串，原样回传用于校验  |

### 回传（桥接页 → 子站，`postMessage`）

```ts
interface SsoMessage {
  type: 'ylf:sso-result'
  ok: boolean
  nonce: string // 必与请求一致
  reason?: 'invalid_request' | 'not_authenticated'
  session?: CloudBaseSession // ok === true 时携带，含 access_token / refresh_token / user
}
```

客户端归一化后的结果类型（`@yunlefun/sso` 导出）：

```ts
type SsoResult
  = | { ok: true, session: SsoSession }
    | { ok: false, reason: 'not_authenticated' | 'invalid_request' | 'timeout' | 'popup_blocked' | 'closed' | 'error' }
```

## 8. 排错

| 现象                               | 可能原因                                                | 处理                                                                        |
| ---------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| 始终 `invalid_request`             | 子站 origin 不在白名单 / 用了 HTTP 通配 / 顶级域        | 核对 `NUXT_PUBLIC_SSO_ALLOWED_TARGET_ORIGINS`，通配子域须 HTTPS             |
| `silent` 总是 `not_authenticated`  | 主站确实没登录，或主站 session 已过期/为匿名态          | 改走 `interactive` 让用户登录一次                                           |
| `interactive` 返回 `popup_blocked` | 弹窗被拦截                                              | 必须在用户点击事件里直接调用（同步触发 `window.open`），勿放在 `await` 之后 |
| 注入后子应用仍未登录               | session 缺 `refresh_token`（`adoptSession` 返回 false） | 让用户走一次 `interactive` 重新登录刷新凭证                                 |
| 收不到任何回传，最终 `timeout`     | 主站源写错 / 跨端口本地未放行                           | 核对 `ssoOrigin` 与本地端口白名单                                           |

## 9. 接入 checklist

- [ ] 确认与云乐坊同 env、同 Auth；子站 origin 已加入主站白名单
- [ ] `pnpm add @yunlefun/sso`
- [ ] 进站 `silent` 静默同步（已登录则跳过）
- [ ] 「用云乐坊账号登录」按钮接 `interactive`，并在用户点击事件里同步触发
- [ ] 登录态就绪后再调 [account-api](./sub-app-integration.md#4-接入方式-b任意前端直接调云函数) 拉余额 / 判会员
- [ ] 自测：主站登录后子站静默免登、退出登录后子站同步失效、弹窗登录回流、弹窗被关的兜底
