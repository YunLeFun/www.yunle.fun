# 注册来源实现与业界实践对照

调研与优化日期：2026-10-09。以下是针对当前产品规模的实施选择，不宣称已经实现完整 GA4、广告平台归因或 OAuth 安全认证。

## 归因口径与证据

[Google Analytics 的来源维度](https://support.google.com/analytics/answer/11080067?hl=en)区分用户、会话和事件作用域。[Segment 的公共规范](https://www.twilio.com/docs/segment/connections/spec/common)将 app、campaign、referrer 作为独立上下文，并区分客户端发生时间与服务端接收时间。

本产品将 SSO Registry 授权目标与营销上下文分开保存。注册时间取 Auth `sys_user.createdAt`，记录时间由服务端生成；触达时间、UTM、referrer 和 authMethod 是客户端报告。firstTouch 是当前浏览器 30 天内首次观察，registerTouch 是本次注册流程入口快照；后台已明确这两个范围。

后台按 UTM、外部引荐、未知分别展示和分组。不完整的手动活动保留缺失 source，不把它与 referrer 拼接；相同 source 文字但依据不同也不合并。未知进一步显示「缺少记录」和「已记录但无渠道标识」，帮助区分采集覆盖与线索覆盖。

[GA4 的 direct 处理](https://support.google.com/analytics/answer/11242841?hl=en)有自己的算法定义。本产品缺少可观察线索时显示未知，因此不可直接与 GA4 direct 占比对齐，也不能把总体流量比例回填到单个注册 UID。

## 写入可靠性

参考 [AWS 的退避与随机抖动实践](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)，官网与 Apps 将两次补送的固定延迟改为 full jitter（0–2 秒、0–10 秒），降低同时失败的客户端集中重试。采样时间持久化；页面恢复、迟到结果不重新抽样。

原账号、上下文、认证尝试、30 分钟截止、最多 3 次、1.5 秒等待及单请求锁保持。只有明确临时故障重试，配置、身份、参数或权限问题终止。未结束的 SDK 请求仍占用锁，关闭页面或永久挂起仍可能漏记，未增加持久队列。

Apps 新文档登录入口重新采集当前落地信息，同一文档导航保留原渠道，OAuth 回调保留原上下文。Cook 可读存储删除或损坏不会恢复旧内存来源。OAuth 等待跨过触达保留边界时，客户端冻结上下文按原尝试时间匹配，由后端独立裁掉过龄触达。

## 最小权限与敏感回调

[RFC 9700 §2.3](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.3)强调限制令牌权限与可用资源。将这一最小权限原则用于现有静态服务凭据后，Apps 来源 BFF 使用独立的 `APPS_ACQUISITION_INTERNAL_TOKEN`，仅能调用来源动作；通用 token 不作为兜底，也不能复用。部署预检拒绝不同用途复用同一值。

[RFC 9700 §4.2.4](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.2.4)讨论通过 Referrer-Policy 降低回调凭证泄漏风险。官网 OAuth 回调补齐 no-referrer/no-store/noindex，并同时覆盖 Nuxt 和 EdgeOne 静态响应。

[Auth0 的 state 实践](https://auth0.com/docs/secure/attack-protection/state-parameters)强调与原请求匹配。当前来源记录绑定 SDK 实际生成的 state、provider 和 attempt，避免旧回调套用新来源。这保护的是来源关联；既有 CloudBase code 交换、Native 中转及绑定流程没有在本轮改写，完整认证事务安全不能仅凭来源匹配测试证明。

## 保留的实现选择

仅采集 host/path 和三个已有 UTM 字段，不增加完整 URL、广告标识、IP 或跨设备身份。入口应用维度统一在 SSO 服务端记录；共享 SDK 目前只负责安全校验和透传。新增应用可复用纯采集逻辑，但当前仍各自集成，不宣称已经统一为公共 collector。

没有引入多触点模型、营销事件流水或日聚合存储。真实覆盖率、跨域与真机流程需要上线后验收，本轮没有部署或写入生产。
