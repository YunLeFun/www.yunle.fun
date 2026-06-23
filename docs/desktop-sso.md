# 本地应用登录设计：设备授权码 + 离线 Entitlement

> 面向：要把 Skykeeper 这类**桌面 / 本地应用**接入云乐坊账号体系的设计者与执行型智能体。
> 关联：[跨站 SSO 接入指南（Web）](./sso-integration.md)、[子应用接入：支付 / 会员 / 云币](./sub-app-integration.md)、[云币与会员](./coin-and-membership.md)。
> 配套接入手册：[桌面应用接入使用文档](./desktop-sso-integration.md)。

云乐坊已经有一套**面向 Web 的跨站 SSO**（`@yunlefun/sso` + `/auth/sso` 桥接页），但它**只能在浏览器之间**用 `postMessage` 搬运登录态，**不适合桌面 / 本地应用**。本文设计一套与之并列、专供本地应用的登录与授权方式：**统一账号为主、设备授权码登录、Ed25519 离线 entitlement 缓存**，并完全复用既有的 `account-api` 账户中心。

---

## 0. 为什么 Web SSO 不能直接搬到桌面端

现有 Web SSO 的机制（见 [sso-integration.md §2](./sso-integration.md)）有三个前提，桌面端**一个都不满足**：

| Web SSO 依赖                            | 桌面端为什么不成立                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 子站有一个在白名单内的 **HTTPS origin** | Tauri webview 跑在 `tauri://localhost` / `http://tauri.localhost`，不是 `*.yunle.fun`，进不了白名单；强行放行等于给一个不可信 origin 开门 |
| 浏览器窗口间 **`postMessage`** 通道     | 桌面应用与主站浏览器是两个进程，没有共享的 window 关系，`postMessage` 无从谈起                                                            |
| 子站可以安全持有 **`refresh_token`**    | 桌面端把长效 `refresh_token` 落在用户磁盘上**永不过期、无法吊销、可被提取**——等于把账号钥匙焊死在每台机器上                               |

> [sso-integration.md §5](./sso-integration.md) 的红线已经写明：**给不可信方做登录，应改用「授权码 + 后端换 token」之类的标准 OAuth 流程，而不是本 SSO 桥**。桌面应用正是这种「不可信客户端」，所以本文走标准的设备授权码流程，而非复用 Web 桥。

---

## 1. 设计目标与原则

1. **账号为主，权益落 `uid`。** 会员 / 云币仍然挂在统一 CloudBase `uid` 上，跨 Web 与桌面、跨应用一致。桌面端不自建权益体系。
2. **核心功能永不强制登录。** Skykeeper 的基础自动保存（v1 范围，见其 `docs/01-架构与执行计划.md`）**离线可用、免登录**；登录只解锁 Pro / 会员权益。**登录失败、断网、未授权都不能挡住基础保存。**
3. **桌面端不持有 `refresh_token`。** 桌面拿到的是一张**应用级、设备绑定、有期限**的 entitlement（授权凭证），不是主站 session。即便被提取，也只在该设备、该应用、到期前有效，且可服务端吊销。
4. **离线可校验。** entitlement 用 **Ed25519 非对称签名**，桌面内置公钥即可**离线验真**，断网期间凭缓存继续用 Pro（在「离线宽限期」内）。
5. **敏感动作服务端二次校验。** 扣云币、判会员到期等以服务端真实账户为准；entitlement 里的会员快照只用于**离线 UI 门控**，不作为扣费依据。
6. **零改动 account-api。** 新增的 `desktop-auth` 云函数验签后，凭 `serviceToken` 转调既有 `account-api` 的内部服务接口（`getAccountForUser` / `deductCoinForUser`），账户中心一行不用动。

---

## 2. 总体架构

三个角色，外加一个完全复用的账户中心：

| 角色                       | 位置                                        | 职责                                                                                                                                   |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **桌面客户端**             | Skykeeper（Tauri，Rust 后端 + Vue webview） | 发起设备授权、轮询取 entitlement、本地存储与**离线验签**、在线刷新、调权益接口                                                         |
| **授权页（Verification）** | 主站 `www.yunle.fun/link`（新增页面）       | 在**已登录的浏览器**里展示授权请求，用户确认后把设备码绑定到当前 `uid`                                                                 |
| **桌面授权云函数**         | 新增 `cloudfunctions/desktop-auth`          | 设备码下发/审批/轮询/刷新/吊销；**Ed25519 签发 entitlement**；验签后转调 account-api                                                   |
| **账户中心（复用）**       | 既有 `cloudfunctions/account-api`           | `getAccountForUser` / `deductCoinForUser`（内部服务接口，凭 `serviceToken`，[internal.js](../cloudfunctions/account-api/internal.js)） |

```
   桌面应用 (Tauri)                www.yunle.fun (浏览器·已登录)         CloudBase
   ───────────────                ───────────────────────────         ─────────
   ① startDeviceAuth ──HTTP──────────────────────────────────▶ desktop-auth
      ◀── { userCode:"WXYZ-1234", deviceCode, verificationUri, interval }
   ② opener 打开 /link?code=WXYZ-1234 ──▶ /link 页
                                          读登录态 uid（未登录先去 /login）
                                          用户点「授权」
                                          callFunction(approveDevice,{userCode}) ─▶ 绑定 deviceCode→uid
   ③ poll pollDeviceToken ──HTTP─────────────────────────────▶ desktop-auth
      ◀── { status:"approved", entitlement, deviceRefreshToken, account }
   ④ 本地存储 entitlement(+refreshToken)，内置公钥离线验签
   ⑤ 在线刷新 refreshEntitlement ────────────────────────────▶ desktop-auth（滚动续期 / 拉最新会员快照）
   ⑥ getAccount / deductCoin(entitlement,...) ───────────────▶ desktop-auth
                                                                  验签 → serviceToken → account-api
                                                                  (getAccountForUser / deductCoinForUser)
```

**调用通道分工（关键）：**

- **桌面端 ↔ `desktop-auth`**：走 **CloudBase HTTP 访问服务**（把函数绑定到一个 HTTPS 路径），Rust 后端用 `reqwest`、webview 用 `fetch` 都能直接打，**无需 CloudBase SDK 登录态**——因为这条链路的鉴权凭证是 `deviceCode` / `deviceRefreshToken` / `entitlement` 本身。
- **授权页 ↔ `desktop-auth`（仅 `approveDevice`）**：走浏览器里的 **CloudBase JS SDK `callFunction`**，自动携带登录态，函数侧用 `app.auth().getUserInfo().uid` 读到真实 `uid`（与 account-api 同款，见 [index.js:46](../cloudfunctions/account-api/index.js:46)）。

> `desktop-auth` 的 `main(event)` 同时兼容两种入口：JS SDK 直传 `{ action, ... }`；HTTP 访问服务把请求体放在 `event.body`（字符串）里，需先 `JSON.parse(event.body)` 再取 `action`。两条入口共用同一段处理逻辑。

---

## 3. 授权流程：设备授权码（Device Authorization Grant）

采用 OAuth 2.0 设备授权码流程（RFC 8628）的裁剪版。选它而非「PKCE + 本地回环重定向」，因为它**不需要桌面端起本地 HTTP 端口**（避免防火墙/杀软拦截、端口占用、企业网限制），在 CloudBase 上也最好搭。

```
桌面应用                                          主站 /link
 startDeviceAuth(appId, deviceId)
   │ ① 取 { userCode, deviceCode, verificationUri, verificationUriComplete, interval, expiresIn }
   │ ② 系统浏览器打开 verificationUriComplete (=/link?code=WXYZ-1234)
   ├──────────────────────────────────────────────▶ ③ /link 读登录态
   │                                                   未登录 → 跳 /login，回流后继续
   │                                                   展示「<App> 想访问你的云乐坊账号 / 权限范围」
   │                                                   用户点「授权」→ approveDevice(userCode)
   │ ④ 每 interval 秒 pollDeviceToken(deviceCode, deviceId)
   │      pending      → 继续轮询
   │      slow_down    → 退避后再轮询
   │      approved     → 取 entitlement + deviceRefreshToken + account 快照（并标记 deviceCode 已消费）
   │      denied/expired → 终止，提示用户重试
   ▼ 桌面已授权，uid 与主站一致；entitlement 落本地
```

**步骤要点：**

- **`userCode`（人读短码）**：8 位、去歧义字母表（去掉 `0/O/1/I/L`），形如 `WXYZ-1234`，供用户在 `/link` 页核对/手填。
- **`deviceCode`（机读密钥）**：≥32 字节高熵随机串（base64url），**服务端只存其哈希**（如 `sha256`），轮询时比对哈希。它是设备侧轮询的唯一凭证，等同一次性密钥。
- **`verificationUriComplete`**：`https://www.yunle.fun/link?code=WXYZ-1234`，桌面直接 `opener` 打开它，`/link` 页预填短码，用户少打一步字。
- **轮询节流**：`interval`（如 5s）由服务端下发；客户端打太快服务端回 `slow_down`，客户端**指数退避**。`deviceCode` 有 `expiresIn`（如 600s）过期。
- **审批授权页 `approveDevice`**：在已登录浏览器里调用，函数侧从 CloudBase Auth 取 `uid`（匿名/占位 uid 一律拒绝，复用 account-api 的 `ANON_UIDS` 判定，见 [index.js:43](../cloudfunctions/account-api/index.js:43)），把 `deviceCode` 记录置为 `approved` 并写入 `uid`。

---

## 4. Entitlement 令牌（Ed25519 离线授权）

entitlement 是桌面端拿到的**唯一长期凭证**，替代「主站 session」。它是一个紧凑的、类 JWT 的 Ed25519 签名串。

**结构**（`base64url(header).base64url(payload).base64url(sig)`，`sig = Ed25519(privKey, header.payload)`）：

```jsonc
{
  "header": { "alg": "EdDSA", "typ": "YLF-ENT", "kid": "desktop-2026" }, // kid 支持密钥轮换
  "payload": {
    "iss": "yunle.fun",
    "sub": "<uid>", // 账号 uid（始终为已登录用户）
    "aud": "skykeeper", // appId，限定本 entitlement 只对该应用有效
    "did": "<deviceId>", // 设备绑定：换台机器即失配（防刷新迁移）
    "scope": ["membership", "coin"],
    "mbr": { "active": true, "level": "basic", "expireAt": 1789999999000 }, // 会员快照，仅供离线 UI 门控
    "iat": 1781000000,
    "exp": 1781604800, // = iat + 离线宽限期（如 7d）
    "jti": "<随机串>" // 便于审计 / 黑名单
  }
}
```

**离线校验（桌面端，断网也能做）：**

1. 桌面**内置签发公钥**（按 `kid` 选，支持轮换），用 `crypto.verify('ed25519', ...)`（Node/webview）或 `ed25519-dalek`（Rust）验签。
2. 验 `exp > now`、`aud === 本应用 appId`、`did === 本机 deviceId`。
3. 用 `mbr.active && mbr.expireAt > now` 决定**是否点亮 Pro UI**。
4. **基础自动保存不看 entitlement**——任何验签失败/过期/缺失都只关掉 Pro，不影响核心保存（原则 2）。

**为什么必须非对称（Ed25519）而不是 HMAC：** HMAC 是对称的，桌面端要么没有密钥（无法离线验真），要么内置了密钥（等于泄露签发能力）。Ed25519 让桌面**只持公钥**即可离线验真、又无法伪造，这才让「离线宽限」真正可信。`node:crypto` 原生支持 Ed25519（`generateKeyPairSync('ed25519')` / `sign(null,...)` / `verify(null,...)`）。

**期限与宽限：**

- `exp` 直接定义为**离线宽限期**（如 7 天）：这段时间内即使断网，桌面也认这张缓存。
- 桌面**在线时机会性刷新**（每次启动 + 每日一次）滚动续期、刷新会员快照。
- 离线超过宽限期：**仅 Pro 锁定**，下次联网刷新成功即恢复；基础保存全程不受影响。
- 真正的敏感动作（扣云币）本就是在线动作，服务端按真实账户校验，不依赖 entitlement 的 `exp`。

---

## 5. 刷新与吊销

**设备注册表 `desktop_devices`**：审批通过时为该 `(uid, appId, deviceId)` 注册一台设备，发一个**长效 `deviceRefreshToken`**（如 90 天滚动，服务端只存哈希）。

- **刷新 `refreshEntitlement(deviceRefreshToken, deviceId)`**：服务端校验 refreshToken 哈希 + 设备未吊销 → 重新拉账户快照 → 签发新 entitlement（`exp` 顺延），并**滚动轮换** refreshToken。这是会员变更（充值/续费/到期）传导到桌面的主路径。
- **吊销**：
  - 用户在 `www.yunle.fun` 个人中心「已登录设备」里**移除某设备** → 置 `revokedAt` / 删 refreshToken 哈希 → 该设备**刷新即失败**，entitlement 到 `exp` 后自然失效。
  - 紧急封禁某 `jti` / 某 `uid`：服务端维护黑名单，敏感动作（`deductCoin`）实时查黑名单即时生效。
- **离线吊销的固有局限**：已签发、未过期的 entitlement 在**断网**设备上无法被立即作废（这是所有离线授权的通病）。对策是**缩短 `exp`（宽限期）** + 敏感动作在线实时校验。文档须向接入方讲明这条边界。

---

## 6. 软件密钥 / 兑换码：不做

**决定不做软件密钥 / 兑换码体系。** 权益统一通过「账号登录（§3）+ 在云乐坊充值 / 购买会员」发放，登录闭环 + 账户中心（§7）已完整覆盖。兑换码会引入额外的出码工具、批次对账、防爆破，以及「离线无账号激活后再认领」的状态复杂度，对当前形态收益不足。

> 若将来确有发卡 / 会员卡需求，再按「**登录后兑换、权益落 `uid`**」的原则扩展（绝不做「纯密钥即权益」——分享难撤销、复用不了会员中心），而非回到密钥即授权。因此本方案里 entitlement 的 `sub` 始终是已登录用户的 `uid`，不存在无账号 entitlement。

---

## 7. 云函数契约：`desktop-auth`

新增 `cloudfunctions/desktop-auth`。主入口只做「解析（兼容 HTTP body）+ 鉴权 + 路由」，签发/验签/数据访问拆到 `lib/`。

**设备侧接口（走 HTTP 访问服务，凭证即鉴权）：**

| action               | 入参                                         | 返回                                                                                      | 凭证                                 |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| `startDeviceAuth`    | `appId`, `deviceId`, `deviceName?`, `scope?` | `{ deviceCode, userCode, verificationUri, verificationUriComplete, interval, expiresIn }` | 无（公开）                           |
| `pollDeviceToken`    | `deviceCode`, `deviceId`                     | `{ status }`；`approved` 时附 `{ entitlement, deviceRefreshToken, account }`              | `deviceCode`                         |
| `refreshEntitlement` | `deviceRefreshToken`, `deviceId`             | `{ entitlement, deviceRefreshToken, account }`                                            | `deviceRefreshToken`                 |
| `getAccount`         | `entitlement`                                | `{ coin, membership }`                                                                    | `entitlement`                        |
| `deductCoin`         | `entitlement`, `amount`, `bizId`, `meta?`    | `{ balance, deduped }` 或抛「余额不足」                                                   | `entitlement`（+ `scope` 含 `coin`） |
| `getPublicKeys`      | —                                            | `{ keys: JWK[] }`（JWKS，供客户端取验签公钥，支持轮换）                                   | 无（公开）                           |

**授权页接口（走 JS SDK callFunction，携带登录态）：**

| action           | 入参                | 返回                                           | 鉴权             |
| ---------------- | ------------------- | ---------------------------------------------- | ---------------- |
| `describeDevice` | `userCode`          | `{ appId, deviceName, scope, expireAt }`       | 登录态（展示用） |
| `approveDevice`  | `userCode`          | `{ ok: true }`                                 | 登录态 → `uid`   |
| `denyDevice`     | `userCode`          | `{ ok: true }`                                 | 登录态           |
| `listDevices`    | —                   | `{ devices: [...] }`（个人中心展示已授权设备） | 登录态           |
| `revokeDevice`   | `appId`, `deviceId` | `{ revoked: boolean }`                         | 登录态           |

**`desktop-auth` 如何复用 `account-api`：** `getAccount` / `deductCoin` 统一在 `desktop-auth` 内验签拿到 `uid` 后，用 `app.callFunction({ name:'account-api', data:{ action:'getAccountForUser' | 'deductCoinForUser', serviceToken: process.env.ACCOUNT_API_INTERNAL_TOKEN, userId: uid, ... } })` 转调（同 env 函数间调用）。账户中心保持单一事实来源。

---

## 8. 数据模型（新增集合）

```jsonc
{
  "desktop_device_codes": {
    "deviceCodeHash": "sha256(deviceCode)", // 唯一索引；只存哈希
    "userCode": "WXYZ1234", // 唯一索引（去格式化后）
    "appId": "skykeeper",
    "deviceId": "<安装级随机 id>",
    "deviceName": "MacBook Pro / Win11-PC",
    "scope": ["membership", "coin"],
    "status": "pending|approved|denied|consumed|expired",
    "uid": "<approve 后写入>",
    "interval": 5,
    "createdAt": 1781000000000,
    "expireAt": 1781000600000, // TTL，建议配 TTL 索引自动清理
    "lastPolledAt": 1781000005000
  },
  "desktop_devices": {
    "uid": "<account uid>",
    "appId": "skykeeper",
    "deviceId": "<安装级随机 id>", // (uid, appId, deviceId) 唯一
    "deviceName": "MacBook Pro",
    "refreshTokenHash": "sha256(deviceRefreshToken)",
    "createdAt": 1781000000000,
    "lastSeenAt": 1781600000000,
    "revokedAt": null
  }
}
```

> **待建唯一索引**：`desktop_device_codes.deviceCodeHash`、`desktop_device_codes.userCode`、`desktop_devices` 的 `(uid,appId,deviceId)`。与 [payment-grant-idempotency](../docs/coin-and-membership.md) 一致地把幂等护栏建在唯一索引上。

---

## 9. 安全模型（务必读）

1. **全程 TLS。** 设备侧接口走 HTTPS；`deviceCode` / `deviceRefreshToken` / `entitlement` 都是 bearer 凭证，传输层不能裸奔。
2. **凭证只存哈希。** `deviceCode` / `deviceRefreshToken` / `code` 服务端一律存 `sha256`，比对用常量时间比较（复用 [internal.js](../cloudfunctions/account-api/internal.js) 的 `timingSafeEqualStr` 思路）。
3. **设备绑定。** entitlement 的 `did` 锁定 `deviceId`；refreshToken 也校验 `deviceId`。把 entitlement 文件拷到另一台机：在原机过期前仍可离线用（离线无法阻止，固有局限），但**无法在新机刷新**——refresh 时 `deviceId` 失配即拒。
4. **签发私钥只在服务端。** `DESKTOP_AUTH_SIGNING_KEY`（Ed25519 私钥）配进 `desktop-auth` 环境变量，**绝不下发**；桌面只内置公钥。私钥轮换用 `kid`：新私钥签发、旧公钥保留验签直至旧 entitlement 全部过期。
5. **匿名 uid 防护。** `approveDevice` 拒绝匿名/占位 uid（沿用 account-api `ANON_UIDS`）；`getAccount` / `deductCoin` 也拒绝 `sub` 为匿名/空的 entitlement。
6. **限流与防爆破。** `pollDeviceToken` 节流（`interval` + `slow_down`）；`userCode` 高熵 + 短 TTL + 审批页二次确认，防止用户码被猜中。`startDeviceAuth` 按 `deviceId`/IP 限频。
7. **金额不可信前端。** 与 [coin-and-membership.md](./coin-and-membership.md) 一致：大额/敏感扣费的 `amount` 由 `desktop-auth`（服务端）按业务规则核定，不照单全收客户端传值。
8. **基础能力与登录解耦。** 再次强调原则 2：登录链路任何环节出错都不得影响核心保存。

---

## 10. 与 Web SSO 的关系与对比

两套并存，按客户端类型选用，**共享同一账户中心与 `uid`**：

| 维度     | Web 跨站 SSO（既有）               | 桌面 / 本地应用（本文）                                 |
| -------- | ---------------------------------- | ------------------------------------------------------- |
| 客户端   | 第一方 `*.yunle.fun` 浏览器子站    | 桌面 / 本地应用（不可信客户端）                         |
| 登录载体 | 隐藏 iframe / 弹窗 + `postMessage` | 系统浏览器 + 设备授权码 + 轮询                          |
| 下发凭证 | 主站 session（含 `refresh_token`） | 应用级 Ed25519 **entitlement**（不含 session）          |
| 信任根   | origin 白名单                      | 设备授权码 + 设备绑定 + 非对称签名                      |
| 离线     | 不涉及                             | **核心能力**：内置公钥离线验签 + 宽限期                 |
| 吊销     | 不做 SLO，自然过期                 | 设备级吊销 + 黑名单（在线即时，离线到期）               |
| 账户接口 | 子站直连 `account-api`（登录态）   | `desktop-auth` 验签后转调 `account-api`（serviceToken） |

---

## 11. 落地计划

> 建议按阶段推进，每阶段独立可验收。**Phase 1 是最小可用闭环。**

**Phase 0 — 密钥与配置**

- 生成 Ed25519 签发密钥对；私钥 `DESKTOP_AUTH_SIGNING_KEY` 配进 `desktop-auth` 环境变量，公钥（带 `kid`）记录待内置进客户端。
- `cloudbaserc.json` 新增 `desktop-auth` 函数项（`envVariables`：`DESKTOP_AUTH_SIGNING_KEY`、`DESKTOP_AUTH_SIGNING_KID`、`ACCOUNT_API_INTERNAL_TOKEN`）。

**Phase 1 — 登录闭环（最小可用）**

- `desktop-auth`：`startDeviceAuth` / `approveDevice` / `pollDeviceToken` / `refreshEntitlement` + Ed25519 签发 + `desktop_device_codes` / `desktop_devices`。
- 主站新增 `app/pages/link.vue` 授权页（复用现有登录态 / `/login` 回流）。
- 绑定 HTTP 访问服务路径，跑通「桌面起码 → 浏览器授权 → 桌面拿到 entitlement」。

**Phase 2 — 权益接入**

- `desktop-auth`：`getAccount` / `deductCoin` 转调 account-api 内部接口。
- 个人中心「已登录设备」管理页（列表 / 吊销）。

**Phase 3 — 打磨**

- 限流、黑名单、审计日志；客户端 SDK 化（见接入文档，可沉淀为 `@yunlefun/sso/desktop`）。

**部署**：与既有云函数一致——前端 EdgeOne Pages 自动、`desktop-auth` 云函数 **手动 `tcb` 部署**（见 [deployment-pipeline](../README.md)）。

---

## 12. 取舍与待定

- **设备授权码 vs PKCE+loopback**：默认设备码（无本地端口、网络环境友好）。若要更顺滑的「点一下自动回流」体验，可叠加 PKCE + `127.0.0.1` 回环作为可选模式（需客户端起临时 HTTP 监听）。
- **entitlement 直连 account-api？** 不直连。account-api 的登录态接口靠 CloudBase Auth context，桌面没有；强行让桌面拿 CloudBase 自定义登录票据会引入 uid 命名空间问题。统一经 `desktop-auth` 验签转调最干净。
- **离线宽限期长度**：会员（Pro）建议 7 天；可按业务调。越长越「断网友好」、吊销越滞后，权衡见 §5。
- **多设备上限**：是否限制单账号并发设备数（如 ≤5），作为防滥用策略，待产品决定。
