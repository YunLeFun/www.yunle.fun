/** Visual variants supported by the account achievement catalog. */
export type CloudEffect = 'first' | 'cotton' | 'rainbow' | 'stars' | 'dawn' | 'sunset' | 'aurora'

/** Public cosmetic metadata and capped achievement progress. */
export interface CloudAchievement {
  id: string
  name: string
  description: string
  effect: CloudEffect
  condition: string
  goal: number
  progress: number
  unlockedAt: number | null
}

/** Account collection; public profiles include only unlocked items. */
export interface CloudAchievementCollection {
  items: CloudAchievement[]
  equippedId: string | null
  revision?: number
}

/** Cosmetic interaction, observed while signed in rather than imported from local totals. */
export type CloudAchievementEvent = { kind: 'poke' } | { kind: 'explore', appId: string }
