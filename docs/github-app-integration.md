# GitHub App 接入（私有仓库选择 / 校验）

> 目标：让任意用户在创建/编辑应用时选择并校验自己的 GitHub 仓库（含**私有仓库**）。
> 公开仓库现已由 `app/components/GitHubRepoInput.vue` 用**匿名** GitHub API 校验，无需本方案；
> 本方案只为「私有仓库 + 顺滑列举体验」而建，按需连接，未连接时仍回退到 `GitHubRepoInput`。

## 为什么是 GitHub App（而非代理用户 OAuth token / 单 PAT）

- 登录用的 GitHub OAuth（CloudBase 托管、**无 scope**）只证明「你是谁」，拿不到仓库读取权，且 CloudBase 不持久回传 provider token。详见记忆 `github-repo-field-no-token-proxy`。
- 多用户场景下，正确形态是 **GitHub App**：每个用户/组织各自 install、按仓库授权、签发**短期 installation token**（5000 req/h，远高于匿名 60 req/h），凭据集中在服务端。
- **这是与登录 OAuth 完全独立的第二个 GitHub 集成**，仅在用户想选私有仓库时连接。

## 密钥边界（关键）

GitHub App 的 **private key 能为所有 installation 签发 token**，属敏感密钥。按 [服务端职责划分](./server-responsibilities.md) 的原则「管理/支付密钥只留 CloudBase，不下发 EdgeOne」：

- 后端是**新建 CloudBase 云函数 `cloudfunctions/github-api`**（不是 EdgeOne server route）。
- private key / client secret **只存在于 `github-api` 函数 env**，不进客户端、不进 EdgeOne。

---

## Phase 0 — 你需要在 GitHub 上完成（凭据动作，无法代办）

1. GitHub →（组织或个人）**Settings → Developer settings → GitHub Apps → New GitHub App**
2. **GitHub App name**：全局唯一，如 `YunLeFun Apps`（记下生成的 **slug**，用于安装 URL）
3. **Homepage URL**：`https://www.yunle.fun`
4. **Callback URL**：`https://api.yunle.fun/github-api/callback`
   - 勾选 **Request user authorization (OAuth) during installation**（安装即授权，回调一次拿到 `installation_id` + `code`）
5. **Webhook**：先取消勾选 **Active**（Phase 4 再开 `…/github-api/webhook`）
6. **Permissions → Repository → Metadata: Read-only**（仅此一项；足够列举 + 校验 + 读名称/可见性/语言/stars）
7. **Where can this GitHub App be installed?**：**Any account**（允许任意用户安装）
8. 创建后：**Generate a private key**（下载 `.pem`）；记下 **App ID**、**Client ID**；**Generate a client secret**

### 填入 `github-api` 函数环境变量

| 环境变量                   | 值                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `GITHUB_APP_ID`            | 数字 App ID                                                                             |
| `GITHUB_APP_SLUG`          | App 的 URL slug（第 2 步），用于拼安装 URL                                              |
| `GITHUB_APP_PRIVATE_KEY`   | `.pem` 文件内容的 **base64**（避免多行换行问题；函数内 `Buffer.from(x,'base64')` 解码） |
| `GITHUB_APP_CLIENT_ID`     | Client ID                                                                               |
| `GITHUB_APP_CLIENT_SECRET` | Client secret                                                                           |
| `GITHUB_APP_STATE_SECRET`  | 任意随机串，用于 HMAC 签名 install 的 `state`（防伪造；也可复用现有内部 token）         |

> 生成 base64（macOS）：`base64 -i your-app.private-key.pem | pbcopy`

完成后告诉我，我开始 Phase 1。

---

## 数据模型：`github_installations` 集合

一个用户一条，记录其安装映射。

| 字段                      | 说明                             |
| ------------------------- | -------------------------------- |
| `_id`                     | CloudBase uid（主键即用户）      |
| `installationId`          | GitHub installation id（number） |
| `githubLogin`             | 安装账户 login（用户名/组织名）  |
| `accountType`             | `'User'` \| `'Organization'`     |
| `repositorySelection`     | `'all'` \| `'selected'`          |
| `createdAt` / `updatedAt` | 时间戳                           |

**索引**：`idx_installation`（installationId，非唯一，给 webhook 反查用）；`_id`=uid 即主查询键。
（按惯例同步登记到 `cloudfunctions/README.md` 索引表与本文件。）

---

## 函数契约：`cloudfunctions/github-api`

写法照搬 `account-api`：`exports.main` + `switch(action)` + `getCallerUid()` 取登录态；双入口（SDK invoke / HTTP）。

### 鉴权动作（客户端走 SDK `callFunction({ name: 'github-api', data: { action } })`）

| action          | 入参                | 出参                                                                                        |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `getConnection` | —                   | `{ connected, githubLogin?, accountType?, repositorySelection? }`                           |
| `getInstallUrl` | —                   | `{ url }`（`https://github.com/apps/{slug}/installations/new?state=<签名state>`）           |
| `listRepos`     | `{ query?, page? }` | `{ repos: [{ fullName, private, language, stargazers, description, updatedAt }], hasMore }` |
| `checkRepo`     | `{ repo }`          | `{ exists, meta?: { fullName, private, language, stargazers } }`                            |
| `disconnect`    | —                   | `{ ok }`（删本地映射；GitHub 侧卸载需用户自行操作）                                         |

### HTTP 路径（GitHub 重定向 / 回调）

| 路径                                  | 处理                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /github-api/callback`            | 校验 `state`（HMAC + TTL）→（可选）用 `code` 换 user token → upsert `github_installations` → 重定向回前端（弹窗则 `postMessage` 通知父窗后自关） |
| `POST /github-api/webhook`（Phase 4） | 校验签名 → `installation.deleted` 删映射 / `installation_repositories` 更新选择                                                                  |

### 服务端取数流程（核心）

1. 用 `GITHUB_APP_PRIVATE_KEY` 以 **RS256** 签 App JWT（Node 内置 `crypto.createSign('RSA-SHA256')`，**零额外依赖**；payload `{ iat, exp≤10min, iss: appId }`）
2. `POST /app/installations/{installationId}/access_tokens`（`Authorization: Bearer <jwt>`）→ 得 installation token（有效 1h，**按 installation 缓存至到期前 ~5min**）
3. 用 installation token 调 GitHub：
   - 列举：`GET /installation/repositories?per_page&page`
   - 校验：`GET /repos/{owner}/{repo}`（可见私有仓库 → 200 含 `private:true`；不可见 → 404）

---

## 客户端契约（Phase 3）

- `app/composables/useGitHubApp.ts`：`getConnection` / `getInstallUrl` / `listRepos` / `checkRepo` / `connect()`（复用 `useOAuth.linkIdentity` 的弹窗 + `postMessage` 范式）/ `disconnect()`
- 仓库选择器组件：
  - **已连接** → 可搜索的 `USelectMenu` 列出用户仓库（私有徽章），选中即填 `owner/repo`；手动输入用 `checkRepo`（支持私有）
  - **未连接** → 「连接 GitHub 选择私有仓库」按钮 + 现有 `GitHubRepoInput` 兜底（匿名校验公开仓库）
- 接入 `app/pages/apps/new.vue` 与 `app/pages/apps/[slug]/edit.vue`

---

## 阶段与状态

| 阶段 | 内容                                                                                    | 状态            |
| ---- | --------------------------------------------------------------------------------------- | --------------- |
| 0    | 你在 GitHub 建 App + 填 env                                                             | ⏳ 进行中（你） |
| 1    | `github-api`：JWT→token、`checkRepo`/`listRepos`/`getConnection` + 集合/索引 + 安装回调 | 待 Phase 0      |
| 2    | `getInstallUrl` + 回调落库 + 客户端弹窗连接                                             | —               |
| 3    | `useGitHubApp` + 仓库选择器，接入 new/edit                                              | —               |
| 4    | webhook 同步 + token 缓存 + 限流 + 文档收尾                                             | —               |

> 公开仓库现状（`GitHubRepoInput` 匿名校验）在全程保持可用，本方案不阻断、不替换它。
