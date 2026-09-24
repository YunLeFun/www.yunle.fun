# 桌面授权旧索引迁移提案

状态：用户已明确批准，生产迁移完成。`uniq_userCodeHash` 已创建并验证，`uniq_userCode` 已移除；原有记录、其它索引和 `PRIVATE` ACL 均保留。

实现与执行记录已随 [PR #118](https://github.com/YunLeFun/www.yunle.fun/pull/118) 合并至 `06481d564211adf84593e20b743464634b7acafa`。CI 的 lint、typecheck、1205 项测试和 build 通过；隔离真实 MongoDB 验证先红后绿，生产连续两次设备授权入口 smoke 通过。复检 `ready=true`、`plan=[]`。下面保留原迁移设计及回退限制。

## 问题与影响

生产环境 `yunlefun-8g7ybcxc7345c490` / `ap-shanghai`，数据库实例 `tnt-2la6mncfo` 的 `desktop_device_codes` 仍保留 `uniq_userCode`：字段 `userCode`、unique=true、sparse=false。当前已部署的 `desktop-auth/lib/device-codes.js` 保存 `userCodeHash`，不保存明文 `userCode`。因此存在首条新格式记录后，后续授权插入均因缺失字段的 null 唯一键冲突失败。

CLS 在 2026-09-22 的两次生产 smoke 中记录 `InsertDocument` / `DATABASE_REQUEST_FAILED`，明确错误为：

```text
E11000 duplicate key error collection: tnt-2la6mncfo.desktop_device_codes
index: uniq_userCode dup key: { userCode: null }
```

影响所有使用该函数创建设备授权的客户端，包括 `cms-desktop`；不是 Admin 审批处理故障。现有账号会话、设备及 refresh token 集合不属于本次迁移范围。

只读基线：6 条记录；5 条缺少 `userCodeHash`；1 条 hash 记录缺少 `userCode`；0 条非字符串 hash；0 组重复 hash；0 条 `expiresAt > now` 的新格式记录。执行前必须重新读取，不能把此快照当作持续成立的事实。未读取或记录验证码、refresh token 或私钥。

## 待执行的具体变更

1. 在 `www.yunle.fun` 增加可重复执行、默认只读的桌面认证索引检查／迁移脚本，以及覆盖真实旧索引冲突的回归验证。脚本绑定明确环境，遇到不符合预期的索引定义、非字符串 hash 或重复 hash 时停止。
2. 对 `desktop_device_codes` 创建 `uniq_userCodeHash`：`userCodeHash` 升序、unique=true、sparse=true。稀疏索引允许 5 条历史记录缺少 hash；不删除、不回填历史记录。
3. 回读并确认新索引字段及 unique/sparse 完全匹配后，单独删除旧 `uniq_userCode`。保留 `_id_`、`_openid_1` 和 `uniq_deviceCodeHash`；不改变 ACL、账号权限、签名密钥或 Registry。
4. 将只读索引检查接入桌面认证部署前检查，避免代码与资源结构再次脱节。

拟使用 CloudBase `UpdateTable` API（2018-06-08）的两个顺序请求，必须在确认后才可执行：

```json
{
  "EnvId": "yunlefun-8g7ybcxc7345c490",
  "Tag": "tnt-2la6mncfo",
  "TableName": "desktop_device_codes",
  "CreateIndexes": [{
    "IndexName": "uniq_userCodeHash",
    "MgoKeySchema": {
      "MgoIndexKeys": [{ "Name": "userCodeHash", "Direction": "1" }],
      "MgoIsUnique": true,
      "MgoIsSparse": true
    }
  }]
}
```

确认新索引存在且定义匹配后，再提交：

```json
{
  "EnvId": "yunlefun-8g7ybcxc7345c490",
  "Tag": "tnt-2la6mncfo",
  "TableName": "desktop_device_codes",
  "DropIndexes": [{ "IndexName": "uniq_userCode" }]
}
```

API 依据：[UpdateTable 官方文档](https://cloud.tencent.com/document/product/876/127964)、[MgoKeySchema 字段](https://cloud.tencent.cn/document/api/876/34822)。

## 验收与失败处理

- 迁移前在隔离测试集合复现：旧非稀疏唯一索引下第二条无 `userCode` 记录失败；迁移后两条不同 hash 的记录成功，相同 hash 仍失败，多条历史无 hash 记录可共存。测试不使用真实授权码。
- 生产回读索引与 ACL，确认仅预期两个索引发生变化；再次 dry-run 应无待执行变更。
- 生产 smoke 连续创建两次 `cms-desktop` 授权，确认验证码和设备码均生成、未批准时保持 pending、超额 scope 被拒绝；不输出授权码或密钥，让临时授权按 TTL 失效。
- 真实账号批准、entitlement、刷新轮换、撤销仍需独立验收；未通过前不宣称完整登录可用。
- 若新索引创建失败，保留旧索引并停止。若删除旧索引失败，保留已建 hash 索引并报告具体状态。恢复写入后不能直接重新创建旧非稀疏唯一索引，因为多条新格式记录已无法满足它；不得以删除用户记录实现回退，也不能回退到仍写明文码的旧认证实现。应保留 hash 约束并针对失败前滚修复。
