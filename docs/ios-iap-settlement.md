# 原生 IAP 账号归属与原子发放

2026-10-18 本地候选补丁。基线 `3f7ff5d0be186ff1e54f3fc6666fa31b959152e2`；尚未部署，未使用真实交易或修改线上数据。

## 服务契约

`iap-order` 保留 Event Function、现有 `verifyPurchase` / `restore`、商品标识与会员自然月计算。用户仍由 CloudBase 的调用上下文认证，并经过账号状态与合成账号检查。客户端只传交易 ID，Apple 官方库验签后得到的交易内容才进入发放函数。

签名交易存在 `appAccountToken` 时，必须与已认证 UID 对应的标记一致。算法与原生 `PurchaseAccountToken.forUser` 相同：对 UTF-8 字符串 `fun.yunle.apps.iap-owner.v1`、一个 NUL 和 UID 求 SHA-256，取前 16 字节，设置 UUID v8 / RFC variant，再按 UUID 格式输出。UUID 大小写不影响匹配；空值、无效值、其他 UID 的标记拒绝，且不会创建订单。它是账号关联标记，不代替 CloudBase 身份验证或 Apple 验签。参见 [Apple appAccountToken](https://developer.apple.com/documentation/appstoreserverapi/appaccounttoken)。

旧签名交易没有该字段时保留首次领取规则，订单写明 `legacy-first-claim`。这不能证明历史购买发生时的应用账号；一旦绑定，其他账号不能重新领取。不能把旧交易缺标记当作“服务端已经验证原始购买账号”。

## 原子边界与失败恢复

- 新订单使用稳定的 `orders._id = iap_<transactionId>`。历史随机 ID 先按 `outTradeNo` 定位，再在事务内重新读取并核对归属、商品、环境与会员购买时间；重复历史订单直接拒绝，保留待人工核对。
- IAP 会员或云币发放与订单 `paid`、`grantedAt`、`iapSettlementVersion: 1` 在同一事务提交。云币的余额与充值流水也在该事务中；没有嵌套事务。会员退款前后快照随订单一起提交。
- 响应丢失后，相同交易返回 `alreadyProcessed`；最终凭据写入失败时，权益变更回滚。不会仅凭 `status: paid` 告知客户端可以结束交易。
- 旧 `paid` 云币订单通过既有充值流水补齐凭据，不重复入账。旧会员订单仅在当前会员 `lastOrderId` 仍匹配时补凭据，不延长有效期，也不编造购买前退款快照；缺少可靠证据则返回人工核对错误。不能自动重放所有旧会员订单。
- 微信 `queryOrder`、`reconcileOrders` 与通用发放函数不再发放 IAP；IAP 必须走重新核对 Apple 交易的路径。微信自身的分步补发机制不在本次原子改造范围内。

事务内只使用按文档 ID 的读取、`set` 和 `update`；查询历史 ID 在事务外，实际授权和金额依据在事务内重读。写入剔除 `_id`，检查 SDK 返回的 `code`。对照 [CloudBase Node SDK 事务文档](https://github.com/TencentCloudBase/node-sdk/blob/master/docs/database/database.md)；本地回滚夹具并不能证明远端事务配置、隔离级别或冲突重试实测通过。

## 验证与上线前提

本地回归覆盖跨账号并发首次领取、同账号并发重放、两个会员订单叠加、凭据写入失败回滚、响应丢失、SDK 错误码、旧订单与旧会员文档、退款及微信入口隔离。Swift 原生实现与 Node 实现分别执行 `alice`、`bob`、`测试账号-1` 三组标记，结果逐项一致。

部署前仍须完成：

1. 在隔离 CloudBase 环境验证实际事务、并发冲突、失败回滚、索引和仅服务端可写权限。补丁复用现有四个集合，没有创建新集合或修改权限。
2. 只读盘点重复 `outTradeNo`、旧 `paid` 无 `grantedAt`、重复钱包 / 会员 / 流水记录。无法确定归属和是否已发放的记录进入人工核对，不自动删除或合并。
3. 暂停并排空旧版 IAP 请求及会修改 IAP 的旧补发实例，协调更新 `iap-order` 和微信入口保护；执行 `node scripts/sync-wxpay-lib.mjs --check`，部署包使用同步后的库。混跑旧随机建单实现不满足本补丁的唯一订单前提。
4. 完成 Sandbox 环境、测试账号、数据库和原生查询端点的隔离后，才能执行真实 Sandbox 购买、恢复、退出换号、撤销与退款。当前 Server API 的 Production → Sandbox 回退仍沿用原实现，**本补丁尚未隔离 Sandbox 权益数据，不能向生产钱包发放测试权益**。
5. 取得隔离环境证据及上线授权后再部署。当前没有生产部署、TestFlight 或提审操作。

回退时应先停止 IAP 请求并保留数据库快照；不要直接恢复会随机建单或通过微信补发 IAP 的旧实例。已提交的新凭据与订单应保留，回退方案不能依靠删除付款记录。
