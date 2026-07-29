import type { AppRecord, CreateAppForm, MyWorkshopOverview } from '~/types/app'
import { isOfficialOwner } from '~/config'

const COLLECTION = 'apps'

/**
 * 应用数据管理 composable
 * 展示读取统一走 apps.yunle.fun 服务端接口；旧版编辑能力仍暂用 CloudBase。
 */
export function useApps() {
  const { app, auth } = useCloudbase()
  const { user } = useTcbAuth()
  const requestFetch = useRequestFetch()
  // SSR 安全：useCloudbase 在服务端返回空 app，此处惰性可空（各方法仅在客户端调用，app 必存在）
  const db = app?.database()

  /**
   * 获取当前用户的所有应用
   */
  async function getMyApps(): Promise<AppRecord[]> {
    if (!user.value)
      return []
    const headers = await authorizationHeaders()
    const response = await requestFetch<{ items: AppRecord[] }>('/api/apps-platform/mine', { headers })
    return response.items
  }

  /**
   * 获取所有官方账号发布的公开应用
   *
   * 开发者平台尚未上线，公开展示处只上架官方应用，普通用户暂不可自助发布。
   */
  async function getOfficialApps(): Promise<AppRecord[]> {
    const response = await requestFetch<{ items: AppRecord[] }>('/api/apps-platform/public')
    return response.items.filter(app => app.isOfficial === true || isOfficialOwner(app.ownerLogin))
  }

  /**
   * 根据用户名获取该用户的所有公开应用
   */
  async function getUserApps(ownerLogin: string): Promise<AppRecord[]> {
    try {
      const response = await requestFetch<{ items: AppRecord[] }>('/api/apps-platform/personal', {
        query: { login: ownerLogin },
      })
      return response.items
    }
    catch (error) {
      // apps.yunle.fun 无法仅凭 login 解析“尚未发布过应用”的用户，主页按空列表展示。
      if (errorStatus(error) === 404)
        return []
      throw error
    }
  }

  /**
   * 根据 slug 获取公开应用详情（公开详情页 / 榜单用）
   */
  async function getAppBySlug(slug: string): Promise<AppRecord | null> {
    try {
      const response = await requestFetch<{ app: AppRecord }>(
        `/api/apps-platform/public/${encodeURIComponent(slug)}`,
      )
      return response.app
    }
    catch (error) {
      if (errorStatus(error) === 404)
        return null
      throw error
    }
  }

  /**
   * 获取当前用户自己的应用（按 slug，含私有），用于 owner 场景。
   */
  async function getMyAppBySlug(slug: string): Promise<AppRecord | null> {
    if (!user.value)
      return null
    return (await getMyApps()).find(app => app.slug === slug) || null
  }

  /**
   * 根据文档 ID 获取应用详情（主键查询，立即一致，无索引延迟）
   */
  async function getAppById(id: string): Promise<AppRecord | null> {
    if (user.value) {
      const mine = (await getMyApps()).find(app => app._id === id)
      if (mine)
        return mine
    }
    return getAppBySlug(id)
  }

  /**
   * 获取本人拥有和已加入的私人工坊，以及当前账号在其中有权查看的应用。
   */
  async function getMyWorkshops(): Promise<MyWorkshopOverview> {
    if (!user.value)
      return { owned: null, joined: [] }
    const headers = await authorizationHeaders()
    return requestFetch<MyWorkshopOverview>('/api/apps-platform/workshops', { headers })
  }

  async function authorizationHeaders(): Promise<Record<string, string>> {
    const { data } = await auth.getSession()
    const accessToken = data?.session?.access_token
    if (!accessToken)
      throw new Error('请先登录')
    return { Authorization: `Bearer ${accessToken}` }
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
    getMyWorkshops,
    createApp,
    updateApp,
    deleteApp,
    isSlugTaken,
  }
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object')
    return
  const record = error as Record<string, unknown>
  if (typeof record.statusCode === 'number')
    return record.statusCode
  if (typeof record.status === 'number')
    return record.status
  const response = record.response
  if (response && typeof response === 'object') {
    const status = (response as Record<string, unknown>).status
    return typeof status === 'number' ? status : undefined
  }
}
