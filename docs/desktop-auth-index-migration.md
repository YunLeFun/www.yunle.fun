# 桌面授权验证码索引

设备授权记录只保存 `userCodeHash`。旧的 `uniq_userCode` 非稀疏唯一索引会把缺失的明文字段当作同一 null 键，导致第二条新格式记录失败。生产日志已确认 `E11000 ... index: uniq_userCode dup key: { userCode: null }`。

使用唯一稀疏索引 `uniq_userCodeHash`（`userCodeHash: 1`）约束当前协议，并兼容没有 hash 的历史记录。迁移先创建、回读新索引，再单独删除旧索引；保留数据、其它索引和现有非公开 ACL。不要删除历史记录以绕过索引冲突。

## 检查与迁移

```bash
# 只读计划，不改变资源；--check 在发现迁移需求时返回非零退出码。
node scripts/check-desktop-auth-indexes.mjs production
node scripts/check-desktop-auth-indexes.mjs production --check

# 经明确批准后执行；环境确认值必须准确匹配。
node scripts/check-desktop-auth-indexes.mjs production --apply \
  --confirm-env=yunlefun-8g7ybcxc7345c490
```

脚本默认只读。发现重复／非字符串 hash、同名索引定义不一致、额外明文唯一约束、公开 ACL 或执行过程中权限／其它索引变化时停止。数据库计数和索引元数据可输出，验证码、令牌和私钥不可输出。API 定义见 [CloudBase UpdateTable](https://cloud.tencent.com/document/product/876/127964)。

`deploy-registry-consumers.mjs` 和 `deploy-function.mjs` 在部署 `desktop-auth` 前执行只读检查；部署脚本不会自动修改数据库。直接从控制台／原始 CLI 绕过部署脚本时，操作者也必须先通过此检查。

## 2026-09-22 执行记录

- 用户批准本次共享生产数据库迁移。
- 隔离 MongoDB 7.0.14 验证：旧索引拒绝第二条不同 hash 的新授权；运行实际迁移算法后成功插入；重复 hash 仍被拒绝；多条历史无 hash 记录保留；重复执行无操作。
- 生产迁移前 6 条记录，5 条无 hash，无重复／非字符串 hash，ACL 为 `PRIVATE`。新索引创建并验证后移除旧索引，6 条记录及 ACL 原样保留。
- 使用 CMS 实际账号协议连续创建两次生产 `cms-desktop` 授权，两次均生成授权码且保持 pending；未批准时不颁发 refresh token，错误安装密钥和超额 scope 被拒绝。临时授权按原有 TTL 失效。
- 生产再次 `--check` 返回 `ready=true`、`plan=[]`，共 8 条记录（含两个 smoke 请求），5 条历史记录仍在，ACL 仍为 `PRIVATE`。
- 完整真实账号批准、entitlement、刷新和撤销属于独立登录验收，本次不宣称已经完成。

## 失败处理

创建失败时保留旧索引；删除失败时保留已创建的 hash 索引并报告状态。成功恢复多条新格式写入后，旧非稀疏唯一索引已无法重建，不能通过删除用户记录回退。应保留 hash 唯一约束并向前修复，也不能回退到仍写明文验证码的旧实现。
