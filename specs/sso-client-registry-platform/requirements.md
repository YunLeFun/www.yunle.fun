# SSO Client Registry 平台化需求

状态：Confirmed（2026-08-03）
阶段：P1（管理源、发布快照与影子验证）

## 1. 背景

当前 Client Registry 是 `@yunlefun/authorization-core` 中的类型安全静态快照。新增或调整客户端时，需要修改代码、更新测试并重新部署主站、`sso-ticket` 与可能使用同一 Registry 的授权函数。

静态快照具备易审计、原子发布和失败关闭等安全优势，但随着 Web、静态页面、BFF 和桌面客户端增加，重复改代码和多处部署会成为维护瓶颈。

生产 CloudBase 环境 `yunlefun-8g7ybcxc7345c490` 当前以 NoSQL 为主后端，没有 PostgreSQL。P1 应复用现有 NoSQL，不为 Registry 单独引入新的数据库产品。

## 2. 目标

1. 让 CloudBase NoSQL 成为 Registry 的受控管理源。
2. 将每次发布固化为不可变、可验证、可回滚的版本化快照。
3. 保留现有静态 Registry 作为 P1 的唯一授权裁决源。
4. 让授权运行时以缓存方式读取已发布快照并执行影子比对，不在单次授权请求中实时查询数据库。
5. 为后续后台管理、审批流以及把动态快照升级为正式裁决源建立稳定边界。

## 3. 非目标

- P1 不提供客户端自助注册或第三方开放平台。
- P1 不新增运营后台页面，也不改变现有管理员角色体系。
- P1 不让数据库快照直接改变线上授权结果。
- P1 不移除仓库内的 production/development 静态 Registry。
- P1 不存储 OAuth client secret、CloudBase 私钥、签名私钥或用户凭据。
- P1 不改变 `@yunlefun/sso`、PKCE、nonce、一次性授权码和身份断言协议。

## 4. 角色

- **Registry 维护者**：创建和修改待发布配置，填写变更原因。
- **Registry 发布者**：校验并发布快照，身份必须进入审计记录。
- **授权运行时**：消费编译期静态 Registry，并对已缓存的平台快照做影子比对。
- **发布流水线**：验证数据库活动快照、仓库快照和生成产物是否一致。

P1 可以由同一受信任人员同时承担维护者和发布者；双人审批留到后续阶段。

## 5. 功能需求

### R1. 统一 Registry Schema

平台 Schema 必须完整表达现有 `ClientRegistrySnapshot`：

- environment、issuer、schemaVersion、policyVersion
- clientId、appId、displayName、iconUrl、status
- adapter kind、consent、allowedScopes、origins、redirectUris

同一份 Schema 必须同时用于数据库写入校验、发布校验、生成产物和运行时读取校验。

### R2. 草稿管理

系统必须允许受信任的维护者创建或更新草稿，但草稿不得被授权运行时视为活动策略。

草稿至少记录：

- 基于哪个已发布版本创建
- 创建者、最后修改者、时间和变更原因
- 完整 Registry 内容
- Schema 校验结果

### R3. 安全校验

发布前必须校验：

- `clientId` 在同一环境内唯一
- production/development issuer 严格隔离
- Web Origin 与 redirect URI 为精确 URL，不接受通配符
- production Web Origin 与 redirect URI 必须使用 HTTPS
- Web SSO 客户端必须声明同源、绝对 HTTPS `iconUrl`
- scope、adapter、consent 和 status 只能使用 Schema 允许值
- 未注册、停用或越权配置继续失败关闭

### R4. 不可变发布快照

发布成功时，系统必须原子生成一个不可变快照，并更新该环境的活动版本指针。

快照至少包含：

- 唯一 snapshotId
- environment、schemaVersion、policyVersion
- 规范化后的 Registry 内容
- 确定性的 contentHash
- 使用独立 Registry 签名密钥生成的 signature 与 keyId
- 发布者、发布时间、变更原因和来源草稿

已经发布的快照内容不得原地修改；后续变更必须产生新版本。

### R5. 可复现产物

给定同一份活动快照，发布工具必须生成字节稳定、顺序确定的 Registry JSON 产物。仓库构建和云函数 vendoring 必须能够消费同一产物，避免主站、`sso-ticket` 和 `desktop-auth` 出现不同白名单。

### R6. P1 影子比对

P1 中，静态 Registry 必须继续决定所有授权结果。

授权运行时必须：

- 在冷启动或有界 TTL 到期时读取活动平台快照，而不是每个请求查询数据库
- 校验 Schema、contentHash、signature、environment 和 issuer
- 将平台快照与静态 Registry 的规范化内容进行比对
- 对一致、漂移、不可用、签名错误和版本回退输出结构化安全事件
- 在任何平台快照异常时继续使用静态 Registry，不放宽授权

### R7. 回滚

发布者必须能够把活动指针切回一个历史有效快照。回滚不得修改历史快照内容，并必须记录操作者、时间、原因以及前后版本。

### R8. 权限与数据边界

Registry 草稿、快照、活动指针和审计记录必须是 server-only 资源，浏览器和普通登录用户不得直接读取或写入。

公开应用探索页继续使用构建产物中的公开字段，不直接连接 Registry 数据库。

### R9. 兼容性

迁移种子数据必须覆盖当前 production/development 客户端。生成后的授权安全字段和 registration fingerprint 必须与迁移前一致；展示顺序变化不得改变授权语义。

### R10. 可观测性与切换门槛

系统必须能统计：

- 活动 policyVersion 与 snapshotId
- 最近一次成功加载时间
- 静态/平台快照是否一致
- 加载、校验、签名或回滚失败次数

P1 不得自动切换到动态裁决。只有在另一个经确认的阶段中，满足持续无漂移、故障演练和回滚演练后，才能考虑把平台快照升级为正式裁决源。

## 6. EARS 验收标准

1. 当维护者保存合法配置时，系统应创建或更新草稿，并且活动快照保持不变。
2. 当草稿包含重复 clientId、通配 Origin、非精确 redirect URI、非法 scope 或 production HTTP URL 时，系统应拒绝发布且不得改变活动指针。
3. 当发布者发布合法草稿时，系统应原子创建不可变快照、写入签名与审计信息，并把对应环境的活动指针指向新快照。
4. 当同一活动快照被重复生成时，发布工具应输出内容和 contentHash 完全一致的 Registry 产物。
5. 在 P1 期间，当授权请求到达时，授权运行时应始终使用编译期静态 Registry 做裁决。
6. 当缓存 TTL 到期时，授权运行时应至多触发一次平台快照刷新，并复用刷新结果处理并发请求。
7. 当平台快照与静态 Registry 完全一致时，系统应记录一致状态且不改变授权响应。
8. 当平台快照与静态 Registry 不一致时，系统应记录包含环境、版本和哈希的漂移事件，并继续使用静态 Registry。
9. 当数据库不可用、快照 Schema 无效、签名无效或版本回退时，系统应继续使用静态 Registry、记录失败事件且不得放宽授权。
10. 当发布者执行回滚时，系统应原子切换活动指针并新增回滚审计记录，不得修改任一历史快照。
11. 当普通浏览器用户访问 Registry 集合时，CloudBase 权限规则应拒绝直接读取和写入。
12. 当迁移种子完成时，现有 production/development 客户端的授权决定与 registration fingerprint 应保持不变。
13. 当 CI 检测到仓库静态 Registry、活动平台快照或生成产物不一致时，CI 应失败并指出环境与版本差异。

## 7. P1 完成定义

- Requirements、Design 和 Tasks 文档均已确认。
- NoSQL 集合、索引和 server-only 权限已准备。
- Schema、规范化、签名、发布、回滚和生成工具具备自动测试。
- 当前静态 Registry 已安全导入并发布为首个 production/development 平台快照。
- `sso-ticket` 与 `desktop-auth` 已启用影子加载与结构化漂移事件，但授权仍由静态 Registry 决定。
- 全量 lint、typecheck、test、build 和 CloudBase 代码审查通过。
- 生产验证覆盖快照加载、无漂移、数据库不可用回退和签名失败回退。
