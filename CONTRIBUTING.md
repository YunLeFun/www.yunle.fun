# 贡献指南

感谢你帮助改进云乐坊。小型修复可以直接提交 Pull Request；较大的功能或架构调整建议先创建 Feature Request 或 Discussion，说明目标、范围和迁移影响。

## 开发环境

1. 安装 Node.js 22，并启用 Corepack。
2. Fork 仓库后从 `main` 创建短生命周期分支。
3. 运行 `pnpm install`。
4. 将 `.env.example` 复制为 `.env.local`，只填写本地 development 凭据。
5. 运行 `pnpm dev` 开始开发。

真实密钥、生产 EnvId、用户数据、支付材料和平台导出文件不得提交。若凭据曾进入 Git 历史，请立即吊销并轮换，而不是只删除文件。

## 提交前检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

尽量为行为变更添加回归测试。涉及工作流、授权、支付、数据库规则或部署脚本时，应覆盖成功路径和拒绝路径，并在 PR 中记录实际验证环境。

## 代码约定

- 使用 ESM、严格 TypeScript、单引号和无分号风格。
- 遵循现有 Nuxt、Vue 和 CloudBase 边界，不把服务端密钥放入 `NUXT_PUBLIC_*`。
- Git 提交使用 Conventional Commits，例如 `feat(auth): add session renewal`。
- 一个提交只处理一个清晰主题；无关调整应拆分。
- 不手工编辑 Registry 生成产物。Registry 或授权核心变化必须通过签名发布链路生成。

## CloudBase 与 production

默认贡献不需要访问 YunLeFun 的云环境。云函数改动应先通过本地测试，再在隔离的 development 租户验证。不要创建新公开入口、修改安全规则、部署 CloudRun，或触碰 production，除非维护者已明确批准目标和回滚方案。

## Pull Request

PR 描述应包括：

- 变更目的和用户影响
- 测试命令与结果
- 安全、数据和部署影响
- UI 变更截图或录屏（如适用）
- 回滚方式（涉及部署或迁移时）

CI 通过并不代表可以自动发布 production。维护者可能要求补充 development smoke、人工审批或分阶段发布。
