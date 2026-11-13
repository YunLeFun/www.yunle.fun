# 云食册原生微信登录

云食册用移动应用 AppID `wxce6c7405dd756b9d` 调起微信。现有 `https://api.yunle.fun/sso-ticket` 的两个原生动作负责向微信换码、验证绑定和签发原云乐坊 UID 的 custom ticket。网站仍按原流程使用 `wx_open`；不修改其 AppID、AppSecret、回调、SDK 或绑定。

首次绑定需要同时证明两边身份：App 提供现有登录的 access token 和微信授权码；函数通过同环境 CloudBase `/auth/v1/user/me` 取得现有 UID，再通过移动应用 AppSecret 向微信换取 UnionID。只有云乐坊账号的 `wx_open` 已绑定且服务端返回的 `provider_user_id` 与 UnionID 完全一致才允许建立原生登录索引。移动应用和网站应用须在同一个微信开放平台账号下。不能比较跨应用的 OpenID、昵称或头像，也不使用未公开的反查接口猜 UID。

索引由两个确定性主键组成，在同一个数据库事务内写入，一个对应微信身份，一个对应 CloudBase UID。并发绑定不能覆盖已有归属；同一对重复绑定幂等。保存的只有 UID、带独立密钥的 UnionID 摘要和创建时间，不保存微信 token 或原始标识。以后用微信登录时重新读取该 UID 的网站绑定和账号状态；网站解绑、更换微信、账号冻结或无可核对身份时不签票。首次绑定缺少网站微信时，由用户在网站原有安全设置里绑定，再回到 App；不自动开户、合并或迁移数据。

## 配置与部署顺序

1. 核对开放平台「微信登录」已开通、AppID/Bundle ID/Universal Links 一致、与网站 App 同一开放平台账号。
2. 在对应 CloudBase 环境建立服务端专用文档集合 `sso_cook_wechat_bindings`（客户端读写均关闭），为 `uid` 建非唯一索引供注销清理。新建 PostgreSQL 环境先启用 Document（`pgdoc`）插件，并验证文档事务和集合权限。先部署 [account-api](https://github.com/YunLeFun/api) 中删除绑定记录的清理，再部署 `sso-ticket` 新代码。`sso_security_limits` 保存单次授权码摘要并由 `sso-security-sweeper` 清理。已有环境使用只更新代码的部署流程，保留函数路由、ACL 和其他变量。
3. 在目标环境的 **云函数 → sso-ticket → 配置 → 环境变量** 单独合并下列值。联调须使用已核实的独立 CloudBase 环境、对应的 Registry 和测试构建。`sso-ticket` 从函数运行上下文读取实际环境 ID 来验证会话，不接受客户端指定环境。不要向生产环境的 CloudBase「身份认证 → 登录方式」添加或覆盖微信身份源。

| 变量                        | 值                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `COOK_WECHAT_APP_SECRET`    | 微信开放平台「云食册」**移动应用**的 AppSecret，只填这里                               |
| `COOK_WECHAT_BINDING_KEY`   | 每环境独立的 32 字节随机密钥，64 位十六进制，持久保存；不要在轮换 AppSecret 时一同更换 |
| `COOK_WECHAT_LOGIN_ENABLED` | 缺省关闭；仅为已准备好的联调环境显式设为 `true`                                        |

4. 开关关闭时核对网站扫码登录、原 SSO 换码和 JWKS 不变。联调必须核对 CloudBase 实际返回的网站身份记录：本人 `/auth/v1/user/me` 与管理员 `getEndUserInfo(uid)` 均须能读到 `providers[].id=wx_open` 对应的 `provider_user_id`，且该值确实是此微信的 UnionID。文档和单元测试不能替代此读回。任何一处没有可靠证据就保持入口关闭，不推断 UID。
5. 用装有微信的 iPhone 确认网站、原生云乐坊登录、原生微信登录得到同一 UID；测不匹配、网站解绑、并发冲突、账号注销，以及取消和重复回调。不开启正式构建前完成隐私与 App Review 验收。

这些变量不属于普通部署清单，避免现有发布要求填写额外密钥。已配置的环境只走保留环境变量的代码更新；如必须全量更新配置，先保全这些值并核对更新后的开关。

回滚先将 `COOK_WECHAT_LOGIN_ENABLED` 设为 `false`，再按需恢复函数代码；不改网站身份源、不删除索引。若账号需要改绑另一个微信，旧索引会阻止自动覆盖；先由支持渠道核实账号归属，再处理索引。
