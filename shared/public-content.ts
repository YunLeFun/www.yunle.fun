/** Public-content wire contract v1. Mirrored in www/shared/public-content.ts. */
export type ContentKind = 'downloads' | 'announcements'
export interface DownloadItem {
  platform: 'ios' | 'android' | 'web'
  version: string
  url: string
  requirements: string
  enabled: boolean
}
export interface Downloads {
  appId: 'yunlefun'
  items: DownloadItem[]
}
export interface Announcement {
  id: string
  title: string
  body: string
  url: string
  linkLabel: string
  placement: 'home' | 'site'
  startsAt: string
  endsAt: string
  enabled: boolean
}
export interface Announcements { items: Announcement[] }
export type Content = Downloads | Announcements
export interface PublishedContent {
  schemaVersion: 1
  kind: ContentKind
  releaseId: string
  publishedAt: string
  content: Content
}
export const defaultDownloads: Downloads = {
  appId: 'yunlefun',
  items: [
    { platform: 'ios', version: '', url: '', requirements: 'iOS 14.0 或更高版本', enabled: false },
    { platform: 'android', version: '', url: '', requirements: 'Android 8.0 或更高版本', enabled: false },
    { platform: 'web', version: '', url: 'https://apps.yunle.fun/', requirements: '现代浏览器', enabled: true },
  ],
}
export function parseKind(value: unknown): ContentKind {
  if (value !== 'downloads' && value !== 'announcements')
    throw new Error('未知公共内容类型')
  return value
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('内容格式不正确')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new Error(`文本不能为空或超过 ${max} 个字符`)
  return value.trim()
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new Error('启用状态必须是布尔值')
  return value
}
function link(value: unknown): string {
  const result = text(value, 2048)
  if (!result)
    return ''
  const url = new URL(result)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('链接必须使用 HTTPS，且不得包含账号密码')
  return url.href
}
function date(value: unknown): string {
  const result = text(value, 40)
  if (!result)
    return ''
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result)))
    throw new Error('时间必须包含时区')
  return new Date(result).toISOString()
}
export function validateContent(kind: ContentKind, value: unknown): Content {
  const input = record(value)
  if (!Array.isArray(input.items) || input.items.length > (kind === 'downloads' ? 3 : 20))
    throw new Error('内容条目数量不正确')
  const seen = new Set<string>()
  if (kind === 'downloads') {
    if (input.appId !== 'yunlefun' || input.items.length !== 3)
      throw new Error('下载清单必须包含云乐坊的 iOS、Android 和 Web 三个平台')
    return {
      appId: 'yunlefun',
      items: input.items.map((value): DownloadItem => {
        const item = record(value)
        const platform = item.platform
        if (!['ios', 'android', 'web'].includes(String(platform)) || seen.has(String(platform)))
          throw new Error('下载平台无效或重复')
        seen.add(String(platform))
        const enabled = flag(item.enabled)
        const url = link(item.url)
        const version = text(item.version, 64)
        if (enabled && (!url || (platform !== 'web' && !version)))
          throw new Error('开放下载的平台必须填写链接和版本')
        return { platform: platform as DownloadItem['platform'], enabled, url, version, requirements: text(item.requirements, 200) }
      }),
    }
  }
  return {
    items: input.items.map((value): Announcement => {
      const item = record(value)
      const id = text(item.id, 64, true)
      if (!/^[a-z0-9-]+$/i.test(id) || seen.has(id))
        throw new Error('公告 ID 无效或重复')
      seen.add(id)
      if (item.placement !== 'home' && item.placement !== 'site')
        throw new Error('公告位置无效')
      const startsAt = date(item.startsAt)
      const endsAt = date(item.endsAt)
      if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt))
        throw new Error('公告结束时间必须晚于开始时间')
      const url = link(item.url)
      const linkLabel = text(item.linkLabel, 40, Boolean(url))
      return { id, title: text(item.title, 100, true), body: text(item.body, 1000), url, linkLabel, placement: item.placement, startsAt, endsAt, enabled: flag(item.enabled) }
    }),
  }
}
export function validatePublished(value: unknown, kind: ContentKind): PublishedContent {
  const input = record(value)
  if (input.schemaVersion !== 1 || input.kind !== kind)
    throw new Error('不支持的公共内容版本')
  const releaseId = text(input.releaseId, 80, true)
  if (!/^[a-z0-9-]+$/i.test(releaseId))
    throw new Error('发布版本无效')
  const publishedAt = date(input.publishedAt)
  if (!publishedAt)
    throw new Error('缺少发布时间')
  return { schemaVersion: 1, kind, releaseId, publishedAt, content: validateContent(kind, input.content) }
}
export function visibleAnnouncements(content: Announcements, path: string, now: number) {
  return content.items.filter(item => item.enabled
    && (item.placement === 'site' || path === '/')
    && (!item.startsAt || Date.parse(item.startsAt) <= now)
    && (!item.endsAt || Date.parse(item.endsAt) > now))
}
/** Unrelated edits/publications must not re-open a dismissed, unchanged notice. */
export function announcementRevision(item: Announcement): string {
  return JSON.stringify(item)
}
