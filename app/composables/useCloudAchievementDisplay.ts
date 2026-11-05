import type { User } from './auth/types'
import type { CloudAchievementCollection } from '~/types/cloud-achievements'
import { getEquippedCloud } from '~/utils/cloud-achievements'

/**
 * Read the active account's cosmetic without initializing the account SDK or fetching.
 * @returns Account-scoped collection and equipment, cleared immediately on identity changes.
 */
export function useCloudAchievementDisplay() {
  const user = useState<User | null>('auth_user', () => null)
  const owner = useState<string | null>('cloud-achievements-owner', () => null)
  const stored = useState<CloudAchievementCollection | null>('cloud-achievements', () => null)
  const collection = computed(() => user.value?.id && owner.value === user.value.id ? stored.value : null)
  const equipped = computed(() => getEquippedCloud(collection.value))
  return { collection, equipped }
}
