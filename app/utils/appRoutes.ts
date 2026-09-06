import type { AppRecord } from '~/types/app'

/** 官网详情归属到现有用户主页下；没有所有者的历史引用保留旧链接解析。 */
export function getAppDetailPath(app: Pick<AppRecord, 'slug'> & Partial<Pick<AppRecord, 'ownerLogin' | 'marketShortName'>>) {
  if (app.marketShortName)
    return `/apps/${encodeURIComponent(app.marketShortName)}`
  const slug = encodeURIComponent(app.slug)
  return app.ownerLogin
    ? `/u/${encodeURIComponent(app.ownerLogin.toLowerCase())}/apps/${slug}`
    : `/apps/${slug}`
}

export function matchesAppOwner(app: Pick<AppRecord, 'ownerLogin'>, ownerLogin: string) {
  return app.ownerLogin.toLowerCase() === ownerLogin.toLowerCase()
}
