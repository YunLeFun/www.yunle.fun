# SSO Client Registry 飞书审批实施计划

状态：本地实现完成（2026-09-04）；production 资源与 canary 待单独确认

本地门禁证据：Admin 475 tests、Provider 1178 tests 全部通过；两仓 lint、typecheck、build、`git diff --check` 通过；两仓依赖审计无已知漏洞；Admin 资源脚本 dry-run 为 0 network / 0 writes。未登录浏览器访问连接页会回到管理后台登录页，登录后的桌面/移动端人工验收归入 production owner canary。

对应需求：`requirements.md` R1–R9

对应设计：`design.md`

实施仓库：

- Provider：`YunLeFun/www.yunle.fun`
- Admin：`YunLeFun/admin`

## 约束

- 先写兼容路径与失败关闭测试，再接真实飞书和 UI。
- 所有 Provider 字段为增量字段；旧审批缺少 `channel` 时继续按 email 处理。
- 不删除现有邮件命令、`approveAndQueueReleaseByAdmin` 或历史数据。
- 功能开关默认关闭；未通过 production owner canary 前不默认启用。
- 不在仓库、日志、卡片或审计中写入真实密钥、OAuth token 或完整 open id。

## 实施任务

- [x] 1. 建立两仓基线与契约测试
  - 记录两个仓库实施前的分支、工作树、lint/typecheck/test/build 基线。
  - 在 Provider 固化旧邮件审批和既有 Admin proof 的兼容测试。
  - 在 Admin 固化现有权限、GitHub reward step-up、飞书普通通知和设置页契约测试。
  - 增加 feature flag 默认关闭测试，确保未配置飞书时行为不变。
  - _Requirements: R8, R9_

- [x] 2. 扩展 Provider 通道无关审批模型
  - 为 `sso_registry_publish_approvals` 增加 channel、delivery、decision、lease 与 cardSync 可选字段。
  - 抽取共享的证据核验、邮件激活和 approve/reject 事务函数，避免三条入口复制逻辑。
  - 旧记录和旧 CLI 继续使用邮件状态与验证码消费语义。
  - 覆盖缺失字段、并发请求、过期、stale evidence 和重复请求测试。
  - _Requirements: R4, R5, R7–R9_

- [x] 3. 实现 Provider Admin proof v2 与决定登记
  - 新增 `submitAdminApprovalDecision` proof schema 和 exact-key Ed25519 verifier。
  - 绑定 approvalId、decision、Admin uid、权限、消息 ID、身份摘要及完整 Registry 证据。
  - production approver uid allowlist、issuer/audience/action/kid/TTL/jti 全部失败关闭。
  - 事务登记 `decision_pending`；同一 jti 幂等，不同决定冲突时拒绝。
  - 保留旧 `approveAndQueueReleaseByAdmin` 及其 trust anchor/测试。
  - _Requirements: R2, R5–R7, R9_

- [x] 4. 实现 Provider 异步决定消费
  - 给 `sso-registry-admin` 增加仅 production timer 使用的待决定扫描入口。
  - 通过事务租约处理 `decision_pending -> processing`，支持租约过期重领。
  - approve 原子消费审批并创建/确认快照、release intent、outbox 与审计。
  - reject 原子终结审批；email_fallback 只在此时生成 codeMac 并调用现有 SES。
  - 增加终态卡片同步状态和有界重试；同步失败不得回滚权威结果。
  - 覆盖并发 worker、崩溃恢复、重复 timer、邮件失败和 dead-letter 测试。
  - _Requirements: R4, R5, R7, R8_

- [x] 5. 实现 Provider→Admin 安全通道与首选通道路由
  - 实现 method/path/timestamp/body-hash HMAC 签名器，独立于审批 proof 和 CI token。
  - `requestPublishApproval` / `requestRollbackApproval` 先创建无验证码审批，再请求 Admin 投递卡片。
  - 卡片成功时不解析邮箱、不生成验证码；无绑定、明确失败或 3 次重试耗尽时激活邮件。
  - 增加 `getApprovalForAdmin` 裁剪读取接口和固定字段白名单。
  - 覆盖超时、错误响应、重试幂等、投递成功不发邮件和自动降级测试。
  - _Requirements: R3, R4, R6–R9_

- [x] 6. 把 Admin 高风险 step-up 深化为通用模块
  - 将 reward 专用核心抽为 `admin-step-up`，支持动作摘要、一次性 grant、5 分钟 TTL 和安全 returnTo。
  - reward 路由保留兼容 wrapper，现有调用和集合无需迁移。
  - 添加 identity bind/rebind/unbind 动作；GitHub numeric ID 必须与当前 Admin principal 精确匹配。
  - 覆盖 open redirect、动作篡改、grant 重放、过期和 GitHub 身份不一致测试。
  - _Requirements: R1, R8, R9_

- [x] 7. 实现 Admin 飞书身份关联与审计
  - 新增 `admin_identity_bindings` 与 `admin_identity_audit_logs` 常量、server-only 资源脚本和权限检查。
  - 用双向确定性映射和事务实现一个 Admin/一个 external identity 的唯一活动绑定。
  - 实现 state + PKCE 的飞书 OAuth start/callback；严格限制 tenant key。
  - 只保存 tenant/open id、可选 union id、展示名快照和时间戳；立即丢弃 token。
  - 关联、换绑、解绑都消费 GitHub step-up，并记录不含原始身份的安全审计。
  - 覆盖 OAuth CSRF、租户错误、冲突、事务回滚、换绑/解绑和 token 不落库测试。
  - _Requirements: R1, R2, R8, R9_

- [x] 8. 实现 Admin Registry 卡片适配器
  - 复用现有飞书 SDK，但使用独立“云乐坊发布审批”应用配置与客户端工厂。
  - 建立纯函数卡片 builder，覆盖发布/回滚、普通/安全差异和全部终态。
  - 私聊发送使用 approvalId 派生的稳定 uuid，最多 3 次短退避；记录 message id。
  - 终态使用 message patch，失败只影响卡片可见状态，不改变 Provider 结果。
  - 动态文本转义、详情 URL 同源校验、30KB 限制和危险批准二次确认测试。
  - _Requirements: R3, R4, R8_

- [x] 9. 实现 Admin 内部接口与飞书回调
  - 内部投递/终态接口验证 Provider HMAC、60 秒时间窗、固定 path 和 body schema。
  - Registry 专用公开回调限制 method/content type/body size，并用 SDK verification token/encrypt key 验签解密。
  - 精确校验 tenant/open id/message id/approvalId/action；每次重新读取 binding、Admin 状态和显式权限。
  - 生成 proof v2 并调用 Provider `submitAdminApprovalDecision`；接受后立即返回 processing 卡片。
  - 覆盖伪造签名、旧时间戳、跨租户、换绑后旧卡片、撤权、重复点击和 Provider 不可用测试。
  - _Requirements: R2, R5, R6, R8_

- [x] 10. 实现 Admin 设置与只读审批界面
  - `/settings` 增加“账号连接”入口；新增 `/settings/connections` 自助绑定页。
  - 新增 `/sso-registry/approvals/:approvalId`，只展示裁剪证据、通道状态和主动邮件降级。
  - 桌面采用 5/7 双栏，移动端单列；危险操作独占整行并有清晰 loading/error/disabled 状态。
  - 复用 TDesign tokens、AdminPageShell 和 Remix Icon；不引入新视觉系统、emoji 或 `v-html`。
  - 对页面、服务端 API、响应式布局、无障碍标签和 XSS/CSRF 建立契约测试。
  - _Requirements: R1–R5, R8_

- [x] 11. 补齐配置、资源与用户文档
  - 两仓 `.env.example`、运行时配置和部署说明只增加变量名/用途，不写真实值。
  - Provider 资源 manifest 增加 production timer 和审批索引；Admin provision 脚本创建两项 ADMINONLY 集合及必要索引。
  - 文档说明飞书应用最小权限、OAuth 回调、卡片回调、密钥轮换、解绑和邮件降级。
  - 更新 Registry 运维命令帮助，说明卡片优先但旧邮件 approve 命令仍可用于 fallback。
  - _Requirements: R1, R3, R4, R9_

- [x] 12. 完成本地质量与安全门禁
  - 两仓执行 lint、typecheck、全量 test、build、`git diff --check` 和仓库已有 CI 校验。
  - 执行 CloudBase code review：server-only 集合、private function、最小权限、无事务外权威写入。
  - 执行 XSS、CSRF、OAuth state/PKCE、回调签名、proof 重放、敏感日志和依赖漏洞审查。
  - 核对 diff 不包含真实 app secret、token、private key、open id、邮箱验证码或意外生成文件。
  - _Requirements: R1–R9_

- [ ] 13. 配置 production 资源并保持功能关闭
  - 创建独立“云乐坊发布审批”飞书自建应用，启用机器人、网页 OAuth、卡片回调和最小消息权限。
  - 生成独立 Admin approval Ed25519 key 与 Provider→Admin HMAC key；先发布公钥 trust anchor，再配置私钥。
  - 创建 Admin 身份集合/索引，部署两仓和 Provider timer；验证 callback challenge 与私聊可用性。
  - 此阶段 feature flag 保持关闭，线上继续全部走邮件。
  - _Requirements: R1, R3, R6, R8, R9_

- [ ] 14. 执行 production owner canary 与启用
  - 只允许 owner canary uid，先关联飞书并验证换绑/解绑撤销旧卡片。
  - 使用零安全差异草稿验证卡片批准、拒绝、重复点击、过期和 CI release intent。
  - 演练无绑定/投递失败自动邮件，以及已送达后主动切换邮件；确认验证码均只生成一次。
  - 验证发布和常规回滚、终态卡片、审计串联以及关闭开关立即回到邮件。
  - canary 证据完整后才默认启用；不删除长期邮件 fallback。
  - _Requirements: R1–R9_

## 完成判定

- 任务 1–12 完成：代码具备安全提交条件，但飞书功能仍默认关闭。
- 任务 13 完成：资源和部署就绪，仍不得宣称已上线。
- 任务 14 完成：production canary 通过，才可宣称飞书审批正式启用。
