import type { AppRecord, CreateAppForm } from '~/types/app'
import { OFFICIAL_OWNER_LOGINS } from '~/config'

const COLLECTION = 'apps'

/**
 * 应用数据管理 composable
 * 基于 CloudBase NoSQL 数据库
 */
export function useApps() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()
  // SSR 安全：useCloudbase 在服务端返回空 app，此处惰性可空（各方法仅在客户端调用，app 必存在）
  const db = app?.database()

  /**
   * 获取当前用户的所有应用
   */
  async function getMyApps(): Promise<AppRecord[]> {
    if (!user.value)
      return []
    const { data } = await db
      .collection(COLLECTION)
      .where({ ownerId: user.value.id })
      .orderBy('updatedAt', 'desc')
      .limit(100)
      .get()
    return data as AppRecord[]
  }

  /**
   * 获取所有官方账号发布的公开应用
   *
   * 开发者平台尚未上线，公开展示处只上架官方应用，普通用户暂不可自助发布。
   */
  async function getOfficialApps(): Promise<AppRecord[]> {
    const { data } = await db
      .collection(COLLECTION)
      .where({
        ownerLogin: db.command.in(OFFICIAL_OWNER_LOGINS),
        isPublic: true,
      })
      .orderBy('updatedAt', 'desc')
      .limit(100)
      .get()
    return data as AppRecord[]
  }

  /**
   * 根据用户名获取该用户的所有公开应用
   */
  async function getUserApps(ownerLogin: string): Promise<AppRecord[]> {
    const { data } = await db
      .collection(COLLECTION)
      .where({ ownerLogin, isPublic: true })
      .orderBy('updatedAt', 'desc')
      .limit(100)
      .get()
    return data as AppRecord[]
  }

  /**
   * 根据 slug 获取公开应用详情（公开详情页 / 榜单用）
   *
   * 安全规则读分支为 `doc.isPublic == true || auth.uid == doc.ownerId`，
   * 查询条件必须带上能命中某一分支的字段：公开读须显式 `isPublic: true`，
   * 否则按 slug 单字段查询无法满足规则 → DATABASE_PERMISSION_DENIED。
   * owner 读自己的（含私有）应用走 getMyAppBySlug。
   */
  async function getAppBySlug(slug: string): Promise<AppRecord | null> {
    const { data } = await db
      .collection(COLLECTION)
      .where({ slug, isPublic: true })
      .limit(1)
      .get()
    return (data as AppRecord[])[0] || null
  }

  /**
   * 获取当前用户自己的应用（按 slug，含私有），用于编辑等 owner 场景。
   * 带 ownerId 命中归属读分支，可读到自己未公开的应用。
   */
  async function getMyAppBySlug(slug: string): Promise<AppRecord | null> {
    if (!user.value)
      return null
    const { data } = await db
      .collection(COLLECTION)
      .where({ slug, ownerId: user.value.id })
      .limit(1)
      .get()
    return (data as AppRecord[])[0] || null
  }

  /**
   * 根据文档 ID 获取应用详情（主键查询，立即一致，无索引延迟）
   */
  async function getAppById(id: string): Promise<AppRecord | null> {
    const { data } = await db
      .collection(COLLECTION)
      .doc(id)
      .get()
    if (Array.isArray(data)) {
      return (data as AppRecord[])[0] || null
    }
    return (data as AppRecord) || null
  }

  /**
   * 创建应用，返回新文档 ID
   */
  async function createApp(form: CreateAppForm): Promise<string> {
    if (!user.value)
      throw new Error('请先登录')

    const now = Date.now()
    const res = await db.collection(COLLECTION).add({
      ownerId: user.value.id,
      ownerLogin: user.value.login || user.value.id,
      name: form.name,
      slug: form.slug,
      description: form.description || '',
      githubRepo: form.githubRepo || '',
      websiteUrl: form.websiteUrl || '',
      backupUrl: form.backupUrl || '',
      icon: form.icon || '',
      isPublic: form.isPublic,
      createdAt: now,
      updatedAt: now,
    }) as unknown as { id: string }
    return res.id
  }

  /**
   * 更新应用
   */
  async function updateApp(id: string, updates: Partial<CreateAppForm>): Promise<void> {
    await db.collection(COLLECTION).doc(id).update({
      ...updates,
      updatedAt: Date.now(),
    })
  }

  /**
   * 删除应用
   */
  async function deleteApp(id: string): Promise<void> {
    await db.collection(COLLECTION).doc(id).remove()
  }

  /**
   * 检查 slug 是否已被当前用户占用。
   *
   * 受行级安全规则限制，客户端只能在归属分支内按 slug 查询（须带 ownerId）；
   * 跨用户的全局唯一性应由 `apps` 集合上的 slug 唯一索引在服务端兜底（待补）。
   */
  async function isSlugTaken(slug: string): Promise<boolean> {
    if (!user.value)
      return false
    const { data } = await db
      .collection(COLLECTION)
      .where({ slug, ownerId: user.value.id })
      .limit(1)
      .get()
    return (data as AppRecord[]).length > 0
  }

  return {
    getMyApps,
    getOfficialApps,
    getUserApps,
    getAppById,
    getAppBySlug,
    getMyAppBySlug,
    createApp,
    updateApp,
    deleteApp,
    isSlugTaken,
  }
}
