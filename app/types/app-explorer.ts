import type { AppRecord } from './app'

export type ExplorerCategoryId
  = | 'inspiration'
    | 'creative'
    | 'developer'
    | 'play'
    | 'life'
    | 'community'
    | 'other'

export type ExplorerCategoryFilter = 'all' | ExplorerCategoryId

export interface ExplorerCategory {
  id: ExplorerCategoryId
  label: string
  description: string
  icon: string
}

export interface ExplorerApp extends AppRecord {
  category: ExplorerCategoryId
  categoryLabel: string
  tags: string[]
  featured: boolean
  accent: string
}

export interface AppExplorerMeta {
  category: ExplorerCategoryId
  tags?: string[]
  featured?: boolean
  accent?: string
}

export interface SsoExplorerApp {
  clientId: string
  appId: string
  name: string
  origin: string
  description: string
  logoUrl: string
  fallbackMark: string
  accent: string
  detailSlug?: string
  position: {
    x: number
    y: number
  }
}

export interface SsoAccountState {
  status: 'pending' | 'guest' | 'authenticated'
  displayName: string
  avatar?: string | null
  to: string
}
