/**
 * GitHub API 相关类型定义
 */

/** GitHub 仓库信息 */
export interface GitHubRepository {
  /** 仓库 ID */
  id: number
  /** 仓库名称 */
  name: string
  /** 完整名称（owner/repo） */
  full_name: string
  /** 仓库描述 */
  description: string | null
  /** 是否私有仓库 */
  private: boolean
  /** 仓库所有者信息 */
  owner: {
    /** 用户名或组织名 */
    login: string
    /** 所有者类型 */
    type: 'User' | 'Organization'
    /** 头像 URL */
    avatar_url: string
  }
  /** 仓库 URL */
  html_url: string
  /** 最后更新时间 */
  updated_at: string
  /** 创建时间 */
  created_at: string
  /** 默认分支 */
  default_branch: string
  /** 编程语言 */
  language: string | null
  /** 是否为 fork */
  fork: boolean
  /** 星标数 */
  stargazers_count: number
  /** 观察者数 */
  watchers_count: number
  /** fork 数 */
  forks_count: number
}

/** GitHub 组织信息 */
export interface GitHubOrganization {
  /** 组织 ID */
  id: number
  /** 组织名称 */
  login: string
  /** 组织描述 */
  description: string | null
  /** 头像 URL */
  avatar_url: string
  /** 组织 URL */
  html_url: string
  /** 组织类型 */
  type: 'Organization'
}

/** GitHub 用户信息 */
export interface GitHubUser {
  /** 用户 ID */
  id: number
  /** 用户名 */
  login: string
  /** 显示名称 */
  name: string | null
  /** 头像 URL */
  avatar_url: string
  /** 用户 URL */
  html_url: string
  /** 用户类型 */
  type: 'User'
  /** 邮箱 */
  email: string | null
}

/** 仓库选择器选项 */
export interface RepoSelectorOption {
  /** 选项值（full_name） */
  value: string
  /** 显示标签 */
  label: string
  /** 描述信息 */
  description?: string
  /** 图标 */
  icon?: string
  /** 是否私有 */
  private?: boolean
  /** 编程语言 */
  language?: string | null
  /** 最后更新时间 */
  updatedAt?: string
}

/** 仓库拥有者类型 */
export type RepoOwnerType = 'user' | 'organization'

/** 仓库拥有者信息 */
export interface RepoOwner {
  /** 拥有者类型 */
  type: RepoOwnerType
  /** 拥有者登录名 */
  login: string
  /** 显示名称 */
  name?: string
  /** 头像 URL */
  avatarUrl: string
}

/** GitHub API 错误响应 */
export interface GitHubApiError {
  /** 错误消息 */
  message: string
  /** 错误文档 URL */
  documentation_url?: string
  /** 错误详情 */
  errors?: Array<{
    resource: string
    field: string
    code: string
  }>
}

/** 仓库搜索参数 */
export interface RepoSearchParams {
  /** 搜索关键词 */
  query?: string
  /** 仓库类型 */
  type?: 'all' | 'owner' | 'member'
  /** 排序方式 */
  sort?: 'created' | 'updated' | 'pushed' | 'full_name'
  /** 排序方向 */
  direction?: 'asc' | 'desc'
  /** 每页数量 */
  per_page?: number
  /** 页码 */
  page?: number
}

/** API 响应状态 */
export interface ApiResponse<T> {
  /** 响应数据 */
  data: T
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
}