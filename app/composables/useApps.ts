import type { AppRecord, MyWorkshopOverview } from '~/types/app'
import { isOfficialOwner } from '~/config'
import { matchesAppOwner } from '~/utils/appRoutes'

/**
 * 应用数据管理 composable
 * 读取和下架统一走应用平台服务端；创建编辑由应用平台承载。
 */
export function useApps() {
  const { auth } = useCloudbase()
  const { user } = useTcbAuth()
  const requestFetch = useRequestFetch()
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
  async function getAppBySlug(slug: string, ownerLogin?: string): Promise<AppRecord | null> {
    // 所有者可读取自己的私有应用；其他访客只能读该空间的公开投影。
    if (ownerLogin) {
      if (user.value && [user.value.login, user.value.id].some(login => login?.toLowerCase() === ownerLogin.toLowerCase())) {
        const mine = await getMyAppBySlug(slug)
        if (mine && matchesAppOwner(mine, ownerLogin))
          return mine
      }
      const apps = await getUserApps(ownerLogin)
      return apps.find(app => app.isPublic && app.slug === slug && matchesAppOwner(app, ownerLogin)) || null
    }
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

  /** 下架而不删除身份，市场短名仍归原应用所有。 */
  async function deleteApp(id: string): Promise<void> {
    const headers = await authorizationHeaders()
    await requestFetch(`/api/apps-platform/${encodeURIComponent(id)}`, { method: 'DELETE', headers })
  }

  return {
    getMyApps,
    getOfficialApps,
    getUserApps,
    getAppById,
    getAppBySlug,
    getMyAppBySlug,
    getMyWorkshops,
    deleteApp,
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
