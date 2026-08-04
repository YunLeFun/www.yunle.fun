# Registry 变更记录：studio-web

- 状态：Approved（已合入远端基线）
- Change ID：`SSO-REGISTRY-2026-08-03-STUDIO-WEB`
- 决策日期：2026-08-03（Asia/Shanghai）
- 审批证据：`origin/main` commit `afff83c49c1383fea4f22e57c160d26cf044b3b9`
- 发布状态：已存在于当前 production 静态 Registry；本记录用于 generated JSON 迁移追溯

## 注册内容

| 字段            | Production                             | Development                                    |
| --------------- | -------------------------------------- | ---------------------------------------------- |
| `clientId`      | `studio-web`                           | `studio-web`                                   |
| `appId`         | `studio`                               | `studio`                                       |
| `displayName`   | YunYouJun Studio                       | YunYouJun Studio                               |
| `adapter`       | `web-sso`                              | `web-sso`                                      |
| `consent`       | `trusted`                              | `trusted`                                      |
| `allowedScopes` | `identity:bootstrap`                   | `identity:bootstrap`                           |
| `origin`        | `https://studio.yunyoujun.cn`          | `https://studio.yunle.localhost:3454`          |
| `redirectUri`   | `https://studio.yunyoujun.cn/`         | `https://studio.yunle.localhost:3454/`         |
| `iconUrl`       | `https://studio.yunyoujun.cn/icon.svg` | `https://studio.yunle.localhost:3454/icon.svg` |

Studio 是不可发现的个人控制面客户端：可以参与精确 SSO 授权，但不会进入公开 Explorer。注册不包含 wildcard、HTTP production 回调或额外 scope。

## Generated 快照

- Production：policy `2026-08-03.2`，14 个客户端，content hash `1aa232ec5ecf0e70b91889f26c8a92ce58d5c6827492ec49f2ac688e3d541ac7`，security hash `ea5235a28f784b8f165c64121dc47803754d392764576a990fe2621c0b72900a`。
- Development：policy `2026-08-03.2-dev`，13 个客户端，content hash `59f1065a319a86ec024d7903c8c419def6e2f95adde2282f964b8bac6142084f`，security hash `fc92944c770aacc3db7f9e787efbe4073163faee998db657724f40afe6fe7ade`。

回滚必须作为新的 Registry 变更提升 policy version，并走与 production 发布相同的审批、CI 和 smoke 流程；不得改写本记录。
