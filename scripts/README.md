# 测试脚本

此目录包含项目的测试和验证脚本。

## 可用脚本

### test-login-setup.sh

GitHub OAuth 登录流程配置检查脚本。

**用途：** 验证所有 GitHub OAuth 配置是否正确，包括：

- 后端 API 环境变量配置
- 前端环境变量配置
- 必需文件存在性检查
- 数据库表结构检查

**使用方法：**

```bash
cd /path/to/www.yunle.fun/scripts
chmod +x test-login-setup.sh
./test-login-setup.sh
```

**运行位置：** 必须在 `www.yunle.fun/scripts` 目录下运行

**检查项目：**

1. ✅ 后端 API 配置（GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, 回调 URL 等）
2. ✅ 前端配置（API_BASE_URL）
3. ✅ 关键文件存在性
4. ✅ 数据库模型定义

**输出：** 通过/警告/失败统计，以及下一步操作建议
