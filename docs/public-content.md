# 下载资源与站点公告

## 范围与责任

Admin `/operations/content` 管理云乐坊 App 的 iOS、Android、Web 下载入口，以及官网公告。
仅编辑已有 HTTPS 链接，不上传安装包、不实现自动升级。公告为纯文本，可指定首页或全站、起止时间、一个可选链接。

两类内容独立保存、发布、回滚。运营发布由 Admin 服务端统一执行；这是公共内容领域，不复用或改变 SSO Registry 授权事务。
官网通过同源 `/api/public-content/downloads`、`/api/public-content/announcements` 查询已发布版本。
上游暂由 Admin 提供同名公开只读端点；`NUXT_PUBLIC_CONTENT_API_URL` 默认 `https://admin.yunle.fun/api/public-content`。
不新增域名。如果之后把 `api.yunle.fun/public-content/*` 配置为反向代理，只需替换此地址；本次未修改网关路由。

## 数据与发布

Admin 的 `public_content_state`、`public_content_releases` 两个集合必须为 ADMINONLY。
state 每种内容一个文档，存草稿、revision、当前公开快照和最近 50 次发布摘要。
release 文档永久保留完整发布记录，包括发布者、说明和回滚来源；公开接口只输出经过字段白名单校验的快照。

保存、发布、回滚均使用 expectedRevision + 数据库事务拒绝并发覆盖。发布先上传并校验 COS 对象，成功后事务写发布记录并切换当前版本。
COS 失败不会切换；事务失败可能留下未启用的孤立对象，不会影响线上。UUID 对象路径从不覆盖。
回滚新增版本，不覆盖旧文件，也不覆盖尚未发布的草稿。

公开快照格式：`{ schemaVersion: 1, kind, releaseId, publishedAt, content }`。
COS key：`public-content/{kind}/{releaseId}.json`，缓存 `public, max-age=31536000, immutable`。
固定读接口返回当前快照本体，使用 `no-cache` + ETag，客户端无需再追踪资源 URL。
API 不读取草稿；COS 文件不包含发布者、审计信息或私密数据。

## 官网行为

首页与下载页保持预渲染；客户端挂载后请求公开配置，无需登录。
下载服务失败时仅保留内置 Web 入口，不使用旧版本安装包链接；页面提示无法获取最新信息。
原下载页重复的硬编码系统要求已移除，以各平台发布内容为准。

公告未配置、未启用或接口失败时不显示。起止时间采用 ISO 8601 UTC 存储，后台输入按操作者设备时区转换。
已打开页面每 30 秒检查已取得公告的生效/失效时间；新发布内容在打开或刷新后获取，不做网络轮询。
关闭记录保存在本地，按公告 ID 和完整规范化内容识别修订；重发相同内容或修改其他公告不会重新弹出。
全站指使用官网 default layout 的页面；登录等独立布局暂不展示。

## 上线步骤

1. 在 Admin 使用现有 CloudBase 管理凭据，并明确配置生产 EnvId。
2. `node scripts/ensure-public-content-resources.mjs` 检查默认 dry-run 计划。
3. 配置凭据后执行 `node --env-file=.env scripts/ensure-public-content-resources.mjs --apply --confirm-env=<实际环境ID>`，只创建两集合并设置 ADMINONLY。
4. 配置 `NUXT_PUBLIC_CONTENT_BUCKET`、`NUXT_PUBLIC_CONTENT_REGION`、`NUXT_PUBLIC_CONTENT_PUBLIC_ORIGIN`；复用现有公共资源域名。
   写入使用 Admin 的 `tencentCloud` 服务端凭据。为该前缀授予必要的 PutObject/GetObject 权限；不要为此放开整个私有桶。
   核验资源域名可以公开读取该前缀、返回 JSON 且遵守 Cache-Control。临时签名下载链接不能用作长期资源域名或安装包入口。
5. 写操作的 Origin 校验使用 `NUXT_PUBLIC_CONTENT_ADMIN_ORIGIN`（默认 `https://admin.yunle.fun`），避免 EdgeOne 内部代理地址影响 HTTPS 校验。自定义后台预览域名须显式覆盖；本地开发使用本地请求地址。
6. 部署 Admin，再部署官网。普通管理员需具备 `operations:content:manage`；沿用现有运营权限分配机制。
7. 在后台保存并发布真实下载链接。公告默认空列表，不预置上线公告。
8. 验证未登录可读已发布接口但不可访问管理接口，确认不包含草稿/操作人；验证 ETag/304、COS 快照、跨账号并发冲突及回滚。

## 生产资源（2026-09-07）

已在 `yunlefun-8g7ybcxc7345c490` / `ap-shanghai` 创建两个 ADMINONLY 集合。
复用公共桶 `yunlefun-cos-1253292018`，资源地址使用该桶现有 COS HTTPS 域名；没有新增域名或放宽桶权限。
Admin EdgeOne 项目 `pages-aljmqjyv6gdj` 已补充三项公共内容存储变量，并核验原有变量保持不变。
通过同一发布服务初始化两个正式版本，下载保持 Web 入口和移动端未开放，公告为空；COS 匿名读取、内容一致性和 immutable 缓存头已通过核验。

## 后续待办

- [ ] 在获得正式版本号和真实下载链接后，从 Admin 开放 iOS / Android 入口。
- [ ] 有实际运营内容时，从 Admin 新增并发布公告。
- [ ] 当出现第三类以上稳定内容且表单重复维护成为实际负担时，再评估 Schema 驱动 UI；当前不建设通用 JSON 编辑器或配置平台。

首页应用列表、账户和业务状态继续沿用原有数据查询链路，不纳入公共内容发布。

## 合约维护

`shared/public-content.ts` 在 Admin 与官网各保留一份相同的 v1 只读合约，部署可以独立。
修改时同步两份并保持旧客户端兼容；`schemaVersion` 用于拒绝不支持的格式，不按发布次数递增。

## 生产验证说明

真实并发保存已验证一成功、一 409，发布内容不变。EdgeOne 公网接口返回 `no-cache` 与版本 ETag，但当前链路对条件请求返回完整 200；304 只是源站支持的优化，不作为获取最新内容的前提。COS 版本文件使用 immutable 缓存。
