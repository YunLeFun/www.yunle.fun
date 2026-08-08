# SSO Client Registry P1.1 Implementation Plan

状态：Implementation complete; development rollout pending
对应需求：`requirements.md` R1–R11
对应设计：`design.md`

- [x] 1. 修复 P1 一致性缺陷并补回归测试
  - 草稿更新保留创建时的 `baseSnapshotId`，并行发布后不静默换基线
  - export/compare 强制使用本地 generated artifact 的 `minimumGeneration`
  - _Requirements: R1, R8, R9_

- [x] 2. 实现 production 邮件审批
  - 仅按不可变 CloudBase uid 解析当前严格已验证邮箱
  - 12 位随机审批码只经 SES 发送，数据库只保存 HMAC；30 分钟过期、5 次锁定
  - 投递成功前保持不可消费，投递失败、过期、锁定、内容漂移均不得发布
  - _Requirements: R2–R5, R10_

- [x] 3. 实现 development 直接排队与统一回滚
  - development 跳过邮件但保留操作者、原因、hash、签名 release intent 与审计
  - rollback 选择历史有效快照，通过更高 generation 和同一 CI 路径发布
  - _Requirements: R4, R5, R8_

- [x] 4. 实现签名发布意图与事务 outbox
  - release intent 绑定 environment、approval、snapshot、generation、policy、hash、base commit 与 key id
  - 快照、活动指针、审批消费、release intent、outbox 和审计原子提交
  - dispatcher 使用租约、请求超时、指数退避、dead letter 与过期 worker 写保护
  - _Requirements: R5, R6, R10, R11_

- [x] 5. 实现受保护 GitHub 发布链路
  - dispatcher 的 workflow payload 只含 releaseIntentId
  - CI 重新读取并验签 intent/envelope，检查 base commit 与 generated-only diff
  - 运行 lint、typecheck、test、build、compare，创建 PR 并等待所有 PR checks
  - 校验 PR head 与审批基线后自动 squash merge，不依赖当前套餐不可用的 branch protection auto-merge
  - _Requirements: R6, R7, R9–R11_

- [x] 6. 实现按准确提交部署与回执
  - main push 再次验签 release manifest，development/production 使用独立 concurrency 与 secrets
  - development 只部署 `sso-ticket`；production 部署 `www`、`sso-ticket`、`desktop-auth`
  - `deployed` 回执强制包含环境完整消费者集合，且每个 SHA 必须等于 merge commit
  - _Requirements: R1, R7, R9–R11_

- [x] 7. 抽取事务邮件共享包并补自动化验证
  - `account-lifecycle-notifier` 与 Registry 审批复用 SES 投递实现
  - Registry 使用比生命周期通知更严格的 uid 与邮箱验证策略
  - 覆盖审批投递、错误码锁定、过期、内容漂移、签名、CI 状态、rollback 与 dispatcher
  - _Requirements: R3, R4, R10, R11_

- [x] 8. 完成本地发布审查
  - lint、typecheck、全量 test、build、actionlint 与 `git diff --check`
  - CloudBase 权限、ADMINONLY 集合、私有 Event Function、密钥边界与 NoSQL 事务审查
  - _Requirements: R1–R11_

- [ ] 9. 完成 development 控制面 rollout
  - 创建 7 个集合、索引与 ADMINONLY 权限
  - 生成独立 Registry Ed25519 密钥和 CI token，提交 development 公钥信任锚
  - 部署 `sso-registry-admin` 与 `sso-registry-release-dispatcher`
  - 需要仓库级 GitHub App（Actions write、Contents write、Pull requests write、Checks read）及 installation
  - _Requirements: R2–R7, R10, R11_

- [ ] 10. 完成 development 首次发布与 smoke
  - seed、diff、queue、dispatch、generated-only PR、checks、merge、精确提交部署
  - 验证签名、compare、未知 client 拒绝、已注册 client 成功、回滚和 dispatcher 重试
  - 确认 release intent 最终为 `deployed`，消费者仅含 development `sso-ticket`
  - _Requirements: R1, R6–R11_

- [ ] 11. 经确认后推进 production
  - development 证据通过前，不创建 production 集合、密钥、GitHub Environment secrets 或部署
  - production 另行确认 SES 模板、审批 uid、专用密钥、EdgeOne 准确提交 smoke 与回退窗口
  - _Requirements: R1–R11_
