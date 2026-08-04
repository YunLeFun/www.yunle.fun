# SSO Client Registry 静态发布自动化需求

状态：Confirmed（2026-08-03）

阶段：P1.1（生产邮件审批与静态产物自动发布）

前置阶段：`../sso-client-registry-platform/`

## 1. 背景与决策

P1 已实现 NoSQL 草稿、严格 Schema、不可变签名快照、generated JSON、影子验证与回滚边界。当前 Registry 约 12 个客户端、生产 generated JSON 约 6.9 KiB；没有必要为了免部署而把数据库引入授权关键路径。

P1.1 继续让 generated 静态 JSON 成为唯一生产授权裁决源。管理平台负责草稿、校验、差异、审批、签名快照和审计；production 审批通过后，由受保护 CI 自动生成确定性 JSON、完成验证并部署到静态消费者。

动态运行时方案 `../sso-client-registry-dynamic-runtime/` 延期，不进入本阶段。

## 2. 已确认目标

1. production 与 development 的授权函数继续只读取编译期 generated JSON。
2. 管理平台继续保存草稿、执行严格 Schema 校验、生成 security/display 差异并记录审计。
3. production 变更必须向管理员不可变 CloudBase uid 对应的当前已验证邮箱发送一次性审批码。
4. 审批通过后创建不可变签名快照和发布意图，并自动触发受保护 CI。
5. CI 从已批准快照确定性生成 JSON，运行测试和构建，通过后合并并部署准确的提交。
6. 保留快照签名、版本、rollback、shadow compare 和静态生成产物。
7. 暂缓动态缓存、租约续签、防重放水位和公开动态投影。

## 3. 非目标

- 不让数据库、邮件或 CI 结果直接参与单次授权请求。
- 不提供无需部署即可改变生产授权策略的能力。
- 不允许浏览器读取管理集合或调用发布、审批、部署回执接口。
- 不在 CloudBase 函数中保存个人 GitHub PAT、仓库管理员密码或 SSH 私钥。
- 不通过邮件 GET 链接执行批准，避免安全扫描器误触发。
- 不在本阶段建设新的可视化管理页面；已有私有 Event Function 与运维 CLI 是管理入口。
- 不承诺多项云函数与主站部署之间具备分布式原子性。

## 4. 角色与信任边界

- **维护者**：保存草稿、查看差异并请求审批；必须使用受保护管理凭据。
- **审批者**：由不可变 CloudBase Auth uid allowlist 标识；邮箱只用于当前通知与第二通道确认。
- **Registry 管理函数**：校验、签名、消费审批并创建发布意图，不持有生产部署权限。
- **CI Dispatch 身份**：限单仓库、最小权限的 GitHub App，不使用个人 PAT。
- **受保护 CI**：验证批准意图和签名，生成产物、创建发布 PR、运行检查并部署。
- **授权运行时**：只消费随构建部署的 generated JSON，不读管理数据库或审批状态。

初始审批者展示名为 `YunYouJun`，当前邮箱示例为 `me@yunyoujun.cn`；二者均不得作为运行时授权主键或硬编码到快照/仓库中。

## 5. 功能需求

### R1. 静态唯一裁决

`sso-ticket`、`desktop-auth` 与主站公开应用配置必须继续消费仓库内 generated JSON。production 管理快照发布成功但对应提交尚未部署时，线上授权结果必须保持不变。

运行时不得新增逐请求 Registry 数据库读取、远程配置读取或动态 fallback。

### R2. 草稿、校验与差异

草稿管理继续复用 P1 严格 Schema、规范化和 hash。请求 production 审批前，系统必须生成并固化：

- baseSnapshotId、baseGeneration 和仓库 baseCommitSha
- policyVersion、client 数量、contentHash 与 securityHash
- 新增、修改、停用客户端清单
- scope、Origin、redirect URI、status 等 security diff
- displayName、iconUrl、顺序等 display diff
- 请求者、变更原因和 CloudBase RequestId

审批期间草稿、base、hash 或 baseCommitSha 任一变化都必须使原审批失效。

### R3. 生产邮件审批

production 发布必须分为 `requestPublishApproval` 和 `approveAndQueueRelease` 两个动作。development 可以跳过邮件审批，但仍必须保存操作者、原因、hash 和审计。

审批码必须：

- 使用至少约 60-bit 的密码学安全随机值
- 30 分钟有效、单次使用、最多 5 次失败尝试
- 只在数据库保存独立服务端 pepper 生成的 HMAC/MAC
- 不进入函数响应、日志、审计详情或 URL
- 在同一事务中校验并消费，成功重试保持幂等

邮件必须通过现有腾讯云 SES 事务邮件通道发送；投递失败不得排队 production 发布。

### R4. 审批身份与邮箱解析

审批权限必须使用配置的 CloudBase Auth 不可变 uid allowlist。每次请求审批时，管理函数必须通过管理 API 读取该 uid，并且：

- 精确返回唯一且 uid 匹配的用户
- 只接受 `EmailVerified === true` 的合法邮箱
- 对缺失、未验证、重复或查询异常失败关闭
- 数据库只保存 approverUid、recipientHash 与脱敏邮箱

管理员换绑并验证新邮箱后，下一次审批必须自动发送到新邮箱，无需改代码或重新部署。

### R5. 不可变快照与发布意图

审批成功必须在事务中：

- 消费审批记录
- 创建或确认 P1 不可变签名快照与递增 generation
- 创建绑定 approvalId、snapshotId、hash、baseCommitSha 的签名发布意图
- 写入待分发 outbox 与审计

外部 CI 调用不得位于数据库事务内。发布意图状态至少区分 `approved`、`dispatched`、`pr_open`、`merged`、`deploying`、`deployed`、`ci_failed`、`deployment_failed` 和 `superseded`。

“审批成功”“管理快照已发布”和“线上已部署”必须是三个不同状态。

### R6. CI 自动生成与合并

CI 只能接受 releaseIntentId，不能接受任意 Registry 正文、snapshotId 或目标提交作为可信输入。CI 必须重新取得并验证签名发布意图与快照，然后：

1. 检出发布意图绑定的 baseCommitSha。
2. 确认默认分支仍位于该 base；不一致时标记 superseded 并要求重新审批。
3. 确定性生成目标环境 JSON 与独立 release manifest。
4. 断言只修改允许的 generated/release 文件。
5. 运行 lint、typecheck、全量 test、build 和 Registry compare。
6. 创建仅包含生成产物的发布 PR，并在 required checks 通过后自动合并。

提交信息必须遵循 Conventional Commits，例如 `chore(sso-registry): publish production policy <version>`。

### R7. 受保护生产部署

production 部署只能从受保护默认分支上的准确 merge commit 执行。部署工作流必须：

- 绑定 GitHub `production` Environment 和单一 production concurrency group
- 在取得环境 secrets 前使用仓库公钥验证 release manifest、快照签名、commitSha 与允许文件范围
- 取得专用环境 secrets 后查询发布意图，并再次确认 approval、intent 与 merge commit 精确匹配
- 从同一提交构建主站、`sso-ticket` 与 `desktop-auth` 所需产物
- 按安全差异确定优先顺序，并记录每个消费者的实际版本/commitSha
- 完成 SSO、desktop 和公开探索页 smoke 后才写入 deployed 回执
- 任一步失败时保留准确的部分部署状态、停止后续非必要步骤并告警

邮件审批是 Registry 内容批准，不替代 Deployment Gate、分支保护、required checks 或 smoke。

### R8. 回滚与故障恢复

常规 production rollback 必须选择历史有效签名快照，创建更高 generation 的发布意图，并经过同一邮件审批和 CI 部署路径。

紧急情况下可以从最后已部署且验证成功的 exact commit/artifact 执行 break-glass 重部署，但必须记录操作者、原因、目标版本、影响范围并立即告警；不得修改历史快照或清除审计。

CI dispatch、PR、合并、部署回执均必须按 releaseIntentId 幂等重试。

### R9. Shadow 与一致性

P1 shadow observer 保留，但只用于比较。已批准、尚未部署的快照与当前静态 Registry 不一致时，应分类为 `pending_release`，不得误报为未知安全篡改。

部署完成后，仓库 generated JSON、发布意图、活动平台快照和已部署消费者的 contentHash/securityHash 必须一致；CI 或 smoke 发现不一致时不得标记 deployed。

### R10. 性能与成本边界

正式授权热路径不得增加数据库、邮件或 CI 依赖。静态 Registry 在实例初始化时解析并构建 Map/Set；普通授权保持 O(1) 查询。

新增云成本仅在草稿、审批、发布、CI dispatch、shadow 和部署时产生。邮件与 CI 失败重试必须有次数、退避和幂等限制。

### R11. 审计与隐私

草稿、审批请求、邮件投递、审批消费、快照发布、dispatch、PR、合并、部署、失败与回滚必须可按 releaseIntentId 串联。

日志和审计不得包含完整邮箱、审批码、Registry 签名正文、私钥、GitHub App 私钥或 CloudBase/CI 凭据。完整 Registry 正文只存在于草稿、不可变快照和 generated 产物，不复制进普通日志。

## 6. EARS 验收标准

1. 当任意授权请求到达时，授权运行时应只使用随当前部署携带的 generated JSON 裁决。
2. 当 production 草稿通过校验并请求审批时，系统应向配置 uid 当前已验证邮箱发送一次性码，且响应和日志不包含该码。
3. 当 Auth 邮箱未明确验证、uid 不匹配或查询不唯一时，系统应拒绝创建可消费审批。
4. 当审批码错误达到 5 次、过期、已消费或绑定内容发生变化时，系统应拒绝发布且不得创建新的发布意图。
5. 当合法审批码被消费时，系统应原子创建签名快照、发布意图、outbox 与审计，并保持幂等。
6. 当外部 dispatch 失败时，系统应保留 approved 意图并有界重试，不得回滚或重复消费审批。
7. 当 CI 被 releaseIntentId 触发时，CI 应重新验证签名和 baseCommitSha，且不信任事件中的 Registry 正文。
8. 当默认分支已经偏离审批绑定的 baseCommitSha 时，CI 应把发布意图标记为 superseded 并停止生成、合并和部署。
9. 当 CI 生成产物时，输出应与同一快照的本地确定性导出字节一致，并且 diff 只包含允许文件。
10. 当 required checks 失败时，发布 PR 应保持未合并，production 部署不得开始。
11. 当发布 PR 合并时，部署应只使用该 merge commit，并在全部 smoke 成功后标记 releaseIntent deployed。
12. 当某个消费者部署失败时，系统应记录已成功和失败的消费者版本，停止标记 deployed 并支持从同一提交幂等重试。
13. 当常规 rollback 被请求时，系统应对历史快照执行同一 production 邮件审批、生成、检查和部署流程。
14. 当 shadow 比较到待部署的已批准快照时，系统应记录 pending_release；部署完成后应恢复 match。
15. 当管理员换绑已验证邮箱时，下一次审批应发送到新邮箱且无需代码变更。
16. 当 Registry 客户端数量增长时，普通授权应继续通过预构建 Map/Set 查询，不遍历数据库或远程 Registry。

## 7. P1.1 完成定义

- Requirements、Design 与 Tasks 均已确认且可追溯。
- production 管理入口不再允许无邮件审批直接发布。
- 审批 uid 已唯一解析，严格验证邮箱并通过 SES acceptance。
- 发布意图、outbox、CI dispatch、生成 PR、required checks、自动合并与部署回执均具备幂等测试。
- development 完成成功、过期、锁定、stale base、CI 失败、部分部署和 rollback 演练。
- production Deployment Gate、环境 secrets、分支保护、concurrency 与回退路径已单独确认。
- 现有客户端授权结果与 registration fingerprint 不变。
- 全量 lint、typecheck、test、build、CloudBase code review 和 production smoke 通过。
