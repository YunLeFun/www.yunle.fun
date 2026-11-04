import type { CloudAchievementCollection, CloudAchievementEvent } from '~/types/cloud-achievements'

const EFFECTS = ['first', 'cotton', 'rainbow', 'stars', 'dawn', 'sunset', 'aurora']

/**
 * Validate an account API response before showing a successful collection or save.
 * @param value - Untrusted function response.
 * @returns Whether the complete collection contract is valid.
 */
export function isCloudAchievementCollection(value: unknown): value is CloudAchievementCollection {
  if (!value || typeof value !== 'object')
    return false
  const data = value as Record<string, unknown>
  return Array.isArray(data.items)
    && (data.equippedId === null || typeof data.equippedId === 'string')
    && Number.isSafeInteger(data.revision) && Number(data.revision) >= 0
    && data.items.every((item: unknown) => {
      if (!item || typeof item !== 'object')
        return false
      const cloud = item as Record<string, unknown>
      return ['id', 'name', 'description', 'condition'].every(key => typeof cloud[key] === 'string')
        && typeof cloud.effect === 'string' && EFFECTS.includes(cloud.effect)
        && Number.isSafeInteger(cloud.goal) && Number(cloud.goal) > 0
        && Number.isSafeInteger(cloud.progress) && Number(cloud.progress) >= 0 && Number(cloud.progress) <= Number(cloud.goal)
        && (cloud.unlockedAt === null || (typeof cloud.unlockedAt === 'number' && Number.isFinite(cloud.unlockedAt) && cloud.unlockedAt > 0))
    })
    && (data.equippedId === null || data.items.some(item => item.id === data.equippedId && item.unlockedAt !== null))
}

/**
 * Notify the signed-in session without loading the account SDK into decorative clouds.
 * @param event - A single cosmetic interaction; no user IDs or cumulative counts.
 */
export function trackCloudAchievement(event: CloudAchievementEvent): void {
  if (import.meta.client)
    window.dispatchEvent(new CustomEvent('ylf:cloud-achievement', { detail: event }))
}
