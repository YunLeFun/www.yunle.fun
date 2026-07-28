# SES 模板验收保护

账号生命周期邮件的人工验收通过私有 CloudBase 函数入口执行。验收入口与真实用户通知队列分离，不接受命令行传入的收件人。

## 安全边界

- 默认关闭；只有 `SES_ACCEPTANCE_ENABLED=true` 时允许发送。
- 普通模板只发送到 `SES_ACCEPTANCE_EMAIL`，运维模板只发送到 `SES_OPS_EMAIL`。
- CLI 使用独立的 `SES_ACCEPTANCE_SIGNING_KEY` 生成 5 分钟有效的 HMAC 请求；密钥不会放进调用参数。
- 云端按 `runId + 模板类型 + 收件箱哈希` 在事务中先占位。重复点击、重复执行或并发调用只会有一个请求进入 SES。
- SES 的 `SmtpMessageId` 也由同一幂等键固定生成。
- 云端只保存收件箱哈希、状态和 SES MessageId，不在验收记录中保存收件地址。
- 发送失败后同一 `runId` 仍然不会自动重发。确认原因后使用新的 `runId` 明确重试。

幂等记录保存在 `account_lifecycle_acceptance_runs`，保留 90 天。状态包括 `reserved`、`submitted` 和 `failed`。

## CloudBase 资源

部署验收入口前必须显式创建 `account_lifecycle_acceptance_runs` 集合，并将集合权限设为
`ADMINONLY`。该集合只允许 `account-lifecycle-notifier` 在服务端事务中读写，不提供浏览器或其他客户端直连。

## 配置

生成一枚不可复用的随机密钥，例如：

```bash
openssl rand -hex 32
```

将相同密钥安全地配置到 CloudBase 函数环境和本地 `.env.local`：

```dotenv
SES_ACCEPTANCE_ENABLED=true
SES_ACCEPTANCE_EMAIL=i@yunle.fun
SES_ACCEPTANCE_SIGNING_KEY=<至少 32 字节的独立随机值>
```

部署前，`scripts/deploy-function.mjs` 会检查 `cloudbaserc.json` 中声明的变量是否齐全。部署和环境配置属于线上变更，应在确认后单独执行。

## 发送验收邮件

三个包含截止时间的模板必须传入带时区的 `--deadline-at`：

```bash
node scripts/send-ses-acceptance.mjs \
  --type deletion_reminder_7d \
  --run-id template-v2-acceptance-20260728 \
  --deadline-at 2026-08-04T17:00:00+08:00
```

不包含截止时间的模板不传 `--deadline-at`：

```bash
node scripts/send-ses-acceptance.mjs \
  --type deletion_completed \
  --run-id template-v2-completed-20260728
```

重复执行完全相同的命令会返回已有状态，不会再次发信。需要进行下一轮验收时使用新的、可审计的 `runId`。
