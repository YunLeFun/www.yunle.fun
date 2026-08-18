# AI Runtime 旧服务退役

`services/advjs-ai-runtime` 已由 `YunLeFun/api` 中的共享平台 Runtime 取代。www 仓库不再拥有 HTTP Runtime、worker、sweeper 或旧 read-projection broker，但仍拥有账号点数账本及其 CloudBase 资源安全边界。

## 所有权边界

- `YunLeFun/api`：`services/ai-runtime`、`packages/ai-runtime*`、生产 worker/sweeper、运行时策略和 `production-read-only` 回滚单元。
- 本仓库：`cloudfunctions/account-api/ai-points.js`、`ai-point-resources.js`、资源规划/检查脚本，以及冻结的 v1 contract fixture。
- ADV.JS Studio：浏览器侧 v1 transport 与 proposal 应用流程。

冻结的 v1 fixture/parser 位于 `tests/fixtures/ai-runtime`。`pnpm verify:ai-runtime:p4` 会跨三个工作树逐字节检查 fixture，逐字节检查 www 与 API Adapter 的 parser，并检查 Studio 的 v1 transport 行为；同时确认平台生产 Runtime 直接读取 CloudBase，不依赖已退役的 www read-projection broker。

## 合并与发布门禁

1. `YunLeFun/api` 的平台 Runtime 源码必须先发布到可恢复的远程分支或主分支，不能只存在于临时工作树。
2. 运行 `pnpm verify:ai-runtime:p4`，并提供 API 与 ADV.JS Studio 的绝对工作树路径。
3. 运行本仓库的 lint、typecheck、test 和 build。
4. 确认生产 `ai-runtime` 为单一 100% 流量版本，`account-api` 已配置 `YUNLEFUN_AI_RUNTIME_ACCOUNT_API_TOKEN`，再执行应用层 health、CORS 和无效写请求探测。
5. 本变更不删除 CloudRun、云函数、集合、索引、策略或账本数据；任何资源删除必须单独审批。

## 回滚

回滚由 `YunLeFun/api` 的 `production-read-only` 单元接管：先关闭写策略和事件单元，再部署保留的只读版本。任务、用量、点数账本和新增索引保持原状。`account-api` 在观察窗口内继续接受同值的 `ADVJS_AI_RUNTIME_ACCOUNT_API_TOKEN` 别名；部署清单只写入平台变量 `YUNLEFUN_AI_RUNTIME_ACCOUNT_API_TOKEN`。
