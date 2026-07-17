import type { AppRecord } from '~/types/app'
import type {
  ExplorerApp,
  ExplorerCategory,
  ExplorerCategoryFilter,
} from '~/types/app-explorer'
import {
  appExplorerMeta,
  explorerAccentPalette,
  explorerCategories,
} from '~/config/app-explorer'

const categoryMap = new Map(explorerCategories.map(category => [category.id, category]))

function hashString(value: string) {
  let hash = 0

  for (const character of value) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  }

  return Math.abs(hash)
}

function getFallbackAccent(slug: string) {
  return explorerAccentPalette[hashString(slug) % explorerAccentPalette.length]!
}

export function normalizeExplorerApps(apps: AppRecord[]): ExplorerApp[] {
  return apps.map((app) => {
    const meta = appExplorerMeta[app.slug]
    const category = meta?.category ?? 'other'

    return {
      ...app,
      category,
      categoryLabel: categoryMap.get(category)?.label ?? '其他云朵',
      tags: [...(meta?.tags ?? [])],
      featured: Boolean(meta?.featured),
      accent: app.themeColor || meta?.accent || getFallbackAccent(app.slug),
    }
  })
}

export function filterExplorerApps(
  apps: ExplorerApp[],
  query: string,
  category: ExplorerCategoryFilter,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')

  return apps.filter((app) => {
    if (category !== 'all' && app.category !== category)
      return false

    if (!normalizedQuery)
      return true

    return [
      app.name,
      app.slug,
      app.description,
      app.categoryLabel,
      ...app.tags,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('zh-CN')
      .includes(normalizedQuery)
  })
}

export function getExplorerCategories(apps: ExplorerApp[]): ExplorerCategory[] {
  const presentCategoryIds = new Set(apps.map(app => app.category))
  return explorerCategories.filter(category => presentCategoryIds.has(category.id))
}
