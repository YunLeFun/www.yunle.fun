# 用户来源记录发布准备

截至 2026-10-09，功能已在本地实现并验证；本次仅做生产只读预检，没有创建资源、更新云函数、发布前端/npm 或写入生产用户数据。

## 实际预检结果

目标为国内环境 `yunlefun-8g7ybcxc7345c490`，地域 `ap-shanghai`。环境状态正常。

| 项目                        | 已确认状态                                                    | 发布前处理                                                                                                                       |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `user_acquisition`          | 集合不存在                                                    | 创建私有集合及来源索引                                                                                                           |
| `sys_user`                  | 只有 `_id_`、`_openid_1`，缺查询复合索引                      | 添加 `createdAt DESC, _id DESC` 非唯一索引                                                                                       |
| `account-api`、`sso-ticket` | Active，Nodejs18.15，`index.main`，timeout 10 秒              | 保存旧代码和配置，更新代码后核对配置                                                                                             |
| 函数配置                    | 远端既有内部 token 等配置存在，本地完整 manifest 所需变量不齐 | 保留远端配置；不得用缺变量的本地 manifest 覆盖                                                                                   |
| Apps 来源专用凭据           | 新增私有 `appsAcquisitionInternalToken`，尚未上线             | API 配置 `APPS_ACQUISITION_INTERNAL_TOKEN`，Apps 服务端注入相同的 `NUXT_APPS_ACQUISITION_INTERNAL_TOKEN`；不得复用通用业务 token |
| `@yunlefun/sso@0.7.0`       | 本地构建通过，尚未发布                                        | 使用已有 GitHub OIDC workflow，发布提交须在 `main` 历史中                                                                        |
| Cook 依赖                   | manifest 指向 0.7.0，lockfile 仍为 0.6.2                      | npm 正式发布后更新 lockfile，重新安装与验证                                                                                      |

本地 npm 登录的 401 不阻碍已有 OIDC 发布流程。CloudBase MCP 当前未登录，但仓库现有管理凭据已成功读取函数状态；不应将 MCP 登录状态误判为没有发布能力。

本轮最终验证：API 全量 459 项、官网 97 项、Apps 134 项 unit 与 22 项 Nuxt、Admin 46 项、Cook 44 项相关测试通过。相关 lint、官网/Apps/Admin/Cook 类型检查及官网、Apps、Admin Web 构建通过；Cook 使用实际打包的 0.7.0 SDK 验证后恢复原依赖软链接，未改 lockfile。API 部署 artifact 已构建；此前 Native 协议编译未代替完整原生 release 或线上验收。

API artifact 位于 `../api/.cloudbase/artifacts/account-api`，共 57 个文件、448616 bytes；按规范化路径与内容计算的 SHA256 为 `5b66ebcc23ccecc071a3c4e55a43e511ea29be05ac2b5abd47be6e5c61111092`。发布前若重建或改变源码，需要重新核验摘要。

## 资源与代码范围

1. API 的 `scripts/ensure-user-acquisition-resources.mjs` 默认是无网络 dry-run。实际 apply 要求完整环境 ID、相同的 confirm-env、数据库 instance-id、region 和匹配环境的仓库配置文件。只创建 `user_acquisition`，ACL 为 `ADMINONLY`，索引为 `registered_at` 与 `entry_app_registered_at`；不回填历史用户。
2. Admin 的 `scripts/ensure-acquisition-indexes.mjs` 支持离线 dry-run、只读 inspect 和显式 apply。只向现有 `sys_user` 添加查询索引；同名结构漂移会拒绝执行。索引可见后还须确认构建完成及实际分页查询可用。
3. 函数代码发布范围为 `account-api` 与 `sso-ticket`。发布前保存原代码及配置摘要。若采用官方 manager 的 `updateFunctionCode`，请求中不带 `Environment`，保留远端 runtime、timeout、memory、网络及权限设置，并在完成后逐项比对。代码包不含 node_modules，需要安装依赖并等待完成；依赖重新解析的结果也需验证。既有完整 manifest 部署脚本的必填变量校验继续保留。
4. Apps 新私有来源凭据单独配置，API 仅允许它调用 `recordAppsUserAcquisition`；它不能调用账户查询、SSO 内部写入或扣币。缺配置返回不可重试 503，禁止用通用 token 兜底。代码发布时新增 API 的专用配置属于单独审查的变更，其余既有配置保持。该凭据不写入 public runtimeConfig、`NUXT_PUBLIC_*` 或 Native 静态包，客户端不能指定可信应用或写入 UID。

先资源与索引，再 API/SSO 服务端，再 Admin 与官网/Apps。共享 SDK 和 Cook 的发布可随后进行：旧 SSO 客户端仍能记录 Registry 授权目标，只有营销上下文需要新 SDK 的透传能力。Cook 工作区有其他未提交改动，发布时须按实际变更范围审核。

## 验收与回滚

专门的新账号分别验证官网 OTP、Web OAuth、Cook Web SSO、Apps 直接认证及 Native broker 登录：可信应用正确、来源跨跳转保留、只写一次、老账号不覆盖、Admin 分母与真实注册时间一致。Native broker 未登录时先完成注册，来源应记录原 Registry 应用，不被 Apps writer 抢占。

再验证来源写入失败不阻断登录、最多 3 次补送、账号切换返回不可重试 409、旧 OAuth state 不写新来源；覆盖率与结构化失败日志须能区分“渠道未知”和“未写入”。实际跨域及完整原生应用流程仍需发布环境验收，本地 Web build 与协议测试不能替代这些检查。

需要回滚时恢复已保存的旧函数代码及前端版本，核对配置摘要。来源集合与新增非唯一索引保留；不通过删除生产来源数据回滚。已记录的首次来源继续保持不可覆盖。
