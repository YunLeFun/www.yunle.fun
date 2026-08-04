# SSO Client Registry Implementation Plan

状态：Implementation complete; controlled rollout pending
对应需求：`requirements.md` R1–R10
对应设计：`design.md`

- [x] 1. 将已确认的需求与设计落入 Provider 仓库
  - 保留 P1 静态裁决、NoSQL 管理源、签名快照和显式 compare 边界
  - 明确 Provider、CloudBase、未来 Admin UI 与 Consumer 的所有权
  - _Requirements: R1–R10_

- [x] 2. 实现严格 Schema、规范化与哈希内核
  - 严格解析 Registry、快照、活动指针和生成产物，拒绝未知字段
  - 校验环境/issuer、clientId、adapter、scope、精确 URL 与同源图标
  - 生成排序稳定的 canonical JSON、contentHash 与 securityHash
  - 增加无效输入、顺序稳定性和兼容性测试
  - _Requirements: R1, R3, R5, R9_

- [x] 3. 实现快照与活动指针签名
  - 使用独立 Ed25519 domain separator 签名和验签
  - 将 snapshotId、environment、sequence、Registry 与哈希绑定到快照签名
  - 将 generation、活动快照和回滚信息绑定到活动指针签名
  - 提供代码评审管理的环境信任锚，不信任数据库自报公钥
  - 增加密钥不匹配、内容篡改、指针篡改和重放测试
  - _Requirements: R4, R6, R7, R8_

- [x] 4. 建立可复现的 generated 静态 Registry
  - 把现有 production/development Registry 迁入确定性 JSON 产物
  - 保持 `productionRegistry` / `developmentRegistry` 导出 API 不变
  - 保持所有现有授权决定和 registration fingerprint 不变
  - 让云函数 vendoring 携带完全相同的生成产物
  - _Requirements: R1, R5, R9_

- [x] 5. 实现 `sso-registry-admin` Event Function
  - 实现 saveDraft、validateDraft、publishDraft、rollback、getActiveEnvelope、getStatus
  - 使用乐观锁与 NoSQL 事务保证发布、回滚和审计原子性
  - 保证发布重试幂等、历史快照不可变、响应和日志不泄露私钥
  - 以 `aclRule.invoke=false` 声明管理面调用边界
  - _Requirements: R2, R3, R4, R7, R8, R10_

- [x] 6. 实现受控 Registry 运维脚本
  - 支持 validate、seed、export、compare
  - 默认只读或 dry-run；显式写操作必须指定环境、操作者和原因
  - 输出/比较字节稳定产物且不接触签名私钥
  - _Requirements: R2, R5, R9, R10_

- [x] 7. 将 shadow compare 收敛到显式发布门禁
  - 复用签名活动信封验证和确定性 generated JSON 比较
  - 由 CLI、CI、部署 smoke 或独立监控执行，不挂接授权请求
  - 删除运行时 observer、CloudBase shadow adapter 和环境开关
  - _Requirements: R6, R10_

- [x] 8. 保持 `sso-ticket` 与 `desktop-auth` 静态只读
  - 两个函数只 vendoring authorization-core 与 generated JSON
  - 请求入口不读取 Registry 管理数据库或等待 compare
  - 增加云函数 artifact 与部署清单回归测试
  - _Requirements: R6, R9, R10_

- [x] 9. 补齐资源与部署契约
  - 声明四个 ADMINONLY 集合及必要索引
  - 在 production/development 清单中声明 Event Function 与独立密钥
  - 更新环境变量示例、云函数文档、密钥轮换与回退说明
  - _Requirements: R4, R7, R8, R10_

- [x] 10. 完成验证与 CloudBase 代码审查
  - 运行 authorization-core、admin、compare、sso-ticket、desktop-auth 定向测试
  - 运行 lint、typecheck、全量 test、build 和 `git diff --check`
  - 按 CloudBase code-review 规则检查权限、集合、函数类型和 SDK 使用
  - _Requirements: R1–R10_

- [ ] 11. 执行受控环境上线（需单独确认）
  - 分别生成并托管 production/development 独立 Registry 私钥
  - 创建集合、索引和 ADMINONLY 权限并部署管理函数
  - seed、发布、导出首个签名快照并提交公钥信任锚
  - 先发布验证方，再通过独立 compare 完成 match/故障/篡改/回滚 smoke
  - _Requirements: R4, R6, R7, R8, R9, R10_
