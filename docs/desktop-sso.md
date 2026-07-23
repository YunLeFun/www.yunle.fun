# 桌面授权架构

桌面端使用统一授权核心的 `device` Adapter，不使用 Web SSO session，也不把离线 entitlement 当 OAuth access token。当前协议是面向 Skykeeper 的裁剪设备授权；只有出现第三方 SDK 互操作需求时，才增加标准 RFC 8628 端点与 token 交换语义。

## 身份模型

| 字段       | 来源                                               | 用途                                  |
| ---------- | -------------------------------------------------- | ------------------------------------- |
| `clientId` | 客户端发送 `skykeeper-desktop`                     | 协议主体；在 Client Registry 中查策略 |
| `appId`    | 服务端从 clientId 派生为 `skykeeper`               | 业务归属与审计；客户端不能传          |
| `deviceId` | 服务端计算 P-256 public JWK 的 RFC 7638 thumbprint | 安装身份与吊销锚点                    |
| `scope`    | 客户端显式请求，服务端取 Registry 允许集合         | 当前仅 `membership:read`              |

缺少 scope、未知 client、调用方传入 appId 或请求 `coin` 均失败关闭。

## 组件边界

- `@yunlefun/authorization-core`：Client Registry、issuer、设备码状态机、刷新 grant family、entitlement keyring、DPoP 校验。
- `desktop-auth`：CloudBase 持久化、浏览器审批、账户会员事实读取和 HTTP Adapter。
- Skykeeper：P-256 安装密钥、DPoP、系统安全存储、离线 entitlement 验签和 UI 状态。
- `account-api`：账号状态与会员事实的唯一来源。

`desktop-auth` 不再暴露通用 `getAccount` 或 `deductCoin(amount)`。Skykeeper 没有 coin scope；未来业务若需收费，必须新增服务端业务 action，由服务端按产品/操作规则核定金额和幂等键，不能接受客户端自报金额。

## 流程

```text
Skykeeper                          desktop-auth                      Browser /link
 P-256 install key
 deviceId = JWK thumbprint
     | start(clientId, explicit scope, publicJwk) + DPoP |
     |-------------------------------------------------->|
     |<--------- deviceCode + userCode + verify URI -----|
     |                                                    | show registered app/scope
     |                                                    | user explicitly approves
     | poll(deviceCode) + fresh DPoP -------------------->|
     |<----- entitlement + rotating refresh token --------|
```

每个 HTTP 请求的 `DPoP` JWT：

- `alg=ES256`、`typ=dpop+jwt`，header 携带 public JWK；
- claims 绑定 `htm=POST`、精确 `htu`、短时 `iat` 和唯一 `jti`；
- 服务端验签、计算 thumbprint，并把 `(jkt,jti)` 持久化以拒绝重放；
- start body 的 public JWK、设备码记录、refresh token 和 entitlement `cnf.jkt` 必须属于同一 thumbprint。

设备码仅保存 hash，10 分钟有效；pending → approved/denied → consumed，消费在事务中至多一次。授权页展示 Registry 中的应用名与显式 scope，不信任客户端展示文案。

## Refresh grant

- 明文 refresh token 只在响应中出现一次，数据库只存 SHA-256。
- 每次刷新都轮换 token；旧 token 状态变成 `used`。
- 任意已使用 token 再次出现会吊销整个 `grantId` family 和设备记录。
- idle TTL 30 天，absolute TTL 180 天；滑动续期不能突破绝对期限。
- 每次刷新重新加载 Client Registry；client 停用、scope 收缩或安全字段变化都会失败关闭。

Skykeeper 把安装私钥与 refresh token 放入 macOS Keychain / Windows Credential Manager / Linux Secret Service。磁盘 `auth.json` 只缓存签名 entitlement。

## 离线 entitlement

entitlement 是 Ed25519 JWT，header 固定：

```json
{ "alg": "EdDSA", "typ": "ylf-entitlement+jwt", "kid": "..." }
```

核心 claims：

```json
{
  "iss": "https://www.yunle.fun",
  "sub": "<uid>",
  "aud": "skykeeper-desktop",
  "app_id": "skykeeper",
  "scope": ["membership:read"],
  "cnf": { "jkt": "<device thumbprint>" },
  "membership": { "level": "pro", "expires_at": 1700000000 },
  "iat": 0,
  "nbf": 0,
  "exp": 0,
  "jti": "..."
}
```

默认离线有效期 7 天。客户端必须钉死算法与 token type，按 kid 选公钥，并校验签名、issuer、audience、app_id、scope、`cnf.jkt`、nbf、exp。会员失效时省略 `membership`，不签入 coin 余额或可变业务全貌。

## 密钥轮换

- 服务端 active Ed25519 私钥负责签发；JWKS 同时发布 active 与尚未过期的 retired public keys。
- 先让客户端版本包含新旧公钥，再切换 active kid；等待最长 entitlement TTL 后才能删除旧公钥。
- 私钥只存在于受管 secret；`DESKTOP_AUTH_PUBLIC_KEYS` 只包含退役公钥。

## 持久化集合

- `desktop_device_codes`
- `desktop_devices`
- `desktop_refresh_tokens`
- `desktop_proof_replays`

全部 server-only。设备码、refresh token 与 DPoP replay key 使用确定性 hash / `_id` 形成唯一约束；相关状态变更使用数据库事务。
