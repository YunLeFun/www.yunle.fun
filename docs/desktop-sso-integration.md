# 桌面应用接入使用文档：用云乐坊账号登录

> 面向：要把**桌面 / 本地应用**（Tauri、Electron、原生）接入云乐坊账号、会员与云币的开发者。
> 设计依据：[本地应用登录设计：设备授权码 + 离线 Entitlement](./desktop-sso.md)。
> Web 子站请改看：[跨站 SSO 接入指南](./sso-integration.md)。账户能力契约：[云币与会员](./coin-and-membership.md)。

桌面应用**不要**用 Web 的 `@yunlefun/sso`（那套靠浏览器 `postMessage`，桌面跑不通，也不该让桌面持有 `refresh_token`）。桌面走本文的**设备授权码流程**：应用显示一个短码 → 用户在浏览器登录并授权 → 应用拿到一张**离线可验签的 entitlement**。会员 / 云币仍挂在统一 `uid` 上，与 Web 端一致。

---

## 0. 前提与你会拿到什么

桌面接入**不要求**与主站同 CloudBase env、也不需要把子站 origin 加白名单（那是 Web SSO 的前提）。你需要向平台管理员申请到三样东西：

| 你会拿到 | 用途 |
| --- | --- |
| **`appId`** | 你的应用稳定标识（小写字母/数字/`-`/`_`，≤32 位，如 `skykeeper`）。云币流水 / 会员归属按它分应用对账 |
| **`desktop-auth` 接入域名** | 设备侧接口的 HTTPS 基址（CloudBase HTTP 访问服务，形如 `https://<env>.../desktop-auth`，或自定义域名） |
| **entitlement 验签公钥（含 `kid`）** | Ed25519 公钥，**内置进你的客户端**，用于离线验真 entitlement |

> 私钥只在服务端，永远不下发。你只拿公钥。

**贯穿全流程的原则（来自设计文档，务必内化）：**

1. **核心功能免登录、离线可用。** 登录只解锁 Pro / 会员；登录失败 / 断网 / 未授权都**不能**挡住基础功能。
2. **不存主站 `refresh_token`。** 你只存 entitlement 和 deviceRefreshToken，二者都是应用级、设备绑定、可吊销的。
3. **会员是不是有效，离线看 entitlement 的快照；扣云币等敏感动作必须在线**，由服务端按真实账户校验。

---

## 1. 接入概览（三步）

```
① 设备授权（一次性）   startDeviceAuth → 浏览器授权 → poll 拿 entitlement
② 本地存储 + 离线门控   存 entitlement/refreshToken；内置公钥离线验签，决定 Pro 是否点亮
③ 用权益              在线刷新滚动续期；getAccount 判会员、deductCoin 扣费
```

设备侧所有接口都是 `POST {BASE}/desktop-auth`，body 为 JSON `{ "action": "...", ... }`，凭证（`deviceCode`/`deviceRefreshToken`/`entitlement`）放在 body 里。

---

## 2. 第一步：发起设备授权

**生成一个稳定的 `deviceId`**：安装级随机串（如 UUID v4），首次启动生成后持久化（Tauri `tauri-plugin-store` / 系统钥匙串），**之后不变**——它是设备绑定与吊销的锚点。

**① 申请设备码 → ② 打开浏览器 → ③ 轮询**（前端 TS，跑在 webview 里）：

```ts
const BASE = 'https://api.yunle.fun' // 平台给的 desktop-auth 基址（设备侧接口都在 ${BASE}/desktop-auth）
const APP_ID = 'skykeeper'

async function da(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/desktop-auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })
  if (!res.ok) throw new Error(`desktop-auth ${action} HTTP ${res.status}`)
  return res.json()
}

async function loginWithYunLeFun(deviceId: string) {
  // ① 申请设备码
  const start = await da('startDeviceAuth', {
    appId: APP_ID,
    deviceId,
    deviceName: navigator.platform, // 让用户在「已登录设备」里认得出
  })
  // start = { deviceCode, userCode, verificationUri, verificationUriComplete, interval, expiresIn }

  // ② 在 UI 上显示 userCode，并用系统浏览器打开授权页
  showUserCode(start.userCode) // 例如「在浏览器里确认这个码：WXYZ-1234」
  await openUrl(start.verificationUriComplete) // Tauri：import { openUrl } from '@tauri-apps/plugin-opener'

  // ③ 轮询直到授权 / 拒绝 / 超时
  const deadline = Date.now() + start.expiresIn * 1000
  let interval = start.interval * 1000
  while (Date.now() < deadline) {
    await sleep(interval)
    const poll = await da('pollDeviceToken', { deviceCode: start.deviceCode, deviceId })
    if (poll.status === 'approved') {
      await saveEntitlement(poll.entitlement, poll.deviceRefreshToken) // → 第二步
      return { ok: true, account: poll.account }
    }
    if (poll.status === 'slow_down') { interval += 5000; continue }
    if (poll.status === 'denied' || poll.status === 'expired')
      return { ok: false, reason: poll.status }
    // pending → 继续
  }
  return { ok: false, reason: 'expired' }
}
```

> **打开浏览器用「系统默认浏览器」，不要用 webview 内嵌窗口**——用户多半已在系统浏览器里登录过云乐坊，能直接静默授权。Tauri 用 `@tauri-apps/plugin-opener` 的 `openUrl`，或 Rust 侧 `tauri-plugin-shell`。

**也可以把轮询放在 Rust 后端**（更稳，不受 webview 生命周期影响）：

```rust
// 伪代码：reqwest 轮询
let start: StartResp = client.post(format!("{BASE}/desktop-auth"))
    .json(&json!({ "action": "startDeviceAuth", "appId": APP_ID, "deviceId": device_id }))
    .send().await?.json().await?;

// 通过 Tauri command 把 start.user_code / verification_uri_complete 交给前端展示并 opener 打开
loop {
    tokio::time::sleep(Duration::from_secs(start.interval)).await;
    let poll: PollResp = client.post(format!("{BASE}/desktop-auth"))
        .json(&json!({ "action": "pollDeviceToken", "deviceCode": start.device_code, "deviceId": device_id }))
        .send().await?.json().await?;
    match poll.status.as_str() {
        "approved" => { store_entitlement(poll.entitlement, poll.device_refresh_token)?; break; }
        "slow_down" => { /* 退避 */ }
        "denied" | "expired" => return Err(/* 终止 */),
        _ => {} // pending
    }
}
```

---

## 3. 第二步：本地存储与离线验签

**存储**：`entitlement` + `deviceRefreshToken` 存到尽量安全的位置——优先**系统钥匙串**（macOS Keychain / Windows Credential Manager，Tauri 可用 `keyring` crate），其次 `tauri-plugin-store` 的应用数据目录。`deviceRefreshToken` 比 entitlement 更敏感（能换新 entitlement），务必保护好。

**离线验签 + 门控**：内置公钥，**断网也能跑**。Pro 是否点亮只看验签后的会员快照；基础功能不看它。

webview 侧（WebCrypto，现代 WebView2 / WKWebView 支持 Ed25519；或用 `@noble/ed25519`）：

```ts
// 解析 base64url 段（不验签也能读 payload，用于离线 UI；但「点亮 Pro」必须先验签）
function decodePayload(entitlement: string) {
  const [, payload] = entitlement.split('.')
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
}

async function isProUnlocked(entitlement: string, publicKeyRaw: Uint8Array): Promise<boolean> {
  try {
    const [h, p, s] = entitlement.split('.')
    const key = await crypto.subtle.importKey('raw', publicKeyRaw, { name: 'Ed25519' }, false, ['verify'])
    const ok = await crypto.subtle.verify('Ed25519', key,
      b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`))
    if (!ok) return false
    const claim = decodePayload(entitlement)
    const now = Date.now() / 1000
    if (claim.exp <= now) return false                 // 超出离线宽限期
    if (claim.aud !== APP_ID) return false             // 不是发给本应用的
    if (claim.did !== currentDeviceId()) return false  // 不是本机的
    return claim.mbr?.active === true && (claim.mbr.expireAt ?? 0) > Date.now()
  } catch { return false }
}
```

Rust 侧（`ed25519-dalek`，推荐把验签放后端，前端只问结果）：

```rust
use ed25519_dalek::{Verifier, VerifyingKey, Signature};
// 拆 header.payload.sig，base64url 解码；verify(`{h}.{p}`, sig) 通过后再读 payload 的 exp/aud/did/mbr
```

**门控落点（关键）：**

```ts
// ✅ 基础自动保存：永远开，跟 entitlement 完全无关
startAutoSave()

// ✅ Pro 功能：验签通过且会员有效才点亮；否则只是「未解锁」，不是「报错」
if (await isProUnlocked(entitlement, PUBLIC_KEY))
  enableProFeatures()
else
  showUpgradeHint() // 引导登录 / 充值，但不打断核心使用
```

---

## 4. 第三步：在线刷新（滚动续期）

会员充值 / 续费 / 到期等变化，靠刷新传导到桌面。**时机**：每次启动联网时 + 每天至少一次（或进入「会员中心」页时）。

```ts
async function refresh(deviceId: string) {
  const token = await loadDeviceRefreshToken()
  if (!token) return // 没登录过，跳过
  try {
    const r = await da('refreshEntitlement', { deviceRefreshToken: token, deviceId })
    await saveEntitlement(r.entitlement, r.deviceRefreshToken) // refreshToken 会滚动轮换，存新的
    return r.account
  } catch (e) {
    // 刷新失败：可能是被吊销 / 网络问题。
    // 别立刻登出！沿用本地 entitlement 到它自然过期（离线宽限）。仅在明确收到「已吊销」时清除。
  }
}
```

> **断网 / 刷新失败不要清登录态。** 离线宽限期内继续用缓存；只有服务端**明确返回吊销**（如 `revoked`）才清除本地凭证并回到未登录态。

---

## 5. 判会员 / 扣云币（在线）

会员权益规则**在你侧定义**，平台只回答「是不是会员 / 什么等级 / 到期时间」（同 [coin-and-membership.md](./coin-and-membership.md) 的「平台给事实不给规则」）。

```ts
// 拉最新账户（在线，以服务端为准；离线时退回 entitlement 快照）
const account = await da('getAccount', { entitlement: await loadEntitlement() })
// account = { coin, membership: { isActive, level, expireAt } }

// 会员免扣费：先判会员，是会员就跳过扣费
async function exportHD(taskId: string) {
  const ent = await loadEntitlement()
  const acc = await da('getAccount', { entitlement: ent })
  if (!acc.membership.isActive) {
    try {
      // ⚠️ 必带 bizId（幂等键），同一 bizId 只扣一次，防重试/双击重复扣
      await da('deductCoin', { entitlement: ent, amount: 50, bizId: `export:${taskId}`, meta: { feature: 'hd-export' } })
    } catch (e) {
      // message 含「余额不足」→ 引导充值
      await openUrl('https://www.yunle.fun/wallet')
      return
    }
  }
  doExport()
}
```

**充值**：直接把用户导到云乐坊钱包页（用系统浏览器打开），充值成功后下次 `getAccount` / `refresh` 即可见：

```ts
await openUrl('https://www.yunle.fun/wallet')
```

---

## 6. 关于软件密钥 / 兑换码

**本方案不提供软件密钥 / 兑换码。** 权益统一走「账号登录 + 在云乐坊充值 / 购买会员」——你这边不需要做「输入兑换码」入口，也没有对应的服务端接口。会员是否有效、云币多少，全部以账号为准（见 §5）。

> 这是有意的取舍：纯密钥分享难撤销、复用不了会员中心。若将来平台真的上了发卡能力，会以「登录后兑换、权益落账号」的形式补充，届时再更新本文。

---

## 7. 终端用户（画师）会看到什么

把流程讲成人话，方便你做 UI 文案：

1. 应用里点「**用云乐坊账号登录**」。
2. 应用弹出一个码（如 `WXYZ-1234`）并**自动打开浏览器**到授权页。
3. 浏览器里（多半已登录）看到「**Skykeeper 想访问你的云乐坊账号**」，核对码一致，点「**授权**」。
4. 回到应用，已登录，会员 / 云币就绪。**整个过程不用在应用里输账号密码。**
5. 断网也能继续用已解锁的 Pro（有宽限期）；想停用某台设备，去 `www.yunle.fun` 个人中心「已登录设备」里移除。

---

## 8. 安全须知（接入方红线）

1. **绝不存主站 `refresh_token` / 不内嵌主站登录页。** 桌面只持 entitlement + deviceRefreshToken。
2. **公钥可内置，私钥永不进客户端。** 你只会拿到公钥。
3. **`deviceId` 持久且每台唯一**，不要用可被仿造的固定值（如硬编码常量）。
4. **基础功能与登录彻底解耦**：登录模块整个崩了，自动保存也要照常跑。
5. **敏感扣费别信前端金额**：`amount` 的业务校验在服务端；大额动作走服务端核定。
6. **离线吊销有延迟是正常的**：被移除的设备在断网时最长可用到 entitlement 过期。对资损敏感的动作（扣大额云币）要求在线、实时校验，别只信本地快照。

---

## 9. 排错

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `startDeviceAuth` 4xx | `appId` 未登记 / 基址写错 | 找平台管理员确认 `appId` 与 `desktop-auth` 域名 |
| 轮询一直 `pending` | 用户还没在浏览器点授权 / 浏览器没打开 | 在 UI 显式给「重新打开授权页」按钮，重试 `openUrl(verificationUriComplete)` |
| 轮询返回 `slow_down` | 轮询太快 | 按返回退避，加大 `interval`（已在示例中处理） |
| `approved` 后离线验签失败 | 公钥/`kid` 不匹配 / `aud`/`did` 不符 | 核对内置公钥与 `kid`；确认 `appId`、`deviceId` 与申请时一致 |
| 刷新报 `revoked` | 设备被用户/管理员移除 | 清本地凭证，回到未登录，引导重新走设备授权 |
| 断网后 Pro 失效 | 超出离线宽限期 | 联网后 `refresh` 即恢复；可适当延长宽限期（找平台调） |
| `deductCoin` 抛「余额不足」 | 云币不够 | 捕获后 `openUrl('https://www.yunle.fun/wallet')` 引导充值 |
| 换台机器后无法刷新 | entitlement 的 `deviceId` 与本机不符（设备绑定） | 在新机重新走一次设备授权 |

---

## 10. 接入 checklist

- [ ] 申请到 `appId`、`desktop-auth` 基址、entitlement 验签公钥（含 `kid`）
- [ ] 生成并持久化稳定 `deviceId`（安装级唯一）
- [ ] 「用云乐坊账号登录」：`startDeviceAuth` → `openUrl` 系统浏览器 → 轮询 `pollDeviceToken`（含 `slow_down` 退避）
- [ ] 安全存储 entitlement + deviceRefreshToken（优先系统钥匙串）
- [ ] 内置公钥**离线验签**；用会员快照点亮 Pro，**基础功能与登录解耦、永不锁**
- [ ] 启动时 + 每日 `refreshEntitlement` 滚动续期；断网/失败不清登录态，仅 `revoked` 才清
- [ ] 判会员（`getAccount`）、按次扣费（`deductCoin` 带 `bizId`，捕获余额不足引导充值）、会员免扣费
- [ ] 充值用系统浏览器打开 `https://www.yunle.fun/wallet`
- [ ] 自测：浏览器授权回流、断网宽限可用、刷新滚动续期、设备吊销后失效、扣费幂等、余额不足提示
