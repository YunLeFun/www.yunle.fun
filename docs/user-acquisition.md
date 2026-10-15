# 新注册用户来源记录与管理后台统计

## 数据如何流转

浏览器在进入官网、食用手册或 Apps 时采集首次访问与本次注册入口。来源上下文在验证码登录、OAuth 回调以及应用 SSO 跳转中保留，认证成功后由服务端写入独立的 `user_acquisition` 集合。Admin 的「用户来源」页面位于 `/acquisition`，沿用 `users:view` 权限。

采集分为两个维度：

- **入口应用**：官网记录由服务端标记为 `www`，Apps 直接认证由其 BFF 标记为 `apps`；应用 SSO 由 Registry 校验结果提供 `appId`、`clientId` 和目标 origin。前端不能指定入库用户 UID 或可信入口应用。这表示注册附近首次记录的站点或授权目标，不单独证明账号最初在哪个站点创建。
- **营销来源**：首次访问 `firstTouch` 与注册时访问 `registerTouch` 各自保存 UTM source/medium/campaign、落地 host/path、外部 referrer host 和采集时间。该部分标记为 `client_reported`，不能视为广告平台核验的归因。

推广时为不同渠道使用不同 UTM 链接，例如：

```text
https://cook.yunyoujun.cn/?utm_source=zhihu&utm_medium=social&utm_campaign=launch
```

上线后，访客从此链接进入并注册，后台会把来源显示为 `zhihu`、媒介 `social`、活动 `launch`。没有 UTM 时仅使用可获得的外部 referrer 域名；微信等环境可能不提供该信息，此时仍显示未知。

不保存完整 referrer、落地 URL query/hash、验证码、OAuth code、access token、手机号或邮箱。已知站内域名之间的跳转不算外部渠道。没有来源标识时显示「未知」，不推断成直接访问。

## 首次记录与统计口径

`user_acquisition` 使用 Auth UID 作为文档 ID，仅服务端可访问（`ADMINONLY`）。以系统 `sys_user.createdAt` 为真实注册时间，在新账号创建后的 30 分钟内进行事务写入；首次记录后，后续登录不能覆盖它。SSO 来源调用使用 1 秒请求预算；浏览器和 SSO 代理都额外限定最多等待 1.5 秒，存储失败或超时不阻断已经成功的登录或授权，账号权限校验沿用原有策略。匿名、受管测试及受限制账号不能写入。

浏览器首次访问上下文保留 30 天，官网认证尝试保留 30 分钟；这表示当前浏览器可观察到的首次来源，不等同于用户跨设备的首次访问。老 SSO 客户端仍可提供可信入口应用，但营销渠道显示未知。

应用维度的统计统一在 SSO 服务端完成：现有客户端已携带 `client_id` 和回跳地址，无须逐个应用增加入口埋点。逐个应用需要处理的是登录前的上游营销上下文，也可以由共享采集层统一接入；SDK 本身负责透传，不会凭 SSO 参数推断营销渠道。

## Query、SSO 与准确性边界

UTM 在实际落地页面采集，再作为单个 `acquisition` JSON 字段随 SSO 请求传递。SDK 使用 `URLSearchParams` 编码一次，官网解码后通过同一个 `client_id`、`redirect_uri`、`nonce` 匹配认证尝试。登录页嵌套的 `redirect` 保留该字段，OAuth 回调不会把 GitHub 等身份提供方算成营销来源。

官网与 Apps 的独立 Web OAuth 使用 SDK 实际生成的 state 绑定原认证尝试；旧回调或不匹配的回调不能拿新的来源写入。Apps 为第三方应用提供 Native broker 登录时，在认证开始前冻结 SSO 委托标记，跳过 Apps 自身写入，避免把 Cook 等授权目标抢先记录为 Apps。

`client_id` 和精确回跳地址经服务端 Registry 校验后能确认授权目标应用；它们不能单独证明用户之前实际来自该网站，也不能证明用户已经返回应用并消费授权码。当前记录发生在注册后 30 分钟内的首次成功来源写入，应理解为注册附近首次记录的站点或 SSO 授权目标。不能仅增加 `from=cook`、`sourceApp` 或前端 `appId` 就把它变成可信来源。

有显式 UTM 时以 UTM 识别渠道，否则使用可获取的外部 referrer。没有信息仍显示未知。SSO 请求的合法 `acquisition` 优先；没有上下文时先读取内层 `/auth/sso` 的有效 UTM，内层没有有效标识才读取外层 `/login` 或 `/signup` 的 UTM，referrer 留空，仍只作为客户端报告。固定推广链接应指向应用落地页，而不是复用带一次性 nonce/PKCE 的 SSO URL。

自动落地采集覆盖官网、Cook 和 Apps 自身的 Web/原生页面。Apps 的验证码、OAuth 直接认证通过独立 BFF 校验 Bearer 身份，再调用内部 `recordAppsUserAcquisition`；API 固定 `apps` 和 `https://apps.yunle.fun`，证据为 `server_verified`，不接受前端选择入口。Apps broker 与原生切换账号仍只透传原应用上下文；这份上下文不会被 Apps 自己的注册采集导入。已支持的 workshop/wallet 宿主深链接只提取 UTM，OAuth 回调不重新采集来源。其他应用即使升级 SDK，也必须采集并传入 `acquisition` 才能识别营销渠道；只带现有 SSO 参数时仍可识别授权目标应用。

来源写入失败仍可能漏记；超过 30 分钟窗口不会回填，首次写入未知也不会被后续登录覆盖。官网和 Apps 为直接认证保存短期补送任务，绑定原账号、认证尝试、来源及原截止时间，最多发起 3 次。临时失败后的两次补送采用 full jitter，分别在 0–2 秒、0–10 秒内随机延迟；排定的时间持久化，页面恢复或迟到失败不重新抽样。只有网络/超时或明确 `503 + retryable=true` 可重试，参数错误、未登录、受限账号、账号切换及服务未配置均停止。每次发送重新校验会话；官网的 `expectedUserId` 与 Apps BFF 的同名字段只是对服务端身份的相等检查，不能指定入库用户。

首轮仍最多等待 1.5 秒，成功、已有或跳过均结束任务；任务可随当前标签会话恢复或 online 事件恢复。已经超时但未结束的 SDK 请求继续占用单次请求锁，迟到结果不得清理新任务。关闭标签、存储被禁用、底层请求永久挂起或超过窗口时无法保证补送；这不是持久服务端队列。SSO 云函数仍是一次有界调用，函数返回后的未等待 Promise 不算可靠补送。

API 的 `user_acquisition_outcome` 结构化日志区分 recorded/existing/skipped/failed、稳定失败分类和是否可重试。浏览器及 SSO 代理也记录有界结果；日志不包含 UID、来源原始值、手机号、邮箱、token 或 SDK 原始异常。营销来源缺失与来源写入失败通过 Admin 的两种覆盖率和这些日志分别判断。需要完整历史累计注册量时，应另行设计不含个人身份的日汇总；当前 Auth 查询统计的是仍存在的账号，注销后历史范围的分母会减少。

Admin 的渠道带有派生的识别依据 `utm/referral/unknown`，UTM 与同名引荐域名不合并。只填写媒介或活动时保留「UTM（来源未填写）」，不借用 referrer 拼成完整活动。未知来源进一步显示「缺少记录」与「已有记录但无渠道标识」，缺少记录本身不等于已确认的写入失败。首次渠道指当前浏览器 30 天内首次观察，注册时渠道是注册流程入口快照；它们不是 GA4 会话或多触点归因。`authMethod` 也是客户端流程报告，不能作为已核验的 Auth 创建方式。

Admin 按东八区注册日期统计，分母来自当前仍存在的 Auth 新注册用户，排除受管测试账号及明确标记的匿名账号，并把没有来源记录的账号包含在分母中。每次查询固定截止时间，计数和分页使用同一个边界，避免读取期间的新注册改变分母。提供：

- 近 7 天、近 30 天、自定义日期和入口应用筛选。
- 新增人数、来源记录覆盖率、营销来源已知及未知人数。
- 每日注册趋势、入口应用分布、首次渠道与注册时渠道分布。
- 按真实注册时间倒序的 UID 明细和来源证据。

查询失败显示错误而不是零；来源集合尚未部署时显示未知并说明原因；读取超过上限时明确显示样本范围并隐藏完整占比。历史日志分析结果不会自动写入首次来源记录，历史账号无法凭缺失的 referrer 恢复营销来源。

## 涉及仓库

| 仓库               | 职责                                                                             |
| ------------------ | -------------------------------------------------------------------------------- |
| `www.yunle.fun`    | 官网采集、登录成功记录、SSO 来源上下文及私有 API 调用                            |
| `api`              | 私有来源集合、受信任写入、系统注册时间校验、账号注销清理、资源初始化脚本         |
| `admin`            | 管理员查询 API、统一统计口径、来源页面与权限                                     |
| `ylf/packages/sso` | `@yunlefun/sso@0.7.0` 的可选来源上下文协议                                       |
| `cook`             | 食用手册首次落地采集、Web/原生 SSO 透传                                          |
| `apps.yunle.fun`   | 自身直接认证采集与 BFF 写入；宿主及 iOS/Android 更换账号流程保留第三方来源上下文 |

## 上线顺序与验收

2026-10-15 已部署来源集合、查询索引、账户 API、SSO 云函数、官网、Apps Web/BFF、Admin 新 UI 和 Cook Web。`YunLeFun/ylf` 经敏感信息审查后已公开，提交为 `d8cb871`；`@yunlefun/sso@0.7.0` 已通过 [OIDC 发布任务 38732814238](https://github.com/YunLeFun/ylf/actions/runs/38732814238) 发布，已核验可安装、完整 SRI、npm 包签名与 provenance。Cook [PR #97](https://github.com/YunYouJun/cook/pull/97) 已合入 `main@dad177c9`，主域 `cook.yunyoujun.cn` 与次域 `cook.yunle.fun` 均已生产发布成功，主域线上 HTML 摘要与本次产物完全一致。完整状态见 `docs/user-acquisition-release.md`。以下为依赖顺序与验收要求。

1. 在 `api` 仓库先检查 `scripts/ensure-user-acquisition-resources.mjs` 的离线 dry-run，再按其显式环境参数创建私有集合与索引。Admin 查询所需的 `sys_user(createdAt DESC, _id DESC)` 索引用 Admin 的 `scripts/ensure-acquisition-indexes.mjs` 只读预检和显式 apply，具体要求见 Admin 文档。
2. 发布 `account-api`，保持现有 `ACCOUNT_API_INTERNAL_TOKEN` 的 SSO 内部调用关系，另配置仅授权 Apps 来源动作的独立 `APPS_ACQUISITION_INTERNAL_TOKEN`。接着发布带来源代理的 `sso-ticket` 与官网。旧客户端兼容，未知渠道会如实展示。
3. 发布 Admin API 与页面；先用现有管理员检查来源集合可读、真实分母正确、未知来源可见。
4. 共享 `@yunlefun/sso@0.7.0` 已通过 `ylf` 的 GitHub OIDC 流程发布并核验可安装。Cook 已用真实 registry 版本更新 lockfile，通过 frozen install、测试、类型检查与静态生成，PR 和主分支 CI 均成功，已合入并完成两个域名的生产部署。Apps 的私有运行时配置需注入 `NUXT_APPS_ACQUISITION_INTERNAL_TOKEN` 和现有服务端 CloudBase 凭据；与 API 同名专用 token 一致，不能复用通用业务 token，禁止放入 public/VITE 配置。宿主与原生版本按各自发布流程更新。
5. 用专门的新测试账号验证官网验证码、GitHub OAuth、Cook Web SSO 和原生更换账号流程：入口应用正确、上下文跨跳转保留、记录只写一次、后续登录不覆盖、Admin 新增分母匹配。来源参数异常或写入失败时登录仍应成功。

已验证前后端测试、类型检查、Web 构建、SDK 打包联调和原生协议编译，生产来源集合及分页索引已执行并通过查询验收。Native 容器与商店发布、完整 iOS 应用构建及真实新账号跨域登录端到端仍需单独验收。

Admin 详细说明：`../admin/docs/user-acquisition.md`（相对于 www 仓库根目录的相邻仓库路径）。Cook 发布和联调说明位于其 `docs/dev/acquisition.md`。

2026-10-09 的实际生产只读预检与发布范围见 `docs/user-acquisition-release.md`。

业界资料对照、已落地优化及口径差异见 `docs/user-acquisition-practices.md`。

## 不影响正式统计的真实注册验收

真实新注册会立即进入所在 CloudBase 租户的 `sys_user`。QA UTM、应用筛选或注册后再补测试标记，都不能保证它从未计入正式新增分母。

正式 `user_acquisition` 跳过受管 synthetic 账号。通过 Admin 正式维护服务先完成 synthetic 分类、再创建 Auth 的专用新受管账号，可以经内部 SSO 校验写入独立的 `test_user_acquisition`，并在 Admin 该账号的“测试来源”中查看；该账号及其来源持续排除在正式统计之外。这可验证新受管账号创建、正常 SSO 和独立来源写入，但不等同短信自助注册，也不能用已有测试号登录替代新账号创建。

以下独立 development 短信注册链路是另一条可选验收方案，使用同一份发布代码、独立 Auth 和数据库。已配置的开发租户当前不可访问，此流程尚未完成验收，也不是生产受管账号来源验收的前置条件。结果必须标注为“development 真实注册验收”，不能声称验证了生产域名的新注册。

1. **先核对实际环境。** 已有开发配置指向 `yunlefun-dev-0ge03bdod37093d1` / `ap-shanghai`；必须用管理端精确读取环境详情，确认可访问且有本项目使用的 NoSQL 后端。仅有配置文件、域名包含 `dev`、或 Admin 测试账号目录中的 `environment=test`，均不代表数据库隔离。环境不可访问时先恢复或接入可用的独立环境，不可回退 production 租户。
2. **核对全链路配置。** Provider、Cook 的 Web SDK，`account-api`、`sso-ticket` 和 Admin 服务端均须指向同一开发租户；所有私有服务凭据、会话密钥、issuer、exchange 和 JWKS 也须匹配开发环境。Provider 的 `accountApiHttpUrl` 默认指向生产，隔离实例必须显式配置已验证的开发端点，不能保留生产默认值。开发 Provider 可复用 `pnpm dev:sso`，详见 `docs/sso-integration.md`。
3. **准备实际后端和准入。** 在开发租户部署当前来源函数、`ADMINONLY` 来源集合及查询索引，确认真实短信通道可用。通过现有 Registry 维护流程接入 Cook 的精确开发 HTTPS origin、回调和同源图标；当前 development 配置不能直接复用生产 Cook origin。独立 Admin 使用 development `admin-web`、JWKS 及该租户内合法操作员权限，沿用实际 `/acquisition` 页面，不增加任意指定环境的 query 参数。
4. **完成真实注册。** 新访客会话从带唯一 UTM 的开发 Cook 进入统一登录。手机号只需未在开发租户注册，可以在生产已有账号；手机号、验证码和服务条款确认由测试者直接在页面完成。注册前确认开发 Auth 中没有该用户；不能预先用 Admin 创建 Auth 账号、伪造手机号验证标记或手写来源记录。
5. **核对落库与展示。** SSO 返回 Cook 并显示登录态后，读取开发 Auth 的真实 UID/创建时间，确认来源记录由实际 writer 生成，`registeredAt` 匹配 Auth，入口为 `cook` / `cook-web` / `registry_validated`，UTM 为本次触点且营销证据为 `client_reported`。在独立 Admin 查询相同日期及“食用手册”，核对新增分母、记录数、渠道和明细。再次登录携带不同 UTM 后，确认首次来源未覆盖。
6. **保留最少证据。** 保存不含手机号、OTP、密码、授权码或 token 的数据库核对结果与登录后/来源页截图，注明代码版本、环境及未验证范围。测试记录保留在独立租户中，不通过向生产插入再删除的方式验收。
