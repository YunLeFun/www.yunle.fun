# Registry 变更提案：web-resume-web

- 状态：Proposed（待联调、审批与生产发布）
- Change ID：`SSO-REGISTRY-2026-09-03-WEB-RESUME-WEB`
- 决策日期：2026-09-03（Asia/Shanghai）
- 应用仓库：`YunYouJun/web-resume`

## 注册内容

| 字段            | Production                                               | Development                                                         |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `clientId`      | `web-resume-web`                                         | `web-resume-web`                                                    |
| `appId`         | `web-resume`                                             | `web-resume`                                                        |
| `displayName`   | Web Resume                                               | Web Resume                                                          |
| `adapter`       | `web-sso`                                                | `web-sso`                                                           |
| `consent`       | `trusted`                                                | `trusted`                                                           |
| `allowedScopes` | `identity:bootstrap`                                     | `identity:bootstrap`                                                |
| `origin`        | `https://resume.yunle.fun`                               | `https://resume.yunle.localhost:3455`                               |
| `redirectUri`   | `https://resume.yunle.fun/user`                          | `https://resume.yunle.localhost:3455/user`                          |
| `iconUrl`       | `https://resume.yunle.fun/img/icons/web-resume-mark.svg` | `https://resume.yunle.localhost:3455/img/icons/web-resume-mark.svg` |

只登记主站与一个精确 HTTPS 开发 Origin；GitHub Pages、Netlify 等静态镜像不获得登录能力。客户端只能申请身份启动 scope，不能接收主站 session、refresh token 或持久 CloudBase token。

## 发布门禁

1. `@yunlefun/sso` Consumer、Drive BFF、同源代理和服务端会话测试通过。
2. `web_resume_documents` 为 `ADMINONLY`，所需复合索引完成并复核。
3. 私有 COS 只允许精确主站/开发 Origin 的 `PUT`，且完成小文件 checksum 冒烟。
4. `user-storage-api` 与回收站 sweeper 使用两个不复用的高熵服务令牌。
5. 先发布后端并保持 `NUXT_WEB_RESUME_ENABLED=false` / `YLF_CLOUD_API_ENABLED=false`，再走 Registry draft、审批、CI release 与 Consumer smoke。
6. Registry 发布后再开启主站 `VITE_YLF_CLOUD_ENABLED=true` 和代理/BFF 开关；静态镜像继续关闭。

任何 production Registry saveDraft、审批、发布或 Consumer 部署都必须在单独的生产变更确认后执行。
