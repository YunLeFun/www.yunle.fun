import type { AppRecord } from '~/types/app'
import { isOfficialOwner } from '~/config'

/**
 * 公开应用目录（匿名可读）。
 *
 * 只走应用平台的公开 HTTP 接口，不依赖 CloudBase SDK：公开页面（如 /explore）用它即可，
 * 匿名访客无需为首屏下载认证 SDK。需要登录态的读写请使用 useApps。
 */
export function usePublicApps() {
  const requestFetch = useRequestFetch()

  /**
   * 获取所有官方账号发布的公开应用
   *
   * 开发者平台尚未上线，公开展示处只上架官方应用，普通用户暂不可自助发布。
   */
  async function getOfficialApps(): Promise<AppRecord[]> {
    const response = await requestFetch<{ items: AppRecord[] }>('/api/apps-platform/public')
    return response.items.filter(app => app.isOfficial === true || isOfficialOwner(app.ownerLogin))
  }

  return {
    getOfficialApps,
  }
}
