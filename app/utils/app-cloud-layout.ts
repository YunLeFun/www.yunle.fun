import type { ExplorerApp, ExplorerCategoryId } from '~/types/app-explorer'
import { explorerCategories } from '~/config/app-explorer'

export interface CloudIsland {
  app: ExplorerApp
  x: number
  y: number
  size: 'featured' | 'default'
}

export interface CloudRoute {
  id: string
  from: string
  to: string
  kind: 'core' | 'group'
  start: { x: number, y: number }
  end: { x: number, y: number }
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const CLOUD_CORE = { x: 50, y: 48 }
const categoryOrder = new Map(explorerCategories.map((category, index) => [category.id, index]))
const categoryAnchors = new Map(explorerCategories.map(category => [category.id, category.anchor]))

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function fnv1a(value: string) {
  let hash = 0x811C9DC5

  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

function sortApps(apps: ExplorerApp[]) {
  return [...apps].sort((a, b) => {
    const categoryDelta
      = (categoryOrder.get(a.category) ?? Number.MAX_SAFE_INTEGER)
        - (categoryOrder.get(b.category) ?? Number.MAX_SAFE_INTEGER)

    return categoryDelta || a.slug.localeCompare(b.slug)
  })
}

function relaxCollisions(islands: CloudIsland[]) {
  const minimumDistance = 8

  for (let pass = 0; pass < 4; pass++) {
    for (let leftIndex = 0; leftIndex < islands.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < islands.length; rightIndex++) {
        const left = islands[leftIndex]!
        const right = islands[rightIndex]!
        let deltaX = right.x - left.x
        let deltaY = right.y - left.y
        let distance = Math.hypot(deltaX, deltaY)

        if (distance >= minimumDistance)
          continue

        if (distance < 0.001) {
          const angle = (fnv1a(`${left.app.slug}:${right.app.slug}`) / 0xFFFFFFFF) * Math.PI * 2
          deltaX = Math.cos(angle)
          deltaY = Math.sin(angle)
          distance = 1
        }

        const shift = (minimumDistance - distance) / 2
        const unitX = deltaX / distance
        const unitY = deltaY / distance

        left.x = clamp(left.x - unitX * shift, 8, 92)
        left.y = clamp(left.y - unitY * shift, 12, 88)
        right.x = clamp(right.x + unitX * shift, 8, 92)
        right.y = clamp(right.y + unitY * shift, 12, 88)
      }
    }
  }
}

export function layoutCloudApps(apps: ExplorerApp[]): CloudIsland[] {
  const categoryIndexes = new Map<ExplorerCategoryId, number>()
  const islands = sortApps(apps).map((app) => {
    const index = categoryIndexes.get(app.category) ?? 0
    categoryIndexes.set(app.category, index + 1)

    const anchor = categoryAnchors.get(app.category) ?? CLOUD_CORE
    const seedAngle = (fnv1a(app.category) / 0xFFFFFFFF) * Math.PI * 2
    const angle = seedAngle + index * GOLDEN_ANGLE
    const radius = 2.5 + Math.sqrt(index) * 8

    return {
      app,
      x: clamp(anchor.x + Math.cos(angle) * radius, 8, 92),
      y: clamp(anchor.y + Math.sin(angle) * radius * 0.72, 12, 88),
      size: app.featured ? 'featured' as const : 'default' as const,
    }
  })

  relaxCollisions(islands)

  return islands.map(island => ({
    ...island,
    x: Number(island.x.toFixed(3)),
    y: Number(island.y.toFixed(3)),
  }))
}

function getCategoryCenter(islands: CloudIsland[]) {
  return {
    x: islands.reduce((sum, island) => sum + island.x, 0) / islands.length,
    y: islands.reduce((sum, island) => sum + island.y, 0) / islands.length,
  }
}

export function buildCloudRoutes(islands: CloudIsland[]): CloudRoute[] {
  const grouped = new Map<ExplorerCategoryId, CloudIsland[]>()

  for (const island of islands) {
    const group = grouped.get(island.app.category) ?? []
    group.push(island)
    grouped.set(island.app.category, group)
  }

  const routes: CloudRoute[] = []

  for (const category of explorerCategories) {
    const group = grouped.get(category.id)
    if (!group?.length)
      continue

    const center = getCategoryCenter(group)
    routes.push({
      id: `core-${category.id}`,
      from: 'cloud-core',
      to: `${category.id}-cluster`,
      kind: 'core',
      start: CLOUD_CORE,
      end: center,
    })

    for (let index = 1; index < group.length; index++) {
      const previous = group[index - 1]!
      const current = group[index]!
      routes.push({
        id: `group-${previous.app.slug}-${current.app.slug}`,
        from: previous.app.slug,
        to: current.app.slug,
        kind: 'group',
        start: { x: previous.x, y: previous.y },
        end: { x: current.x, y: current.y },
      })
    }
  }

  return routes
}
