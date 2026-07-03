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

文件索引表。配额只以这张表的状态机为准，不扫描 CloudBase Storage 目录。

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
  "fileId": "",
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

上传前调用。服务端校验单文件 200MB、总配额、app/kind policy 和并发版本，然后返回后端生成的 `storageKey`。

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
  "deduped": false
}
```

### `finalizeStorageUpload`

上传 CloudBase Storage 成功后调用。服务端会：

- 确认 `fileId` 路径匹配 reserve 返回的 `storageKey`
- 通过 `@cloudbase/node-sdk#getFileInfo` 读取真实 `content-length`
- 确认真实大小不超过 reserve 大小和 200MB
- 将 `reservedBytes` 转为 `usedBytes`

入参：

```jsonc
{
  "action": "finalizeStorageUpload",
  "reservationId": "<reservationId>",
  "fileId": "cloud://env.xxx/user-storage/..."
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
- `brush-library` 是 singleton：`finalizeStorageUpload` 成功后，同一 `userId + appId + kind + slotKey` 只保留最新 active 文件，并释放旧文件 quota。

### `downloadStorageFile`

下载当前用户的 active 文件。服务端只校验登录态归属、文件状态、app/kind policy 和 `maxBytes`，不解析业务格式；
小文件会随函数响应返回 `text`，较大文件返回 CloudBase 临时下载 URL，由前端自行 fetch。

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
  "downloadUrl": "https://...",
  "text": "{...}" // 小文件才返回
}
```

### `deleteStorageFile`

删除对象并释放用量。服务端会先调用 CloudBase Storage `deleteFile`，成功后把索引标记为 `deleted`，
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
3. 应用用返回的 `storageKey` 上传到 CloudBase Storage。
4. 上传成功后调用 `finalizeStorageUpload`。
5. 删除时优先调用 `deleteStorageFile`，不要只删 Storage 对象。

`saier` 侧只保留前端提示、文件格式解析与合并策略，所有权威 quota / path / ownership 判断都以 `user-storage-api` 返回为准。`user-storage-api` 不解析 `saier.brush-library.v1` 或 `BrushPreset`。
