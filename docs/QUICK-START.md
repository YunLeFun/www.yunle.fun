# 🚀 前端 GitHub OAuth 快速启动指南

> ⏱️ 预计耗时：5 分钟

---

## ✅ 前提条件

1. 后端 API 已配置并运行
   - 运行在 `http://localhost:3000`
   - GitHub OAuth 已配置
   - 数据库迁移已完成

2. 已安装依赖
   ```bash
   pnpm install
   ```

---

## 🔧 配置步骤

### 第 1 步：创建环境变量文件

```bash
cd /Users/yunyou/repos/gh/ylf/www.yunle.fun

# 创建 .env 文件
cat > .env << EOF
# 后端 API 地址
NUXT_PUBLIC_API_BASE_URL=http://localhost:3000

# 站点 URL
NUXT_PUBLIC_SITE_URL=http://localhost:5173

# GitHub Client ID（可选）
NUXT_PUBLIC_GITHUB_CLIENT_ID=
EOF
```

### 第 2 步：启动开发服务器

```bash
pnpm dev
```

应该看到：

```
Nuxt 3.x.x with Nitro x.x.x
  ➜ Local:   http://localhost:5173/
```

---

## 🧪 测试登录

### 1. 访问登录页面

```
http://localhost:5173/login
```

### 2. 点击 GitHub 登录按钮

- 应该跳转到 GitHub 授权页面
- URL 类似：`https://github.com/login/oauth/authorize?client_id=xxx`

### 3. 在 GitHub 授权

点击 **"Authorize"** 按钮

### 4. 验证登录成功

- 自动跳转到 `/auth/github-callback`
- 显示 "登录成功" 消息
- 1 秒后跳转到首页
- 导航栏显示用户头像和名称

---

## ✅ 验证清单

完成以下检查：

- [ ] 前端服务运行在 http://localhost:5173
- [ ] 后端服务运行在 http://localhost:3000
- [ ] 能访问登录页面
- [ ] 点击 GitHub 登录跳转到 GitHub
- [ ] GitHub 授权后重定向回前端
- [ ] 回调页面显示 "登录成功"
- [ ] 自动跳转到首页
- [ ] 导航栏显示用户信息
- [ ] 点击用户头像显示下拉菜单
- [ ] 退出登录功能正常
- [ ] 刷新页面保持登录状态

---

## 🔍 查看详细信息

### 浏览器开发工具

1. **Network 标签**:
   - 查看 API 请求
   - 检查 Cookie 是否设置

2. **Application 标签**:
   - Cookies > http://localhost:5173
   - 应该看到 `access_token` 和 `refresh_token`

3. **Console 标签**:
   - 查看是否有错误信息

### API 请求示例

```bash
# 获取用户信息（带 Cookie）
curl http://localhost:3000/auth/profile \
  --cookie "access_token=你的token"
```

---

## 🐛 常见问题

### 问题 1: CORS 错误

**错误消息**: `Access to fetch has been blocked by CORS policy`

**解决**:
检查后端 CORS 配置：

```typescript
// 后端 src/main.ts
app.enableCors({
  origin: 'http://localhost:5173', // ← 前端地址
  credentials: true, // ← 必须
})
```

### 问题 2: Cookie 未设置

**错误消息**: `401 Unauthorized`

**检查**:

1. 后端是否正确设置了 Cookie
2. 前端请求是否包含 `credentials: 'include'`
3. CORS 配置是否正确

**解决**:

```typescript
// app/composables/useAuth.ts
const response = await fetch(url, {
  credentials: 'include', // ← 必须
})
```

### 问题 3: 回调页面一直加载

**症状**: `/auth/github-callback` 页面显示 "处理中"

**检查**:

1. 打开浏览器控制台查看错误
2. 检查 Network 标签的 `/auth/profile` 请求
3. 确认后端正确设置了 Cookie

**解决**:
检查后端重定向 URL：

```bash
# 后端 .env.local
GITHUB_LOGIN_REDIRECT_URL="http://localhost:5173/auth/github-callback"
```

### 问题 4: 后端无法连接

**错误消息**: `Failed to fetch`

**解决**:

```bash
# 确认后端正在运行
cd /Users/yunyou/repos/gh/ylf/api
pnpm dev

# 测试后端
curl http://localhost:3000/auth/github
```

---

## 📝 快速命令

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build

# 预览生产版本
pnpm preview

# 类型检查
pnpm typecheck

# Lint 检查
pnpm lint
```

---

## 🎯 下一步

### 完成基础配置后，你可以：

1. **自定义登录页面**
   - 修改 `app/pages/login.vue`
   - 调整样式和文案

2. **添加更多 OAuth 提供商**
   - Google 登录
   - Apple 登录
   - 微信登录

3. **完善用户中心**
   - 创建个人中心页面
   - 账号设置页面
   - 安全设置页面

4. **添加受保护的路由**
   - 在 `auth.global.ts` 中配置
   - 或使用页面级中间件

---

## 📚 相关文档

- [完整实现文档](./GITHUB-OAUTH-FRONTEND.md)
- [后端 OAuth 文档](../../api/docs/github-oauth-implementation.md)
- [Nuxt 官方文档](https://nuxt.com)
- [GitHub OAuth 文档](https://docs.github.com/en/developers/apps/building-oauth-apps)

---

## 🎉 成功！

如果你完成了上面的所有步骤，恭喜！你已经成功集成了 GitHub OAuth 登录功能。

现在用户可以：

- ✅ 使用 GitHub 账号快速登录
- ✅ 自动同步 GitHub 个人信息
- ✅ 享受安全的登录体验

如有问题，请查阅 [完整实现文档](./GITHUB-OAUTH-FRONTEND.md)。
