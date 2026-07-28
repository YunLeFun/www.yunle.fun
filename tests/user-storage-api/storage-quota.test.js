import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import { MEMBERSHIPS_COLLECTION } from '../../cloudfunctions/user-storage-api/lib/orders.js'
import {
  cleanupExpiredReservations,
  deleteStorageFile,
  downloadStorageFile,
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
} from '../../cloudfunctions/user-storage-api/storage.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const MB = 1024 * 1024

function fileIdFor(storageKey) {
  return `cos://yunlefun-private-1325586649/${storageKey}`
}

function privateStorageOptions(fileInfo, overrides = {}) {
  return {
    describeObject: storageKey => ({
      fileId: fileIdFor(storageKey),
      objectKey: storageKey,
      storageBucket: 'yunlefun-private-1325586649',
      storageProvider: 'cos',
      storageRegion: 'ap-shanghai',
    }),
    readFileInfo: async () => fileInfo,
    ...overrides,
  }
}

describe('user-storage-api storage quota', () => {
  it('普通用户默认 100MB，会员懒同步为 1GB', async () => {
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [
        { _id: 'vip', level: 'basic', expireAt: NOW + 86_400_000 },
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

  it('创建配额时优先使用 doc(uid).set，兼容 CloudBase 自定义 _id 写入', async () => {
    const db = makeFakeDb()
    const collection = db.collection.bind(db)

    db.collection = (name) => {
      const chain = collection(name)
      if (name !== USER_STORAGE_QUOTAS_COLLECTION)
        return chain

      chain.add = async () => {
        throw new Error('add with _id rejected')
      }

      const doc = chain.doc.bind(chain)
      chain.doc = (id) => {
        const docChain = doc(id)
        docChain.get = async () => ({ data: [] })
        docChain.set = async (payload) => {
          db._store[name].push({ _id: id, ...payload })
          return { updated: 1 }
        }
        return docChain
      }

      return chain
    }

    const quota = await getStorageQuota(db, { userId: 'u1', now: NOW })

    expect(quota.quotaBytes).toBe(NORMAL_STORAGE_QUOTA_BYTES)
    expect(db._store[USER_STORAGE_QUOTAS_COLLECTION]).toHaveLength(1)
    expect(db._store[USER_STORAGE_QUOTAS_COLLECTION][0]).toMatchObject({
      _id: 'u1',
      userId: 'u1',
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
        { _id: 'u1', level: 'basic', expireAt: NOW - 1 },
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

  it('配额 CAS 冲突后读回已同步结果，避免首次读取直接失败', async () => {
    const staleQuota = {
      _id: 'u1',
      userId: 'u1',
      baseQuotaBytes: MEMBER_STORAGE_QUOTA_BYTES,
      addonQuotaBytes: 0,
      bonusQuotaBytes: 0,
      quotaBytes: MEMBER_STORAGE_QUOTA_BYTES,
      usedBytes: 3 * MB,
      reservedBytes: 2 * MB,
      membershipActive: true,
      version: 1,
    }
    const syncedQuota = {
      ...staleQuota,
      baseQuotaBytes: NORMAL_STORAGE_QUOTA_BYTES,
      quotaBytes: NORMAL_STORAGE_QUOTA_BYTES,
      membershipActive: false,
      membershipLevel: 'basic',
      membershipExpireAt: NOW - 1,
      version: 2,
    }
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [
        { _id: 'u1', level: 'basic', expireAt: NOW - 1 },
      ],
      [USER_STORAGE_QUOTAS_COLLECTION]: [staleQuota],
    })
    const collection = db.collection.bind(db)
    let quotaReads = 0

    db.collection = (name) => {
      const chain = collection(name)
      if (name !== USER_STORAGE_QUOTAS_COLLECTION)
        return chain

      const doc = chain.doc.bind(chain)
      chain.doc = (id) => {
        const docChain = doc(id)
        const get = docChain.get.bind(docChain)
        docChain.get = async () => {
          quotaReads += 1
          if (quotaReads > 5)
            return { data: { ...syncedQuota } }
          return await get()
        }
        return docChain
      }

      const where = chain.where.bind(chain)
      chain.where = (query) => {
        const whereChain = where(query)
        whereChain.update = async () => ({ updated: 0, modifiedCount: 0 })
        return whereChain
      }

      return chain
    }

    const quota = await getStorageQuota(db, { userId: 'u1', now: NOW })

    expect(quota.quotaBytes).toBe(NORMAL_STORAGE_QUOTA_BYTES)
    expect(quota.usedBytes).toBe(3 * MB)
    expect(quota.reservedBytes).toBe(2 * MB)
    expect(quota.membership.isActive).toBe(false)
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
      { userId: 'u1', reservationId: 'res_final1', now: NOW + 1 },
      privateStorageOptions({ sizeBytes: 25 * MB, contentType: 'image/png', etag: '"etag-final1"' }),
    )

    expect(res.quota.usedBytes).toBe(25 * MB)
    expect(res.quota.reservedBytes).toBe(0)
    expect(res.file).toMatchObject({
      status: STORAGE_FILE_STATUS.ACTIVE,
      fileId,
      storageProvider: 'cos',
      storageBucket: 'yunlefun-private-1325586649',
      sizeBytes: 25 * MB,
      reservedSizeBytes: 40 * MB,
    })
  })

  it('finalize 拒绝伪造 storageKey，并忽略客户端提供的 fileId', async () => {
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
          storageKey: 'user-storage/u2/saier/res_guard1/photo.png',
          now: NOW + 1,
        },
        privateStorageOptions({ sizeBytes: 5 * MB, contentType: 'image/png' }),
      ),
    ).rejects.toThrow(/storageKey/)

    const finalized = await finalizeStorageUpload(
      db,
      {
        userId: 'u1',
        reservationId: 'res_guard1',
        fileId: fileIdFor('user-storage/u2/saier/res_guard1/photo.png'),
        now: NOW + 2,
      },
      privateStorageOptions({ sizeBytes: 5 * MB, contentType: 'image/png' }),
    )
    expect(finalized.file.fileId).toBe(fileIdFor(reserved.file.storageKey))
  })

  it('finalize 拒绝超过 reserve 的真实文件并释放 reserved', async () => {
    const db = makeFakeDb()
    await reserveStorageUpload(db, {
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
        { userId: 'u1', reservationId: 'res_final2', now: NOW + 1 },
        privateStorageOptions({ sizeBytes: 25 * MB, contentType: 'image/png' }),
      ),
    ).rejects.toThrow(/实际文件大小/)

    const quota = await getStorageQuota(db, { userId: 'u1', now: NOW + 2 })
    const file = db._store[USER_STORAGE_FILES_COLLECTION][0]
    expect(quota.reservedBytes).toBe(0)
    expect(quota.usedBytes).toBe(0)
    expect(file.status).toBe(STORAGE_FILE_STATUS.EXPIRED)
  })

  it('finalize 在对象尚未可见时回退为 reserved，允许客户端重试', async () => {
    const db = makeFakeDb()
    await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      contentType: 'application/json',
      fileName: 'retry.saier.project.json',
      kind: 'project',
      reservationId: 'res_retry1',
      sizeBytes: 1024,
      now: NOW,
    })
    const unavailable = privateStorageOptions({ sizeBytes: 512, contentType: 'application/json' }, {
      readFileInfo: async () => {
        throw new Error('NoSuchKey')
      },
    })

    await expect(
      finalizeStorageUpload(
        db,
        { userId: 'u1', reservationId: 'res_retry1', now: NOW + 1 },
        unavailable,
      ),
    ).rejects.toThrow(/确认私有存储对象失败/)
    expect(db._store[USER_STORAGE_FILES_COLLECTION][0].status).toBe(STORAGE_FILE_STATUS.RESERVED)

    const finalized = await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'res_retry1', now: NOW + 2 },
      privateStorageOptions({ sizeBytes: 512, contentType: 'application/json' }),
    )
    expect(finalized.file.status).toBe(STORAGE_FILE_STATUS.ACTIVE)
  })

  it('finalize 删除 Content-Type 不匹配的对象并释放预留', async () => {
    const db = makeFakeDb()
    await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      contentType: 'application/json',
      fileName: 'guard.saier.project.json',
      kind: 'project',
      reservationId: 'res_mime1',
      sizeBytes: 1024,
      now: NOW,
    })
    const deletedKeys = []

    await expect(
      finalizeStorageUpload(
        db,
        { userId: 'u1', reservationId: 'res_mime1', now: NOW + 1 },
        privateStorageOptions(
          { sizeBytes: 512, contentType: 'image/png' },
          {
            deleteFile: async (storageKey) => {
              deletedKeys.push(storageKey)
              return {}
            },
          },
        ),
      ),
    ).rejects.toThrow(/Content-Type/)

    expect(deletedKeys).toEqual([
      'user-storage/u1/saier/res_mime1/guard.saier.project.json',
    ])
    expect(db._store[USER_STORAGE_FILES_COLLECTION][0].status).toBe(STORAGE_FILE_STATUS.EXPIRED)
    await expect(getStorageQuota(db, { userId: 'u1', now: NOW + 2 })).resolves.toMatchObject({
      reservedBytes: 0,
      usedBytes: 0,
    })
  })

  it('deleteStorageFile 允许删除并幂等释放 usedBytes', async () => {
    const db = makeFakeDb()
    await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 40 * MB,
      fileName: 'photo.png',
      reservationId: 'res_delete1',
      now: NOW,
    })
    await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'res_delete1', now: NOW + 1 },
      privateStorageOptions({ sizeBytes: 25 * MB, contentType: 'image/png' }),
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
    await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 40 * MB,
      fileName: 'photo.png',
      reservationId: 'res_delete2',
      now: NOW,
    })
    await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'res_delete2', now: NOW + 1 },
      privateStorageOptions({ sizeBytes: 25 * MB, contentType: 'image/png' }),
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

  it('downloadStorageFile 只允许当前用户下载 active 文件并按 maxBytes 限制内联内容', async () => {
    const db = makeFakeDb()
    await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      contentType: 'application/json',
      fileName: 'canvas.saier.project.json',
      kind: 'project',
      reservationId: 'res_down1',
      sizeBytes: 1024,
      now: NOW,
    })
    await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'res_down1', now: NOW + 1 },
      privateStorageOptions({ sizeBytes: 512, contentType: 'application/json' }),
    )

    const downloaded = await downloadStorageFile(
      db,
      { userId: 'u1', reservationId: 'res_down1', maxBytes: 1024, now: NOW + 2 },
      {
        createDownloadUrl: async () => ({
          expiresAt: NOW + 5 * 60 * 1000,
          url: 'https://temp.example/project.json?signature=short-lived',
        }),
        downloadFile: async () => Buffer.from('{"ok":true}', 'utf8'),
      },
    )

    expect(downloaded.file).toMatchObject({
      reservationId: 'res_down1',
      status: STORAGE_FILE_STATUS.ACTIVE,
      userId: 'u1',
    })
    expect(downloaded.downloadUrl).toBe('https://temp.example/project.json?signature=short-lived')
    expect(downloaded.downloadUrlExpiresAt).toBe(NOW + 5 * 60 * 1000)
    expect(downloaded.text).toBe('{"ok":true}')

    await expect(
      downloadStorageFile(
        db,
        { userId: 'u2', reservationId: 'res_down1', maxBytes: 1024, now: NOW + 3 },
        { downloadFile: async () => Buffer.from('{}') },
      ),
    ).rejects.toThrow(/文件不存在/)

    await expect(
      downloadStorageFile(
        db,
        { userId: 'u1', reservationId: 'res_down1', maxBytes: 128, now: NOW + 4 },
        { downloadFile: async () => Buffer.from('{}') },
      ),
    ).rejects.toThrow(/下载上限/)
  })

  it('downloadStorageFile 拒绝未 finalize 的文件', async () => {
    const db = makeFakeDb()
    await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 1024,
      fileName: 'draft.saier.project.json',
      kind: 'project',
      reservationId: 'res_down2',
      now: NOW,
    })

    await expect(
      downloadStorageFile(
        db,
        { userId: 'u1', reservationId: 'res_down2', maxBytes: 1024, now: NOW + 1 },
        { downloadFile: async () => Buffer.from('{}') },
      ),
    ).rejects.toThrow(/不能下载/)
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
    await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'saier',
      sizeBytes: 10 * MB,
      fileName: 'a.saier.project.json',
      reservationId: 'res_list1',
      now: NOW,
    })
    await reserveStorageUpload(db, {
      userId: 'u1',
      appId: 'notebook',
      sizeBytes: 10 * MB,
      fileName: 'note.json',
      reservationId: 'res_list2',
      now: NOW + 1,
    })
    await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'res_list1', now: NOW + 2 },
      privateStorageOptions({ sizeBytes: 5 * MB, contentType: 'application/json' }),
    )
    await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'res_list2', now: NOW + 3 },
      privateStorageOptions({ sizeBytes: 5 * MB, contentType: 'application/json' }),
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
