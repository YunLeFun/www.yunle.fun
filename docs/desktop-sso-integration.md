# Skykeeper 桌面授权接入

当前注册：

```text
clientId = skykeeper-desktop
appId    = skykeeper            # 服务端派生，客户端不发送
scope    = membership:read      # 必须显式发送
```

HTTP 入口为 `https://api.yunle.fun/desktop-auth`。协议是内部裁剪设备授权，不宣称 RFC 8628 兼容。

## 客户端安装身份

首次启动生成 P-256 安装私钥，并且只把它存入操作系统安全存储。把 public JWK 的 RFC 7638 thumbprint 作为本机 `deviceId`；不得生成另一个随机 appId/deviceId。

每次 POST 都生成新的 ES256 DPoP：

```json
{
  "header": {
    "alg": "ES256",
    "typ": "dpop+jwt",
    "jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }
  },
  "claims": {
    "htm": "POST",
    "htu": "https://api.yunle.fun/desktop-auth",
    "iat": 1700000000,
    "jti": "<fresh random id>"
  }
}
```

签名使用 JWT ES256 的 64-byte IEEE P1363 `r || s` 编码。请求头为 `DPoP: <jwt>`。

## 发起授权

```json
{
  "action": "startDeviceAuth",
  "clientId": "skykeeper-desktop",
  "scope": ["membership:read"],
  "devicePublicJwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
  "deviceName": "Skykeeper · windows"
}
```

响应：

```json
{
  "deviceCode": "<secret>",
  "userCode": "ABCD-EFGH",
  "verificationUri": "https://www.yunle.fun/link",
  "verificationUriComplete": "https://www.yunle.fun/link?code=ABCD-EFGH",
  "interval": 5,
  "expiresIn": 600
}
```

用系统浏览器打开 `verificationUriComplete`。设备端按 interval 轮询，每次使用新的 DPoP：

```json
{ "action": "pollDeviceToken", "deviceCode": "<secret>" }
```

状态为 `pending`、`slow_down`、`denied`、`expired` 或：

```json
{
  "status": "approved",
  "entitlement": "<EdDSA JWT>",
  "deviceRefreshToken": "<opaque rotating secret>",
  "membership": { "level": "pro", "expiresAt": 1700000000000 }
}
```

deviceCode 与 userCode 不落客户端长期存储。refresh token 必须进入系统安全存储；entitlement 可缓存到应用配置目录。

## 刷新

```json
{
  "action": "refreshEntitlement",
  "deviceRefreshToken": "<current token>"
}
```

同样必须携带当前安装密钥签发的新 DPoP。成功响应会返回新 refresh token；必须以原子方式替换旧 token。失败码：

- `refresh_expired`：idle 或 absolute TTL 到期，重新登录；
- `refresh_reused` / `grant_revoked`：整组凭证已吊销，清除本地 session；
- `refresh_binding_invalid`：安装密钥不匹配；
- `client_policy_changed`：Registry 策略变化，重新授权。

## 离线验签

Skykeeper 只在以下条件全部满足时启用会员能力：

- EdDSA 签名和 kid 有效；
- `typ=ylf-entitlement+jwt`；
- `iss=https://www.yunle.fun`；
- `aud=skykeeper-desktop`、`app_id=skykeeper`；
- scope 含 `membership:read`；
- `cnf.jkt` 等于本机安装 public JWK thumbprint；
- nbf/exp 有效；
- `membership.expires_at` 尚未到期。

网络不可用时继续使用未过期 entitlement；过期或验签失败时只关闭会员能力，不影响 Skykeeper 基础保存。

## 服务端配置

```dotenv
AUTH_ISSUER_ENVIRONMENT=production
DESKTOP_AUTH_SIGNING_KEY=<base64 JWK or PEM>
DESKTOP_AUTH_SIGNING_KID=desktop-2026-07
DESKTOP_AUTH_PUBLIC_KEYS={"desktop-2026-06":{...}}
DESKTOP_AUTH_CANONICAL_URL=https://api.yunle.fun/desktop-auth
DESKTOP_AUTH_VERIFICATION_URL=https://www.yunle.fun/link
ACCOUNT_API_INTERNAL_TOKEN=<shared secret>
```

没有 `DESKTOP_AUTH_REFRESH_TTL_SEC` 或客户端 scope/appId 白名单环境变量；TTL 与注册策略均在版本化代码中。

## 禁止事项

- 不得发送 appId、deviceId、扣币金额或缺省 scope。
- 不得把 P-256 私钥、refresh token 写入普通文件、日志、前端状态或遥测。
- 不得把 entitlement 当作通用账户 access token。
- 不得回退到 Web SSO session 转发、密码模式、implicit flow 或动态客户端注册。

## 小云 iOS 只读账号

`el-bot-ios` 归属 `el-bot`，只请求 `membership:read` 与 `ai:usage`。它不具有云端实例的 `ai:agent` 扣点能力，也不能借用 `el-bot-cloud` 的凭据。生产登记提案位于 `specs/sso-client-registry-platform/changes/2026-11-07-el-bot-ios.client.json`，仍需签名 Registry 发布才能启用。

原生 App 使用系统认证窗口完成上述设备授权，并将 P-256 私钥、entitlement 和轮换 refresh token 一并保存在 Keychain。`revokeEntitlement` HTTP action 接受当前安装的 DPoP 及 `deviceRefreshToken`，仅撤销同一安装密钥绑定的 grant family；重复退出幂等，不会影响云端实例的另一份授权。退出失败时客户端保留凭据，允许重试。

用量入口为 AI Runtime 的 `POST /ai/v1/mobile/el-bot-account`。仅允许签名 envelope 内的 `account` 与 `transactions` action；后者可带 `offset:<n>` cursor。服务器从在线校验的 entitlement 派生用户，不接受客户端的用户 ID、应用 ID 或扣点金额。此传输只读，不注册模型调用、提交或取消任务的操作。
