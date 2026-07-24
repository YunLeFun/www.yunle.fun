# OAuth 2.0 / OIDC 技术储备决策

> 状态：已决定
> 日期：2026-07-24

## 决策

当前保持现有授权架构，不继续开发或对外发布标准 OAuth 2.0 / OpenID Connect 端点。

第一方 Web 应用继续使用现有 [Web SSO](./sso-integration.md)，桌面应用继续使用现有 [设备授权](./desktop-sso.md)。本阶段不新增 `/authorize`、`/token`、UserInfo、Discovery 等兼容层，也不迁移已经接入的客户端。

## 原因

- 当前方案已经覆盖受控的第一方 Web SSO 与桌面授权需求。
- 暂无第三方客户端、身份联邦或标准 SDK 互操作需求。
- 提前提供标准协议会引入持续的协议合规、客户端注册、Token 生命周期、密钥轮换和安全审计成本。
- 统一授权核心已经保留 client、scope、issuer、PKCE、设备码和 JWKS 等演进基础，后续增加标准 Adapter 不需要推翻现有架构。

## 重新启动条件

出现以下任一需求时，重新评估并立项：

- 需要接入第三方或无法统一升级的客户端；
- Consumer 明确需要使用标准 OAuth 2.0 / OIDC SDK；
- 需要跨组织身份联邦、标准 Discovery、UserInfo 或单点登出；
- 现有自定义协议的维护成本高于标准化改造成本。

届时优先评估 OIDC Authorization Code + PKCE；桌面端按需评估 RFC 8628 Device Authorization Grant。正式开放前必须补齐威胁模型、协议一致性测试、密钥轮换方案和迁移计划。
