# SSO Client Registry 动态裁决技术搁置记录

状态：Deferred（2026-08-03）

对应决策：`requirements.md`

当前设计：`../sso-client-registry-static-release/design.md`

## 当前架构边界

```text
管理平台草稿 / 审批
          ↓
签名快照与 generated JSON
          ↓
        CI 验证
          ↓
授权函数构建期加载 → Map 索引 → 生产裁决

CloudBase 活动快照 ──shadow only──> 差异与告警
```

- `authorization-core` 拥有 Schema、规范化、hash、签名验证和 O(1) 授权索引。
- `sso-registry-admin` 只处理草稿、快照、审计与受门禁的发布意图。
- `sso-ticket`、`desktop-auth` 只由 generated JSON 裁决；shadow adapter 不得替换授权核心。
- CI 是 production 产物进入运行时的唯一部署通道。
- 代码内信任锚、签名快照和历史版本保留回滚能力。

## 已搁置的动态设计

早期方案考虑过签名活动指针、短期租约、实例内单调水位、single-flight 缓存、last-known-good 窗口、显式 break-glass 以及公开投影服务。它们相互依赖，不能只挑选其中一部分上线：

- 没有租约和水位，冷实例可能接受被重放的旧活动指针；
- 没有缓存与一致性加载，数据库会进入逐请求授权热路径；
- 没有完整故障策略，动态失败可能意外放宽或阻断授权；
- 没有独立公开投影，前端接口可能泄露 redirect、scope 或管理字段；
- 没有可观测性和演练，免部署更新会把代码发布风险转成持续运行风险。

因此当前不保留伪代码、集合结构、TTL 数值或上线步骤，避免它们被误认为已确认设计。需要复评时应基于当时的 CloudBase 能力、流量、成本和威胁模型重新设计。

## 将来复评的最低门槛

重新启动动态裁决前，新的设计至少必须覆盖：

1. 签名活动状态、全新实例防重放与合法回滚的统一模型；
2. 冷启动、缓存、并发刷新、数据库故障和过期快照的失败语义；
3. production 已验证邮箱审批与幂等发布事务；
4. 授权数据与公开展示投影的严格分离；
5. 容量上限、读取成本、SLO、告警、演练和显式静态应急路径；
6. development 验证和 production shadow 观察后的独立切换审批。

在这些条件重新确认前，不创建动态运行时模块、公开接口或租约续签任务。
