# SSO Client Registry Implementation Plan

状态：Implementation complete; controlled rollout pending
对应需求：`requirements.md` R1–R10
对应设计：`design.md`

- [x] 1. 将已确认的需求与设计落入 Provider 仓库
  - 保留 P1 静态裁决、NoSQL 管理源、签名快照和影子验证边界
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

- [x] 7. 实现纯内核影子观察器
  - 实现 TTL、single-flight、250ms 有界等待和状态去重
  - 分类 match、display drift、security drift、不可用、无效、签名失败和重放
  - 平台结果只用于比较，永不进入 P1 authorize 裁决参数
  - _Requirements: R6, R10_

- [x] 8. 接入 `sso-ticket` 与 `desktop-auth`
  - 增加只读 CloudBase store adapter
  - 在冷启动/TTL 到期触发观察，不按请求实时查库
  - 数据库或验签异常时继续使用现有静态 Registry
  - 增加适配器与授权不变回归测试
  - _Requirements: R6, R9, R10_

- [x] 9. 补齐资源与部署契约
  - 声明四个 ADMINONLY 集合及必要索引
  - 在 production/development 清单中声明 Event Function、独立密钥和影子开关
  - 更新环境变量示例、云函数文档、密钥轮换与回退说明
  - _Requirements: R4, R7, R8, R10_

- [x] 10. 完成验证与 CloudBase 代码审查
  - 运行 authorization-core、admin、shadow、sso-ticket、desktop-auth 定向测试
  - 运行 lint、typecheck、全量 test、build 和 `git diff --check`
  - 按 CloudBase code-review 规则检查权限、集合、函数类型和 SDK 使用
  - _Requirements: R1–R10_

- [ ] 11. 执行受控环境上线（需单独确认）
  - 分别生成并托管 production/development 独立 Registry 私钥
  - 创建集合、索引和 ADMINONLY 权限并部署管理函数
  - seed、发布、导出首个签名快照并提交公钥信任锚
  - 先发布验证方，再开启 shadow，完成 match/故障/篡改/回滚 smoke
  - _Requirements: R4, R6, R7, R8, R9, R10_
