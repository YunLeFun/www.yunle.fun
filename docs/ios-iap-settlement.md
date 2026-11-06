# 原生 IAP 账号归属与原子发放

2026-10-18 本地候选补丁。基线 `3f7ff5d0be186ff1e54f3fc6666fa31b959152e2`；尚未部署，未使用真实交易或修改线上数据。

2026-11-06 状态更新：正式支付入口已更新，详见文末上线记录。下文的“本地候选 / 尚未部署”描述保留当时的验证阶段；独立 Sandbox 入口及其端到端验收仍待完成。

## 服务契约

`iap-order` 保留 Event Function、现有 `verifyPurchase` / `restore`、商品标识与会员自然月计算。用户仍由 CloudBase 的调用上下文认证，并经过账号状态与合成账号检查。客户端只传交易 ID，Apple 官方库验签后得到的交易内容才进入发放函数。

签名交易存在 `appAccountToken` 时，必须与已认证 UID 对应的标记一致。算法与原生 `PurchaseAccountToken.forUser` 相同：对 UTF-8 字符串 `fun.yunle.apps.iap-owner.v1`、一个 NUL 和 UID 求 SHA-256，取前 16 字节，设置 UUID v8 / RFC variant，再按 UUID 格式输出。UUID 大小写不影响匹配；空值、无效值、其他 UID 的标记拒绝，且不会创建订单。它是账号关联标记，不代替 CloudBase 身份验证或 Apple 验签。参见 [Apple appAccountToken](https://developer.apple.com/documentation/appstoreserverapi/appaccounttoken)。

旧签名交易没有该字段时保留首次领取规则，订单写明 `legacy-first-claim`。这不能证明历史购买发生时的应用账号；一旦绑定，其他账号不能重新领取。不能把旧交易缺标记当作“服务端已经验证原始购买账号”。

## 原子边界与失败恢复

- 新订单使用稳定的 `orders._id = iap_<transactionId>`。历史随机 ID 先按 `outTradeNo` 定位，再在事务内重新读取并核对归属、商品、环境与会员购买时间；重复历史订单直接拒绝，保留待人工核对。
- 历史订单缺少 `meta.bundleId` 时，仅在重新核对 Apple 已验签交易且已有订单身份一致后，在同一事务内补齐；保留原文档 ID 和其他历史字段。已发放订单的重试只补应用标识，不重复发放或改写 `paidAt` / `grantedAt` / 退款快照。未重新验单或身份冲突的旧订单仍不能自动退款；旧会员没有可靠退款快照时继续转人工核对。
- IAP 会员或云币发放与订单 `paid`、`grantedAt`、`iapSettlementVersion: 1` 在同一事务提交。云币的余额与充值流水也在该事务中；没有嵌套事务。会员退款前后快照随订单一起提交。
- 响应丢失后，相同交易返回 `alreadyProcessed`；最终凭据写入失败时，权益变更回滚。不会仅凭 `status: paid` 告知客户端可以结束交易。
- 旧 `paid` 云币订单通过既有充值流水补齐凭据，不重复入账。旧会员订单仅在当前会员 `lastOrderId` 仍匹配时补凭据，不延长有效期，也不编造购买前退款快照；缺少可靠证据则返回人工核对错误。不能自动重放所有旧会员订单。
- 微信 `queryOrder`、`reconcileOrders` 与通用发放函数不再发放 IAP；IAP 必须走重新核对 Apple 交易的路径。微信自身的分步补发机制不在本次原子改造范围内。

事务内只使用按文档 ID 的读取、`set` 和 `update`；查询历史 ID 在事务外，实际授权和金额依据在事务内重读。写入剔除 `_id`，检查 SDK 返回的 `code`。对照 [CloudBase Node SDK 事务文档](https://github.com/TencentCloudBase/node-sdk/blob/master/docs/database/database.md)；本地回滚夹具并不能证明远端事务配置、隔离级别或冲突重试实测通过。

## 验证与上线前提

本地回归覆盖跨账号并发首次领取、同账号并发重放、两个会员订单叠加、凭据写入失败回滚、响应丢失、SDK 错误码、旧订单与旧会员文档、退款及微信入口隔离。Swift 原生实现与 Node 实现分别执行 `alice`、`bob`、`测试账号-1` 三组标记，结果逐项一致。

部署前仍须完成：

1. 在隔离测试账本验证实际 CloudBase 事务、并发冲突、失败回滚、索引和仅服务端可写权限。根据后续方向，可以复用既有 CloudBase 环境，但须使用下节的独立函数、测试集合和测试 UID；环境内的计算资源、管理员权限仍共享。正式结算部分复用现有集合，本地补丁尚未创建云端资源或修改权限。
2. 只读盘点重复 `outTradeNo`、旧 `paid` 无 `grantedAt`、重复钱包 / 会员 / 流水记录。无法确定归属和是否已发放的记录进入人工核对，不自动删除或合并。
3. 暂停并排空旧版 IAP 请求及会修改 IAP 的旧补发实例，协调更新 `iap-order` 和微信入口保护；执行 `node scripts/sync-wxpay-lib.mjs --check`，部署包使用同步后的库。混跑旧随机建单实现不满足本补丁的唯一订单前提。
4. 完成 Apple Sandbox 配置、测试账号、账本和原生查询端点的隔离后，才能执行真实 Sandbox 购买、恢复、退出换号、撤销与退款。Server API 的 Production → Sandbox 回退用于识别和验签；正式权益库的发放和退款均拒绝 Sandbox，详见下节。以下测试服务仍是本地候选，尚未联通云端与客户端。
5. 取得隔离环境证据及上线授权后再部署。当前没有生产部署、TestFlight 或提审操作。

回退时应先停止 IAP 请求并保留数据库快照；不要直接恢复会随机建单或通过微信补发 IAP 的旧实例。已提交的新凭据与订单应保留，回退方案不能依靠删除付款记录。

## Sandbox 正式权益保护 · 2026-10-18

在 `ffaabaa` 后补充结算边界：Apple 验签结果必须明确声明 `Production`，且与查询环境相同，才可以进入当前正式钱包 / 会员的发放；缺失、未知或不一致的环境拒绝。`Sandbox` 返回 `IAP_ENVIRONMENT_UNSUPPORTED`，`verifyPurchase` 失败、`restore` 对应项为 `ok: false`，客户端不能据此结束真实交易。环境不能由客户端参数或开关覆盖。Apple 在 [JWSTransactionDecodedPayload](https://developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload) 中定义签名交易的 `environment`。

退款同样先检查签名交易环境，再检查已有订单的支付方式、环境和 bundle ID。相同交易 ID 的 Sandbox 通知不能回滚正式订单，历史环境缺失或应用不匹配的订单保留原状并要求人工核对。通知端不再把缺失环境默认为 Production；通知与交易环境必须一致。已完成验签且环境一致的 Sandbox 退款通知返回 200 并明确标记忽略，不反复重试、不更改权益。正式交易的退款重试机制保留。

本地 12 个新增结算边界用例在旧实现上全部失败，修复后通过；完整支付回归为 **21 文件 / 312 项通过 / 0 失败 / 0 跳过**，包含 7 个函数入口新增用例，以已验签载荷服务替身和内存数据库执行实际 `iap-order` / `appstore-notify` 入口。覆盖购买、恢复、合成账号禁止、正式发放与退款、Sandbox 同 ID 退款、缺失环境和跨环境通知。不是 Apple 在线验签、真实数据库或 Sandbox 购买证据。首次 pnpm 命令被共享依赖目录保护拒绝，改用现有 Vitest 执行；原失败日志保留。

此候选尚未部署。当前正式端点仍不能用来验收 Sandbox；App Review 的测试权益也需独立设计和验证，不能以本保护通过宣称已满足审核购买流程。

## 同一 CloudBase 环境内的 Sandbox 候选

`iap-order/sandbox.js` 与 `appstore-notify/sandbox.js` 是独立测试入口源码。使用 `node scripts/package-iap-sandbox.mjs <新的输出目录>` 离线打包为 `iap-order-sandbox/index.js` 和 `appstore-notify-sandbox/index.js`。脚本只复制入口、权威共享库、Apple 公共根证书及依赖清单，生成 SHA-256 清单，不读取 `.env`、密钥或调用部署工具。它不会修改现有 `cloudbaserc.json` 或正式函数。不要把测试入口替换到正式函数名下。

测试入口仅接受 Apple 验签得到的 Sandbox 交易。固定映射覆盖 `orders`、`user_memberships`、`user_wallet`、`coin_transactions`、`coin_reservations`，统一加 `ios_sandbox_` 前缀；普通查询及事务内访问使用同一适配器。适配器不暴露原始数据库，未知集合直接拒绝，配置、集合或数据库访问失败均不会回退到正式集合。正式结算在未传入此适配器时保持 Production 限制；客户端字段和普通数据库对象的 `environment` 属性均不能切换账本。

两个测试函数都需要服务端 `IAP_SANDBOX_TEST_UIDS`，格式为 1–20 个独立 UID 的 JSON 字符串数组；禁止空列表、匿名、重复和通配符。验单使用 CloudBase 可信调用 UID，先检查白名单，再通过既有 `account-api` 内部接口检查账号状态；客户端 UID 字段不参与授权。测试交易必须包含匹配的 `appAccountToken`，不开放正式入口的无标记历史首次领取。退款只操作测试订单，并重新核对其用户仍在白名单内、签名账号标记匹配。撤销白名单会阻止该账号的后续测试退款，应在撤销前完成测试清理。

`verifyPurchase` 只接受 1–32 位数字交易 ID；Apple 返回的交易 ID 必须完全相同。`restore` 限 10 个条目、去重逐项处理；空列表用于账号及服务配置检查，不证明云端测试集合已就绪。通知需 POST、有效签名、Sandbox 环境、匹配的 bundle、交易 ID 和撤销时间；数据库故障返回非 2xx 以允许重试。通知不依赖用户当前登录状态。

本地测试使用已验签载荷替身与内存事务数据库，覆盖同 ID 跨环境订单、并发恢复、事务回滚、响应丢失、退款中断及重试、跨 UID、白名单撤销、缺配置及缺集合；普通查询和事务访问正式集合都会令测试立即失败。这些结果不证明 Apple 在线验签或 CloudBase 远端事务正确。

完整支付回归为 **23 文件 / 370 项通过 / 0 失败 / 0 跳过**，其中本次增加 58 项；另外对离线包中的真实入口执行同一组 35 项函数测试，全部通过。包内 45 个文件逐项核对哈希，入口和共享库与已测试源码一致。首轮适配器测试混用 Vite ESM 转换和 CommonJS 加载，产生了两个模块私有策略表；测试改用与云函数一致的 CommonJS 加载后通过，生产隔离检查没有放宽。

后续已准备原生显式测试路由及 API 仓库的只读 `account-api-sandbox` 候选，仍需 iOS 页面实跑、云端名称查重、测试集合创建与权限检查、内部服务访问配置、实际事务验收及真实 Apple Sandbox 证据。当前没有云端部署或真实数据变更。按仅模拟器约束，继续本地 StoreKit 测试；[Apple DTS](https://developer.apple.com/forums/thread/768966) 明确真实 Sandbox 购买需要物理设备，不能用模拟器本地 StoreKit 结果替代。

测试验单和恢复响应增加 `ledgerEnvironment: "Sandbox"`，便于原生测试模式拒绝错误端点或未隔离的响应。匿名会话即使 UID 被误列入白名单也会拒绝。加入该回归后完整支付目录为 371 项通过，包内入口 36 项通过。先前 e0b304a 离线包没有响应标记，不能用于新版原生测试路由；须重新打包当前源码。

## 正式入口更新 · 2026-11-06

修复提交 `f0301f8` 补齐重新验单后旧订单的应用标识，合并提交为 `de4aa33`。本次只更新已有的 `wxpay-order`、`wxpay-notify`、`appstore-notify`、`iap-order` 代码，运行时仍为 `Nodejs18.15`，保留已有运行配置和环境变量；4 个函数上线前的代码与配置均已保存为云端版本 `1`。这些历史版本仅是恢复与调查依据；回退仍须遵守上文的停流、凭据保留和旧结算器限制。

- 本地完整检查：lint、typecheck、200 个测试文件 / 1,359 项测试、生产构建及 15 个客户端壳校验通过。支付目录为 23 个文件 / 381 项测试通过。
- 线上检查：4 个函数均为 `Active` 且 `CodeResult=success`；重新下载部署包并将全部 92 个源码和依赖清单文件与合并后源码逐项比对，全部一致。
- 入口烟测：未登录的验单 / 查单被拒绝；两个通知入口的 GET 返回 405；Apple 通知缺少签名载荷返回 400；微信通知缺少签名头返回 401。没有执行真实下单、发放或退款，部署前后历史 IAP 订单记录一致。
- 独立 Sandbox 函数、测试集合和 UID 白名单尚未部署配置。本次未验证真实 CloudBase 结算事务、Apple 在线验签或真机 Sandbox 购买 / 恢复 / 退款，不能把入口烟测视为支付链路验收。

部署包 SHA-256（包含云端安装的依赖）：

| 函数 | SHA-256 |
| --- | --- |
| `iap-order` | `ca24f9f65dbae8fd1693cf7ebe7a7a2c1fd7d7018cbe79977c83bc5e52cb2c03` |
| `appstore-notify` | `317e2b51cafec985b5634f4f00ff5b8b9291175fb88eec56828e488f9a64a10c` |
| `wxpay-order` | `6daaf633428761f0c6f8df621e5ae831fec058d23b33fe242cdfc448c3312025` |
| `wxpay-notify` | `a9447b47c1a36d090df2f8c0b36bb89917ab47776461fc6128b9cb73cd9bec66` |
