import type { AppRecord } from '../../app/types/app'
import { describe, expect, it } from 'vitest'
import { buildCloudRoutes, layoutCloudApps } from '../../app/utils/app-cloud-layout'
import { normalizeExplorerApps } from '../../app/utils/app-explorer'

function makeApp(slug: string): AppRecord {
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
  }
}

const apps = normalizeExplorerApps([
  makeApp('ai-sfc'),
  makeApp('pixi-painter'),
  makeApp('fc'),
  makeApp('birthday'),
  makeApp('valaxy'),
])

describe('application cloud layout', () => {
  it('returns stable bounded positions independent of input order', () => {
    const first = layoutCloudApps(apps)
    const second = layoutCloudApps([...apps].reverse())

    expect(second).toEqual(first)
    expect(first.every(item => item.x >= 8 && item.x <= 92 && item.y >= 12 && item.y <= 88)).toBe(true)
    expect(first.find(item => item.app.slug === 'ai-sfc')?.size).toBe('featured')
  })

  it('creates one core route per visible category and short intra-group routes', () => {
    const islands = layoutCloudApps(apps)
    const routes = buildCloudRoutes(islands)
    const visibleCategories = new Set(islands.map(item => item.app.category))

    expect(routes.filter(route => route.kind === 'core')).toHaveLength(visibleCategories.size)
    expect(routes.some(route => route.kind === 'group')).toBe(true)
    expect(routes.every(route => route.from !== route.to)).toBe(true)
  })
})
