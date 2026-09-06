/** 应用数据模型 - 对应 CloudBase NoSQL 集合 `apps` */
export interface AppRecord {
  /** 市场上架时取得的全局唯一短名；所属空间 slug 独立。 */
  marketShortName?: string
  /** 文档 ID（CloudBase 自动生成） */
  _id: string
  /** 创建者 ID（旧记录为 CloudBase openid） */
  _openid?: string
  /** 应用所有者 User ID（旧版字段） */
  ownerId?: string
  /** 应用所有者稳定 UID（新版目录字段） */
  ownerUid?: string
  /** 应用所有者用户名 */
  ownerLogin: string
  /** 应用名称 */
  name: string
  /** 唯一标识符（URL slug，类似 GitHub repo name） */
  slug: string
  /** 应用描述 */
  description?: string
  /** 绑定的 GitHub 仓库（可选，格式：owner/repo） */
  githubRepo?: string
  /** 应用网页链接 */
  websiteUrl?: string
  /** 隐私政策链接 */
  privacyPolicyUrl?: string
  /** 支持入口 */
  supportUrl?: string
  /** 应用信任的站点域名 */
  trustedHosts?: string[]
  /** 备用链接 */
  backupUrl?: string
  /** 应用图标 URL */
  icon?: string
  /** 应用 Logo（图片资源路径，部分应用使用） */
  logo?: string
  /** 应用 Emoji 图标（无图片图标时回退展示） */
  emoji?: string
  /** 应用主题色 */
  themeColor?: string
  /** 应用分类 */
  category?: string
  /** 应用标签 */
  tags?: string[]
  /** 开发者展示名 */
  developerName?: string
  /** 是否为官方应用 */
  isOfficial?: boolean
  /** 是否公开 */
  isPublic: boolean
  /** 新版目录可见受众 */
  audience?: 'public' | 'workshop' | 'owner'
  /** 新版目录发布状态 */
  publicationStatus?: 'unpublished' | 'published' | 'suspended' | 'delisted'
  /** 旧版审核状态（新版只读投影仍会返回 approved） */
  status?: 'pending' | 'approved' | 'rejected'
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

/** 创建应用时的表单数据 */
export interface CreateAppForm {
  name: string
  slug: string
  description?: string
  githubRepo?: string
  websiteUrl?: string
  backupUrl?: string
  icon?: string
  isPublic: boolean
}

export type WorkshopAccess = 'anonymous' | 'none' | 'pending' | 'active' | 'owner' | 'blocked'

export interface WorkshopPublicInfo {
  _id: string
  ownerName: string
  ownerAvatar?: string
  name: string
  description?: string
  joinPolicy: 'approval' | 'open' | 'closed'
  status: 'active' | 'disabled'
}

export interface WorkshopSurface {
  access: Extract<WorkshopAccess, 'active' | 'owner'>
  workshop: WorkshopPublicInfo
  apps: AppRecord[]
  guestCount?: number
  pendingCount?: number
}

export interface MyWorkshopOverview {
  owned: WorkshopSurface | null
  joined: WorkshopSurface[]
}
