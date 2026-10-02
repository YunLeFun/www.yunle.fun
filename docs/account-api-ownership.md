# 账户服务所有权

账户服务已迁至 `YunLeFun/api`，唯一实现位于该仓库的 `cloudfunctions/account-api`。官网保留钱包 UI、公共 `@yunlefun/ui` 设计 token 和 Nuxt BFF；调用名称仍是 `account-api`，包括 `getAiPointExchangePolicy` 和 `exchangeCoinForAiPoints`。

账户余额、兑换规则、事务、幂等与流水都由账户服务负责。AI Runtime 通过专用凭据调用同一账本。原 CloudBase 环境、集合、用户 ID 和 HTTP 路由保持不变，无需复制数据库。

## 发布

先在 API 仓库运行 `pnpm verify:account-api` 和 `pnpm deploy:account-api` 预览，配置原有密钥并核定兑换比例后部署原函数，再发布官网。详细步骤见 [API 账户服务说明](https://github.com/YunLeFun/api/blob/main/docs/account-api.md)。源码迁移本身不代表线上已更新。

本仓 `cloudbaserc*.json` 不再声明账户函数，构建/部署脚本会拒绝 `account-api`。SSO 和测试身份部署前，先从 API 仓库发布对应开发/生产账户函数。

## 共享代码

- 支付库仍以本仓 `cloudfunctions/wxpay-order/lib` 为源，API 保留有哈希校验的独立部署快照。
- `server/vendor/account-api` 是 API 导出的领取凭证 HMAC 协议副本，供 Nuxt BFF 签发凭证，不含账户服务逻辑，请勿手改。
- 更新共享源码后，从 API 仓库运行 `pnpm sync:account-api:shared --www-root=<本仓绝对路径> --update`，再运行两仓测试并提交生成产物。不带 `--update` 可检查跨仓库一致性。

AI 资源规划/检查脚本及账户测试也归 API 仓库。支付、通知、SSO 等调用方测试仍留在本仓。
