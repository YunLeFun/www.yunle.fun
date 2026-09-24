# Registry 变更提案：cms-desktop

- 状态：飞书审批、签名发布及三个生产消费者部署均已成功；生产旧索引已迁移，设备授权入口 smoke 通过，完整真实登录生命周期尚未验收
- 用户在 2026-09-22 确认启动 `cms-desktop` 生产 SSO 审批流程；该确认不代替 Registry 的飞书／邮件审批凭据
- Client：`cms-desktop`；服务端派生 App：`cms`；显示名称：云栈
- Adapter：`device`；Scope：仅 `membership:read`；Consent：`explicit`
- Electron 主进程接入现有 `desktop-auth`，不复用 `skykeeper-desktop` / `cms-web`
- 不新增 Web Origin、回调、云币权限、内容同步权限或通用访问令牌

客户端声明保存在同目录 `2026-09-22-cms-desktop.client.json`，并有双环境离线授权测试。
保留现有签名 generated Registry 不变，不伪造审批记录，也不把提案混入运行时。

## 2026-09-22 启动记录

- 已核对远端 `main`：`0d641be55c0bc0a1fb2d68375e0f9a6293804a64`。当前工作区 HEAD 较旧，未覆盖工作区或已有签名产物。
- 候选快照：[production-cms-desktop.json](../drafts/production-cms-desktop.json)，基于远端已签名 production Registry（policy `2026-09-03.1`、generation `12`、snapshot `production:12:1e0d176e14db7490de7e`）生成。
- 候选 policy：`2026-09-22.1`，20 个客户端；验证仅 policy version 与新增 `cms-desktop` 发生变化，其他客户端声明保持一致。
- Content hash：`15247d0902e83b0d8bfffdd927e5445036895aeea4948912becd0b116f0dadc5`。
- Security hash：`e2f045e80c3f0a600bc8a46dd5797e4862f65f530bac7dcfc687c325b497ae8d`。
- 本地 Registry 验签／schema 校验通过，注册提案与 desktop client registry 共 4 项测试通过。
- GitHub production release/deploy 开关查询结果为 `true`。用户恢复生产环境 `yunlefun-8g7ybcxc7345c490` 的管理登录后，已验证管理面活动快照签名，并确认其与上述远端 `main` 签名产物完全一致。
- Draft ID：`draft:PNhsWXs8XzfdVp6j`。管理面校验通过；远端 diff 的 `added` 仅包含 `cms-desktop`，`modified`、`removed`、`securityChanged`、`displayChanged` 均为空，新增设备权限仅为 `membership:read`，consent 为 `explicit`。
- Approval ID：`approval:PRY_4wrfBJU8pPgs`；请求回执 `status=pending`、`channel=feishu`，绑定上述完整 `main` SHA。
- 审批有效期截至 **2026-09-22 13:14:50（Asia/Shanghai）**，对应 `expiresAt=1790054090399`。请由审批者在飞书卡片中处理；邮件仅作为现有流程的降级通道。
- 审批申请已发起不代表授权运行时已生效。尚需批准、签名 release intent、CI 发布／部署与线上 smoke；若审批过期或 `main` 前移，应重新核对证据并按既有流程请求新的审批。

## 批准与派发记录

- 用户已在飞书点击批准；权威审批记录为 `status=consumed`、`channelStatus=terminal`，卡片终态同步记录为 `cardSync.status=sent`、attempts `1`。
- 决定提交时间 `1790052390529`，后台消费时间 `1790052420940`，约 31 秒；点击后的“正在处理”属于异步消费阶段，本次未观察到 Admin 审批失败。
- 管理快照：`production:13:15247d0902e83b0d8bff`，policy `2026-09-22.1`；其内容与候选快照哈希一致。
- Release intent：`release:production:13:l9MDpwRcwJPSebxm`；outbox `status=sent`、attempts `1`。
- GitHub 发布工作流：[35688254710](https://github.com/YunLeFun/www.yunle.fun/actions/runs/35688254710) 成功；仓库校验包括 195 个测试文件、1196 项测试，全部通过。
- 自动生成的 [PR #117](https://github.com/YunLeFun/www.yunle.fun/pull/117) 已合并，merge commit 为 `5a4a6e14b6391fbf4ae7179028353fb0ad4b1ed3`。
- [生产部署工作流 35688793296](https://github.com/YunLeFun/www.yunle.fun/actions/runs/35688793296) 成功；release intent 已回读为 `deployed`，`desktop-auth`、`sso-registry-admin`、`sso-ticket` 三个消费者均确认上述同一提交，`failureCode=null`。
- 修正此前的界面判断：早前误把历史终态卡片当作本次结果。2026-09-22 再次核对时，12:44 的本次卡片仍显示“正在处理”。Admin 初始／回调卡片使用 `update_multi=false`，与后台 `im.message.patch` 的共享卡片要求冲突。
- [Admin PR #32](https://github.com/YunLeFun/admin/pull/32) 已修正为共享卡片并合并；生产 EdgeOne 部署 `dp2tvlrn5lgp` 为 `Success` / `UsedInProd=true`，提交 `b50c5c8399759cf6e9894a2ff6261e64116c70ff`。已通过原有签名内部接口为本次审批重新发送 `consumed` 终态，返回成功；接收端最终显示仍待解锁 Mac 后核对，不以发送回执代替目视验证。
- [Admin PR #33](https://github.com/YunLeFun/admin/pull/33) 为初始、处理中及所有终态卡片补齐 SSO 客户端、变更摘要、策略版本、原因、审批编号和三个跳转入口。35 项相关测试、typecheck、lint 与 CI 检查通过；生产部署 `dpumsrl4f5km` 为 `Success` / `UsedInProd=true`，提交 `cb9d3bc48209e96c1affe94a73f371eefeb75f53`。
- 已通过原有签名内部接口补同步本次原消息，并在飞书界面核实 **12:44** 的卡片显示“已批准，发布流程已创建”、`cms-desktop`、`membership:read`、策略 `2026-09-22.1` 及三个按钮。点击“查看本次审批”后，浏览器成功显示 `approval:PRY_4wrfBJU8pPgs` 的详情，状态 `consumed`、通道 `feishu · terminal` 与变更摘要一致。
- 随后按用户反馈精简展示：[Admin PR #34](https://github.com/YunLeFun/admin/pull/34) 已合并，生产部署 `dpalydg6ft3t` 为 `Success` / `UsedInProd=true`，提交 `44cbe9c54192ffdc1fcb59baad3e7451dce3f151`。35 项相关测试、typecheck、lint 与 CI 检查通过。原卡片已补同步，并在飞书实测确认状态进入标题、环境与版本双列展示、单个详情按钮及页脚链接；编号、哈希和客户端总数移至详情页，关键变更说明仍可见。

## 部署后设备授权检查

- 使用 CMS 实际账号协议生成临时安装密钥，向生产 `desktop-auth` 请求 `cms-desktop` / `membership:read`，连续两次均返回 HTTP 400 `DATABASE_REQUEST_FAILED`；未执行账号批准、换取 token 或刷新操作。
- CLS 日志明确给出：`E11000 duplicate key error collection: tnt-2la6mncfo.desktop_device_codes index: uniq_userCode dup key: { userCode: null }`。当前服务端只写入 `userCodeHash`，旧明文 `userCode` 的非稀疏唯一索引与新数据模型冲突。
- 只读检查：集合共 6 条记录，5 条缺少 `userCodeHash`，1 条有 hash 且缺少 `userCode`；没有非字符串 hash 或重复 hash。`expiresAt > now` 的新格式记录数量为 0。
- 用户随后明确批准共享生产索引迁移；已创建并验证 `uniq_userCodeHash` 唯一稀疏索引，再移除旧 `uniq_userCode`。原有 6 条记录、其它索引和 `PRIVATE` ACL 均保留。连续两次实际 CMS 设备授权成功、保持 pending，错误安装密钥和超额 scope 被拒绝；再次只读检查 `ready=true`、`plan=[]`，8 条记录含 2 条临时 smoke 授权。
- [Provider PR #118](https://github.com/YunLeFun/www.yunle.fun/pull/118) 已合并至 `06481d564211adf84593e20b743464634b7acafa`，增加可重复迁移及两条部署路径的只读前置检查。CI 的 lint、typecheck、1205 项测试与 build 全部通过。详细证据及回退限制见 [索引迁移记录](2026-09-22-desktop-auth-index-migration.md)。

## 后续发布流程

1. 更新基线，执行 `pnpm build:authorization-core`。
2. 在签名 generated Registry 已与当前远端及管理面核对一致的工作区，使用 `node scripts/prepare-cms-desktop-registry.mjs production <新-policy-version>` 生成完整候选快照（stdout）。脚本只读本地配置，不访问管理平面，不覆盖文件；development 同理。不要直接用当前旧工作区重新生成并覆盖上述候选快照。
3. 用现有 `sso-registry.mjs validate` 校验候选快照，再按 Registry 管理流程保存草稿、查看 security diff、请求 production 飞书／邮件审批；请求必须绑定届时的完整 `main` SHA。
4. 由受保护 CI 导出带签名的 generated Registry / release manifest，合并准确提交并部署静态消费者。不得手改已有签名文件。
5. 验证 `desktop-auth` 与 `/link` 展示云栈，DPoP 绑定、拒绝/超时、轮换刷新、服务端设备撤销；再用签名客户端进行真实登录 smoke。

现阶段 entitlement 仅提供签名的用户 ID 与会员状态，不提供昵称/头像查询、CMS 云端会话或内容同步。后续云能力需单独设计服务端会话桥接与最小权限，不能将 entitlement 当作通用 Access Token。
