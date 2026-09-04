# 云空间全局配额中心

> 状态：服务端配额核心已落在 `cloudfunctions/user-storage-api/storage.js`，并通过
> `user-storage-api` action 暴露给各应用。`account-api` 不承载云空间 action。

## 1. 规则

| 项目       | 规则                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| 普通用户   | 100MB                                                                  |
| 会员用户   | 1GB                                                                    |
| 单文件上限 | 200MB                                                                  |
| 超限后     | 禁止新上传，允许下载 / 删除                                            |
| 扩容       | 通过 `addonQuotaBytes` / `bonusQuotaBytes` 增加，总额写入 `quotaBytes` |

实际上传上限为 `min(200MB, availableBytes)`。

会员不是删除策略：会员到期后 `baseQuotaBytes` 从 1GB 降回 100MB；如果已用量超过新额度，
用户进入 `isOverQuota=true` 状态，只禁止新上传，文件仍可下载和删除。

## 2. 数据模型

### `user_storage_quotas`

一个用户一条全局配额记录，所有应用共享。`_id` 固定为 CloudBase `uid`，`userId` 字段保留给查询与旧代码兼容。

```jsonc
{
  "_id": "<cloudbase uid>",
  "userId": "<cloudbase uid>",
  "baseQuotaBytes": 104857600,
  "addonQuotaBytes": 0,
  "bonusQuotaBytes": 0,
  "quotaBytes": 104857600,
  "usedBytes": 0,
  "reservedBytes": 0,
  "membershipActive": false,
  "membershipLevel": null,
  "membershipExpireAt": null,
  "version": 1,
  "createdAt": 1735689000000,
  "updatedAt": 1735689600000
}
```

索引：

| 索引名     | 字段         | 唯一性 |
| ---------- | ------------ | ------ |
| `idx_user` | `userId` ASC | 唯一   |

> 服务端会兼容读取历史 `add({ userId })` 产生的 auto-id 文档，并在懒同步时迁移出 `_id == uid` 的规范文档。

### `user_storage_files`

文件索引表。配额只以这张表的状态机为准，不扫描 COS 对象列表。

```jsonc
{
  "_id": "<reservationId>",
  "reservationId": "<reservationId>",
  "userId": "<cloudbase uid>",
  "appId": "saier",
  "status": "reserved", // reserved | finalizing | active | deleted | expired
  "fileName": "photo.png",
  "contentType": "image/png",
  "storageKey": "user-storage/<uid>/<appId>/<reservationId>/photo.png",
  "fileId": "", // finalize 后为 cos://bucket/key，不含任何签名
  "storageProvider": "",
  "storageBucket": "",
  "storageRegion": "",
  "objectKey": "",
  "objectETag": "",
  "sizeBytes": 0,
  "reservedSizeBytes": 41943040,
  "sha256": "",
  "reservationExpiresAt": 1735690800000,
  "createdAt": 1735689000000,
  "updatedAt": 1735689000000
}
```

索引：

| 索引名                     | 字段                                                      | 唯一性 |
| -------------------------- | --------------------------------------------------------- | ------ |
| `idx_user_status_time`     | `userId` ASC, `status` ASC, `createdAt` DESC              | 非唯一 |
| `idx_user_app_status_time` | `userId` ASC, `appId` ASC, `status` ASC, `createdAt` DESC | 非唯一 |
| `idx_user_file_id`         | `userId` ASC, `fileId` ASC                                | 非唯一 |
| `idx_user_storage_key`     | `userId` ASC, `storageKey` ASC                            | 唯一   |

`reservationId` 使用 `_id`，天然唯一。建议 `storageKey` 也保持唯一，避免同一对象路径被重复索引。

## 3. Action 合约

所有写入 action 都必须通过 CloudBase Auth 登录态调用 `user-storage-api`，`userId` 由云函数读取调用者 uid，
前端不能传别人的 uid。

### `getStorageQuota`

读取当前用户配额，并懒同步会员状态。

返回：

```jsonc
{
  "quotaBytes": 104857600,
  "baseQuotaBytes": 104857600,
  "addonQuotaBytes": 0,
  "bonusQuotaBytes": 0,
  "usedBytes": 0,
  "reservedBytes": 0,
  "availableBytes": 104857600,
  "isOverQuota": false,
  "singleFileLimitBytes": 209715200,
  "membership": { "isActive": false, "level": null, "expireAt": null }
}
```

### `reserveStorageUpload`

上传前调用。服务端校验单文件 200MB、总配额、app/kind policy 和并发版本，然后：

- 生成服务端控制的 `storageKey`；
- 使用云函数运行角色的临时凭证，为该精确对象键签发 10 分钟 PUT URL；
- 把要求签入的请求头一并返回。客户端必须原样携带这些 header。

签名 URL 只存在于本次响应，不写入数据库或日志。

入参：

```jsonc
{
  "action": "reserveStorageUpload",
  "appId": "saier",
  "kind": "project",
  "sizeBytes": 41943040,
  "fileName": "photo.png",
  "contentType": "image/png",
  "sha256": "",
  "reservationId": "optional-client-idempotency-key"
}
```

返回：

```jsonc
{
  "quota": { "reservedBytes": 41943040 },
  "file": {
    "reservationId": "<reservationId>",
    "status": "reserved",
    "storageKey": "user-storage/...",
    "reservedSizeBytes": 41943040,
    "reservationExpiresAt": 1735690800000
  },
  "upload": {
    "method": "PUT",
    "url": "https://...cos.ap-shanghai.myqcloud.com/user-storage/...?q-signature=...",
    "headers": { "Content-Type": "application/json" },
    "expiresAt": 1735689600000
  },
  "deduped": false
}
```

### `finalizeStorageUpload`

客户端 PUT 成功后调用。客户端不再提交或决定 `fileId`；服务端会：

- 对 reserve 中保存的精确 `storageKey` 发起 COS HEAD；
- 校验真实 `content-length`、`content-type` 与预留策略；
- 确认真实大小不超过 reserve 大小和 200MB；
- 超限或类型不匹配时删除对象并释放预留；
- 只把不含签名的 `cos://bucket/key` 规范引用写入 `fileId`；
- 将 `reservedBytes` 转为 `usedBytes`

入参：

```jsonc
{
  "action": "finalizeStorageUpload",
  "reservationId": "<reservationId>"
}
```

### `listStorageFiles`

列当前用户文件索引，默认只返回 `active` 文件。

入参：

```jsonc
{
  "action": "listStorageFiles",
  "appId": "saier",
  "kind": "project",
  "skip": 0,
  "limit": 20
}
```

`kind` / `slotKey` 是通用存储元数据，不代表后端理解业务文件内容：

- Saier 项目文件：`kind: "project"`，不使用 `slotKey`。
- Saier 笔刷库：`kind: "brush-library"`、`slotKey: "default"`、固定文件名 `brush-library.saier.brushes.json`、`contentType: "application/json"`，单文件额外限制 256KiB。
- 素材原图：`kind: "asset"`，不使用 `slotKey`，非 singleton；仅接受扩展名与 `contentType` 一致的 JPEG、PNG、WebP、SVG，沿用 200MiB 单文件上限和用户共享存储额度。可选 `sha256` 只作为客户端候选值保存，文件头、尺寸、权威哈希和 SVG 栅格预览由 Drive 素材层校验与生成。
- Web Resume：`appId: "web-resume"`、`kind: "resume"`，`slotKey` 固定为 `doc_<documentId>`，只接受 `.resume.yml` / `.resume.yaml` 与 YAML Content-Type，单文件限制 2MiB。服务端在 finalize 时读取私有对象并核对 SHA-256；同一 `slotKey` 为 singleton。
- `brush-library` 是 singleton：`finalizeStorageUpload` 成功后，同一 `userId + appId + kind + slotKey` 只保留最新 active 文件，并释放旧文件 quota。

Web Resume 浏览器不直接调用通用存储 action。Drive BFF 验证 `@yunlefun/sso` 双证明并建立独立 HttpOnly 会话后，使用专用 `WEB_RESUME_STORAGE_INTERNAL_TOKEN` 委托到严格限定的 `invokeForWebResume`；委托层强制覆盖 app、kind 和 Content-Type，并再次校验文件归属。业务元数据位于 `ADMINONLY` 的 `web_resume_documents` 集合，本地姓名、电话、邮箱和设备偏好不进入该集合。

删除 Web Resume 文档先把元数据标记为回收站状态。私有 `web-resume-storage-sweeper` 每小时处理保留满 30 天的记录，通过带租约的 `purging` 状态阻止恢复竞态，删除 COS 对象并释放配额后才移除元数据。清理使用独立的 `WEB_RESUME_SWEEPER_INTERNAL_TOKEN`，不能与 BFF 委托令牌复用。

### `downloadStorageFile`

下载当前用户的 active 文件。服务端校验登录态归属、文件状态、app/kind policy 和 `maxBytes`，再为精确对象键
签发 5 分钟 GET URL。最多 4MiB 的 JSON/文本可同时随函数响应返回 `text`；二进制或较大文件只返回短期 URL。

入参：

```jsonc
{
  "action": "downloadStorageFile",
  "reservationId": "<reservationId>",
  "maxBytes": 4194304
}
```

返回：

```jsonc
{
  "file": { "reservationId": "<reservationId>", "status": "active" },
  "quota": { "usedBytes": 512 },
  "downloadUrl": "https://...?q-signature=...",
  "downloadUrlExpiresAt": 1735689300000,
  "text": "{...}" // 小文件才返回
}
```

### `deleteStorageFile`

删除对象并释放用量。服务端会先调用 COS `DeleteObject`，成功后把索引标记为 `deleted`，
并扣减 `usedBytes` 或 `reservedBytes`。重复调用幂等。

入参：

```jsonc
{
  "action": "deleteStorageFile",
  "reservationId": "<reservationId>"
}
```

## 4. 接入顺序

1. 应用读取 `getStorageQuota`，展示剩余空间和单文件上限。
2. 用户选择文件后，应用调用 `reserveStorageUpload`。
3. 应用使用返回的 `upload.method + upload.url + upload.headers` 直接 PUT 到私有 COS。
4. PUT 成功后只提交 `reservationId` 调用 `finalizeStorageUpload`。
5. 删除时优先调用 `deleteStorageFile`，不要只删 Storage 对象。

`saier` 侧只保留前端提示、文件格式解析与合并策略，所有权威 quota / path / ownership 判断都以 `user-storage-api` 返回为准。`user-storage-api` 不解析 `saier.brush-library.v1` 或 `BrushPreset`。

## 5. 私有 COS 运行配置

- Bucket：默认 `yunlefun-private-1325586649`，可由 `PRIVATE_COS_BUCKET` 覆盖。
- Region：默认 `ap-shanghai`，可由 `PRIVATE_COS_REGION` 覆盖。
- URL TTL：上传默认 600 秒、下载默认 300 秒，可由
  `PRIVATE_COS_UPLOAD_URL_TTL_SECONDS` / `PRIVATE_COS_DOWNLOAD_URL_TTL_SECONDS` 调整（60~3600 秒）。
- 凭证：只读取 SCF 运行角色注入的 `TENCENTCLOUD_SECRETID`、
  `TENCENTCLOUD_SECRETKEY`、`TENCENTCLOUD_SESSIONTOKEN`，不配置长期密钥。
- 运行角色按最小权限授予该桶 `PutObject`、`GetObject`、`HeadObject`、`DeleteObject`；
  Bucket ACL 保持 private。
- Web 直传只为一方站点配置精确 CORS Origin，允许 `PUT` / `GET`，允许请求头 `Content-Type`；
  不使用带凭证的通配 Origin。

CloudBase 默认云存储仅承载公开可读内容（例如头像）。用户项目、笔刷库、素材原图等私有内容统一进入独立私有 COS，
两类对象不得混存。
