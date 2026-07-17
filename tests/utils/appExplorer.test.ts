import type { AppRecord } from '../../app/types/app'
import { describe, expect, it } from 'vitest'
import {
  filterExplorerApps,
  getExplorerCategories,
  normalizeExplorerApps,
} from '../../app/utils/app-explorer'

function makeApp(slug: string, overrides: Partial<AppRecord> = {}): AppRecord {
  return {
    _id: slug,
    _openid: 'owner',
    ownerId: 'owner',
    ownerLogin: 'YunYouJun',
    name: slug,
    slug,
    isPublic: true,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

describe('app explorer data', () => {
  it('merges configured metadata and falls back safely', () => {
    const result = normalizeExplorerApps([
      makeApp('ai-sfc', { themeColor: '#ff4444' }),
      makeApp('unknown'),
    ])

    expect(result[0]).toMatchObject({
      accent: '#ff4444',
      category: 'inspiration',
      categoryLabel: '灵感智能',
      featured: true,
    })
    expect(result[1]).toMatchObject({
      category: 'other',
      categoryLabel: '其他云朵',
      featured: false,
      tags: [],
    })
    expect(result[1]?.accent).toMatch(/^var\(--ylf-dopa-/)
  })

  it('combines category and case-insensitive text search', () => {
    const apps = normalizeExplorerApps([
      makeApp('ai-sfc', { name: 'AI 春联', description: '生成春联' }),
      makeApp('fc', { name: 'FC 红白机' }),
    ])

    expect(filterExplorerApps(apps, 'ai', 'inspiration').map(item => item.slug)).toEqual(['ai-sfc'])
    expect(filterExplorerApps(apps, '春联', 'all').map(item => item.slug)).toEqual(['ai-sfc'])
    expect(filterExplorerApps(apps, '', 'play').map(item => item.slug)).toEqual(['fc'])
  })

  it('returns only categories present in the current result set', () => {
    const apps = normalizeExplorerApps([
      makeApp('ai-sfc'),
      makeApp('fc'),
      makeApp('unknown'),
    ])

    expect(getExplorerCategories(apps).map(item => item.id)).toEqual([
      'inspiration',
      'play',
      'other',
    ])
  })
})
