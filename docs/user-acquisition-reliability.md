# 官网来源写入与恢复

本说明补充 `docs/user-acquisition.md` 的来源采集口径，描述官网成功认证之后的写入行为。来源写入失败不会撤销登录成功。

## 自动触发

- 手机 OTP 登录、手机注册 OTP、已绑定邮箱 OTP 成功并读取到真实账号后，触发官网写入。
- GitHub / 微信网页登录成功后，仅在回调 `state` 与登录前保存的 SDK `state`、provider 和当前 attempt 一致时写入。登录通过 SDK 已支持的 `skipBrowserRedirect` 先取得 URL、绑定 state，再跳转；二次 OAuth 使用新 attempt ID，保留原来源捕获时间。旧回调、缺失绑定、原生 App 回调、身份绑定弹窗均不会创建官网来源写入。
- 暂时失败之后，两次补送使用 full jitter，分别在 0–2 秒、0–10 秒内随机延迟。只在首次已知暂时失败或超时时抽样，排定的 nextAttemptAt 持久化；恢复或迟到失败不会重新抽样。
- 已有冻结 pending 时，认证会话恢复、应用挂载完成、浏览器 `online` 事件可以恢复同一任务。它们不会新建来源或用当前页面重采集渠道；未到下一次发送时间仍等待。
- SSO 登录由服务端按 Registry 判定写入，浏览器不会同时调用官网写入。SSO 保持一次受限等待，不添加不可靠的后台补发。

## 有限预算与账号保护

一次任务最多执行 3 次。截止时间固定为原 attempt 的 `createdAt + 30 分钟`，不会因刷新、重试、OAuth 往返或 online 事件延长。首次身份检查与请求合计最多等待 1.5 秒，后续同样受限。

浏览器使用独立 sessionStorage 键 `ylf:acquisition:pending:v1` 保存 attempt ID、首次成功认证账号、冻结后的来源、认证方法、原截止时间、次数和下一次发送时间，不保存访问令牌、刷新令牌、授权码或完整 URL。浏览器拒绝存储时只保留当前文档内存，读取时仍校验。可读存储被清空或损坏时不会恢复旧内存任务。

每次请求前重新读取真实 SDK 会话，账号必须等于冻结账号。请求的 `expectedUserId` 只是与服务端 runtime caller UID 做相等性校验；入库 UID 始终来自 runtime caller，前端不能选择写入主体。SDK 在预检之后切换令牌账号也会由服务端 `409 acquisition_account_changed` 拦截。

只有已识别的网络故障、传输超时，或明确 `statusCode: 503, retryable: true` 可以继续预算内的重试。`400/401/403/409`、不可重试的 `503`、未知错误、`existing`、`skipped` 都终止并只清理原任务。后来的来源、认证方法、SSO flow 或账号不同则停止原任务；旧请求迟到不会清掉新的 attempt。

一个文档最多拥有一个未完成请求，包括已超过等待时间的请求。SDK 没有可用取消接口，因此 1.5 秒到时代表停止等待，不代表取消后台请求。迟到成功直接结束；迟到暂时失败才安排下一次。若 SDK promise 永不完成，当前文档不会并发重发；刷新后可凭同一 pending 在原次数和截止时间内恢复。浏览器离开页面、存储被拒绝、服务端未配置或预算耗尽时，仍可能没有来源记录；该方案不是持久队列。

发送前先保存 `开始时间 + 1.5 秒 + 本级延迟上限` 的保守恢复时间，此时不消耗随机采样。收到可重试结果或超过等待预算后才保存实际随机时间，避免发送中刷新使补送过早。冻结上下文始终按原认证尝试时间校验，OAuth 等待跨过首次触达的 30 天边界不会因此丢掉整次有效注册入口；服务端仍独立去除过龄触达。

OAuth 回调页在 Nuxt 及 EdgeOne 静态响应中均配置 `no-store`、`no-referrer`、`noindex`。本模块的 state 匹配保护来源与原尝试的关联，不替代认证协议自身的 CSRF/PKCE 校验或完整安全审计。

## 可观测结果

浏览器与 SSO 服务使用 `[acquisition]` 结构化结果日志，只包含固定枚举：`surface`、`trigger`、`outcome`、`attempts`、白名单 `statusCode`，浏览器迟到结果额外标记 `late: true`。不输出 UID、来源上下文、query、凭证、service token 或 SDK 原始错误。

官网日志可区分 `recorded/existing/skipped`、`timeout/network/retryable_failure/terminal_failure`、`identity_changed/identity_unavailable/attempt_changed`、`expired/exhausted/stale_result`。SSO 可区分 `recorded/existing/skipped`、`timeout`、`retryable_failure/terminal_failure`、`transport_failure/not_configured`。SSO 超时仅说明结果未知；函数返回之后没有持久队列或可靠的未等待 promise 保证补写。

本说明的自动触发适用于官网。Apps 自身直接注册由 Apps 仓库单独接入；其他应用的营销来源采集仍需各应用接入 SDK，不能由登录站据 `client_id` 推导渠道。
