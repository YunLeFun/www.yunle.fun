import { describe, expect, it } from 'vitest'

import { MEMBERSHIPS_COLLECTION } from '../../cloudfunctions/account-api/lib/orders.js'
import {
  cleanupExpiredReservations,
  deleteStorageFile,
  finalizeStorageUpload,
  getStorageQuota,
  listStorageFiles,
  MEMBER_STORAGE_QUOTA_BYTES,
  NORMAL_STORAGE_QUOTA_BYTES,
  reserveStorageUpload,
  SINGLE_FILE_LIMIT_BYTES,
  STORAGE_FILE_STATUS,
  USER_STORAGE_FILES_COLLECTION,
  USER_STORAGE_QUOTAS_COLLECTION,
} from '../../cloudfunctions/account-api/storage.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const MB = 1024 * 1024

function fileIdFor(storageKey) {
  return `cloud://yunlefun-8g7ybcxc7345c490.abc/${storageKey}`
}

describe('account-api storage quota', () => {
  it('普通用户默认 100MB，会员懒同步为 1GB', async () => {
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [
        { _id: 'm1', userId: 'vip', level: 'basic', expireAt: NOW + 86_400_000 },
      ],
    })

    const free = await getStorageQuota(db, { userId: 'free', now: NOW })
    expect(free.quotaBytes).toBe(NORMAL_STORAGE_QUOTA_BYTES)
    expect(free.membership.isActive).toBe(false)
    expect(db._store[USER_STORAGE_QUOTAS_COLLECTION].find(item => item.userId === 'free')).toMatchObject({
      _id: 'free',
      userId: 'free',
    })

    const vip = await getStorageQuota(db, { userId: 'vip', now: NOW })
    expect(vip.quotaBytes).toBe(MEMBER_STORAGE_QUOTA_BYTES)
    expect(vip.membership).toMatchObject({ isActive: true, level: 'basic', expireAt: NOW + 86_400_000 })
  })

  it('配额记录使用 uid 作为 _id，重复懒同步不会创建第二条', async () => {
    const db = makeFakeDb()

    await getStorageQuota(db, { userId: 'u1', now: NOW })
    await getStorageQuota(db, { userId: 'u1', now: NOW + 1 })

    expect(db._store[USER_STORAGE_QUOTAS_COLLECTION]).toHaveLength(1)
    expect(db._store[USER_STORAGE_QUOTAS_COLLECTION][0]).toMatchObject({
      _id: 'u1',
      userId: 'u1',
      quotaBytes: NORMAL_STORAGE_QUOTA_BYTES,
    })
  })

  it('读取 legacy quota 后迁移到 uid _id 并保留已用与扩容', async () => {
    const db = makeFakeDb({
      [USER_STORAGE_QUOTAS_COLLECTION]: [
        {
          _id: 'legacy-quota',
          userId: 'u1',
          baseQuotaBytes: NORMAL_STORAGE_QUOTA_BYTES,
          addonQuotaBytes: 20 * MB,
          bonusQuotaBytes: 5 * MB,
          quotaBytes: NORMAL_STORAGE_QUOTA_BYTES + 25 * MB,
          usedBytes: 12 * MB,
          reservedBytes: 3 * MB,
          version: 9,
        },
      ],
    })

    const quota = await getStorageQuota(db, { userId: 'u1', now: NOW })

    expect(quota).toMatchObject({
      addonQuotaBytes: 20 * MB,
      bonusQuotaBytes: 5 * MB,
      usedBytes: 12 * MB,
      reservedBytes: 3 * MB,
    })
    expect(db._store[USER_STORAGE_QUOTAS_COLLECTION].some(item => item._id === 'u1')).toBe(true)
    expect(db._store[USER_STORAGE_QUOTAS_COLLECTION].filter(item => item.userId === 'u1')).toHaveLength(2)
  })

  it('会员到期后降回普通额度，但保留 addon 扩容', async () => {
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [
        { _id: 'm1', userId: 'u1', level: 'basic', expireAt: NOW - 1 },
      ],
      [USER_STORAGE_QUOTAS_COLLECTION]: [
        {
          _id: 'q1',
          userId: 'u1',
          baseQuotaBytes: MEMBER_STORAGE_QUOTA_BYTES,
          addonQuotaBytes: 50 * MB,
          bonusQuotaBytes: 10 * MB,
          quotaBytes: MEMBER_STORAGE_QUOTA_BYTES + 60 * MB,
          usedBytes: 120 * MB,
          reservedBytes: 0,
          membershipActive: true,
          version: 1,
        },
      ],
    })

    const quota = await getStorageQuota(db, { userId: 'u1', now: NOW })
    expect(quota.baseQuotaBytes).toBe(NORMAL_STORAGE_QUOTA_BYTES)
    expect(quota.addonQuotaBytes).toBe(50 * MB)
    expect(quota.bonusQuotaBytes).toBe(10 * MB)
    expect(quota.quotaBytes).toBe(160 * MB)
    expect(quota.usedBytes).toBe(120 * MB)
    expect(quota.isOverQuota).toBe(false)
  })

  it('reserve 拦截单文件 200MB 和总额度超限', async () => {
    const db = makeFakeDb()

    await expect(
      reserveStorageUpload(db, { userId: 'u1', appId: 'saier', sizeBytes: SINGLE_FILE_LIMIT_BYTES + 1, fileName: 'big.bin', now: NOW }),
    ).rejects.toThrow(/单文件/)

    await expect(
      reserveStorageUpload(db, { userId: 'u1', appId: 'saier', sizeBytes: 120 * MB, fileName: 'too-large.bin', now: NOW }),
    ).rejects.toThrow(/容量不足/)
  })

  it('reserve 成功后写入文件索引并增加 reservedBytes', async () => {
    const db = makeFakeDb()

    const res = await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 40 * MB,
      fileName: 'photo.png',
      contentType: 'image/png',
      reservationId: 'res_12345678',
      now: NOW,
    })

    expect(res.quota.reservedBytes).toBe(40 * MB)
    expect(res.file).toMatchObject({
      id: 'res_12345678',
      reservationId: 'res_12345678',
      appId: 'saier',
      status: STORAGE_FILE_STATUS.RESERVED,
      fileName: 'photo.png',
      reservedSizeBytes: 40 * MB,
    })
    expect(res.file.storageKey).toContain('user-storage/')
    expect(db._store[USER_STORAGE_FILES_COLLECTION]).toHaveLength(1)
    expect(db._store[USER_STORAGE_FILES_COLLECTION][0]._id).toBe('res_12345678')
  })

  it('finalize 使用真实文件大小把 reserved 转为 used', async () => {
    const db = makeFakeDb()
    const reserved = await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 40 * MB,
      fileName: 'photo.png',
      reservationId: 'res_final1',
      now: NOW,
    })
    const fileId = fileIdFor(reserved.file.storageKey)

    const res = await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'res_final1', fileId, now: NOW + 1 },
      { readFileInfo: async () => ({ sizeBytes: 25 * MB, contentType: 'image/png' }) },
    )

    expect(res.quota.usedBytes).toBe(25 * MB)
    expect(res.quota.reservedBytes).toBe(0)
    expect(res.file).toMatchObject({
      status: STORAGE_FILE_STATUS.ACTIVE,
      fileId,
      sizeBytes: 25 * MB,
      reservedSizeBytes: 40 * MB,
    })
  })

  it('finalize 拒绝伪造 storageKey 或 fileId', async () => {
    const db = makeFakeDb()
    const reserved = await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 10 * MB,
      fileName: 'photo.png',
      reservationId: 'res_guard1',
      now: NOW,
    })

    await expect(
      finalizeStorageUpload(
        db,
        {
          userId: 'u1',
          reservationId: 'res_guard1',
          fileId: fileIdFor(reserved.file.storageKey),
          storageKey: 'user-storage/u2/saier/res_guard1/photo.png',
          now: NOW + 1,
        },
        { readFileInfo: async () => ({ sizeBytes: 5 * MB, contentType: 'image/png' }) },
      ),
    ).rejects.toThrow(/storageKey/)

    await expect(
      finalizeStorageUpload(
        db,
        {
          userId: 'u1',
          reservationId: 'res_guard1',
          fileId: fileIdFor('user-storage/u2/saier/res_guard1/photo.png'),
          now: NOW + 2,
        },
        { readFileInfo: async () => ({ sizeBytes: 5 * MB, contentType: 'image/png' }) },
      ),
    ).rejects.toThrow(/fileId/)
  })

  it('finalize 拒绝超过 reserve 的真实文件并释放 reserved', async () => {
    const db = makeFakeDb()
    const reserved = await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 20 * MB,
      fileName: 'photo.png',
      reservationId: 'res_final2',
      now: NOW,
    })

    await expect(
      finalizeStorageUpload(
        db,
        { userId: 'u1', reservationId: 'res_final2', fileId: fileIdFor(reserved.file.storageKey), now: NOW + 1 },
        { readFileInfo: async () => ({ sizeBytes: 25 * MB, contentType: 'image/png' }) },
      ),
    ).rejects.toThrow(/实际文件大小/)

    const quota = await getStorageQuota(db, { userId: 'u1', now: NOW + 2 })
    const file = db._store[USER_STORAGE_FILES_COLLECTION][0]
    expect(quota.reservedBytes).toBe(0)
    expect(quota.usedBytes).toBe(0)
    expect(file.status).toBe(STORAGE_FILE_STATUS.EXPIRED)
  })

  it('deleteStorageFile 允许删除并幂等释放 usedBytes', async () => {
    const db = makeFakeDb()
    const reserved = await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 40 * MB,
      fileName: 'photo.png',
      reservationId: 'res_delete1',
      now: NOW,
    })
    const fileId = fileIdFor(reserved.file.storageKey)
    await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'res_delete1', fileId, now: NOW + 1 },
      { readFileInfo: async () => ({ sizeBytes: 25 * MB, contentType: 'image/png' }) },
    )

    const deleted = await deleteStorageFile(db, { userId: 'u1', reservationId: 'res_delete1', now: NOW + 2 })
    expect(deleted.quota.usedBytes).toBe(0)
    expect(deleted.file.status).toBe(STORAGE_FILE_STATUS.DELETED)

    const repeated = await deleteStorageFile(db, { userId: 'u1', reservationId: 'res_delete1', now: NOW + 3 })
    expect(repeated.deduped).toBe(true)
    expect(repeated.quota.usedBytes).toBe(0)
  })

  it('deleteStorageFile 在云存储对象删除失败时不释放 usedBytes', async () => {
    const db = makeFakeDb()
    const reserved = await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 40 * MB,
      fileName: 'photo.png',
      reservationId: 'res_delete2',
      now: NOW,
    })
    const fileId = fileIdFor(reserved.file.storageKey)
    await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'res_delete2', fileId, now: NOW + 1 },
      { readFileInfo: async () => ({ sizeBytes: 25 * MB, contentType: 'image/png' }) },
    )

    await expect(
      deleteStorageFile(
        db,
        { userId: 'u1', reservationId: 'res_delete2', now: NOW + 2 },
        { deleteFile: async () => ({ code: 'DELETE_FAILED' }) },
      ),
    ).rejects.toThrow(/删除云存储对象失败/)

    const quota = await getStorageQuota(db, { userId: 'u1', now: NOW + 3 })
    expect(quota.usedBytes).toBe(25 * MB)
    expect(db._store[USER_STORAGE_FILES_COLLECTION][0].status).toBe(STORAGE_FILE_STATUS.ACTIVE)
  })

  it('清理过期 reserve 会释放 reservedBytes', async () => {
    const db = makeFakeDb()
    await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 30 * MB,
      fileName: 'draft.bin',
      reservationId: 'res_expire1',
      now: NOW,
    })

    const cleanup = await cleanupExpiredReservations(db, { userId: 'u1', now: NOW + 31 * 60 * 1000 })
    const quota = await getStorageQuota(db, { userId: 'u1', now: NOW + 31 * 60 * 1000 })

    expect(cleanup.expired).toBe(1)
    expect(quota.reservedBytes).toBe(0)
    expect(db._store[USER_STORAGE_FILES_COLLECTION][0].status).toBe(STORAGE_FILE_STATUS.EXPIRED)
  })

  it('listStorageFiles 按 appId 只返回 active 文件', async () => {
    const db = makeFakeDb()
    const saier = await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 10 * MB,
      fileName: 'a.saier.project.json',
      reservationId: 'res_list1',
      now: NOW,
    })
    const other = await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'notebook',
      sizeBytes: 10 * MB,
      fileName: 'note.json',
      reservationId: 'res_list2',
      now: NOW + 1,
    })
    await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'res_list1', fileId: fileIdFor(saier.file.storageKey), now: NOW + 2 },
      { readFileInfo: async () => ({ sizeBytes: 5 * MB, contentType: 'application/json' }) },
    )
    await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'res_list2', fileId: fileIdFor(other.file.storageKey), now: NOW + 3 },
      { readFileInfo: async () => ({ sizeBytes: 5 * MB, contentType: 'application/json' }) },
    )

    const listed = await listStorageFiles(db, { userId: 'u1', appId: 'saier' })

    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]).toMatchObject({
      appId: 'saier',
      reservationId: 'res_list1',
      status: STORAGE_FILE_STATUS.ACTIVE,
      updatedAt: NOW + 2,
    })
  })
})
