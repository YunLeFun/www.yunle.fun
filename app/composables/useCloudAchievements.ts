import type { User } from './auth/types'
import type { CloudAchievementCollection, CloudAchievementEvent } from '~/types/cloud-achievements'
import { isTestAccountFeatureRestriction } from '~/utils/account-feature-restriction'
import { isCloudAchievementCollection } from '~/utils/cloud-achievements'

const requestLanes = new WeakMap<object, { tail: Promise<unknown> }>()

/**
 * Share an account-owned collection and serialize updates across all feature consumers.
 * @returns Reactive collection, request state, and explicit refresh/equip/record actions.
 */
export function useCloudAchievements() {
  const nuxtApp = useNuxtApp()
  const { app } = useCloudbase()
  const toast = useAppToast()
  const user = useState<User | null>('auth_user', () => null)
  const ownerId = useState<string | null>('cloud-achievements-owner', () => null)
  const epoch = useState('cloud-achievements-epoch', () => 0)
  const collection = useState<CloudAchievementCollection | null>('cloud-achievements', () => null)
  const error = useState<string | null>('cloud-achievements-error', () => null)
  const loading = useState('cloud-achievements-loading', () => false)
  const saving = useState('cloud-achievements-saving', () => false)
  const restricted = useState('cloud-achievements-restricted', () => false)

  watch(() => user.value?.id ?? null, (uid) => {
    if (ownerId.value === uid)
      return
    ownerId.value = uid
    epoch.value++
    collection.value = null
    error.value = null
    restricted.value = false
    loading.value = false
    saving.value = false
  }, { immediate: true, flush: 'sync' })

  if (!requestLanes.has(nuxtApp))
    requestLanes.set(nuxtApp, { tail: Promise.resolve() })
  const lane = requestLanes.get(nuxtApp)!

  async function request(action: string, payload: Record<string, unknown> = {}): Promise<boolean> {
    const uid = user.value?.id
    const requestEpoch = epoch.value
    if (!uid || !app || restricted.value)
      return false
    const current = () => user.value?.id === uid && epoch.value === requestEpoch
    const result = lane.tail.then(async () => {
      if (!current())
        return false
      const isSave = action === 'equipCloudAchievement'
      loading.value = !collection.value
      saving.value = isSave
      try {
        const response = await app.callFunction({
          name: 'account-api',
          data: { action, ...payload, restrictionResponse: 'v1' },
        })
        if (!current())
          return false
        if (isTestAccountFeatureRestriction(response.result)) {
          restricted.value = true
          collection.value = null
          error.value = '测试账号暂不支持云朵成就'
          return false
        }
        if (!isCloudAchievementCollection(response.result))
          throw new Error('云朵成就服务返回了无效数据')
        const next = response.result
        if ((next.revision ?? 0) < (collection.value?.revision ?? 0))
          return false
        const previous = collection.value
        collection.value = next
        error.value = null
        if (previous) {
          const unlocked = next.items.filter(item => item.unlockedAt !== null && !previous.items.some(old => old.id === item.id && old.unlockedAt !== null))
          for (const cloud of unlocked)
            toast.add({ title: `收集到「${cloud.name}」`, description: '已放入我的天空，可以去个人中心佩戴', icon: 'i-lucide-cloud', color: 'success' })
        }
        return true
      }
      catch (cause) {
        if (current()) {
          console.warn('[cloud-achievements] request failed:', cause)
          error.value = isSave ? '佩戴尚未保存，请检查网络后重试' : '云朵同步失败，请稍后重试'
        }
        return false
      }
      finally {
        if (current()) {
          loading.value = false
          saving.value = false
        }
      }
    })
    lane.tail = result
    return result
  }

  /** Reload persisted progress and reconcile server-owned sign-in milestones. */
  function refresh(): Promise<boolean> {
    return request('getMyCloudAchievements')
  }

  /** Save an unlocked cloud, or null to remove the equipped cloud. */
  function equip(achievementId: string | null): Promise<boolean> {
    return request('equipCloudAchievement', { achievementId })
  }

  /** Record one observed interaction, using a stable ID for any explicit replay. */
  function record(event: CloudAchievementEvent): Promise<boolean> {
    return request('recordCloudAchievementEvent', { ...event, eventId: crypto.randomUUID() })
  }

  return { collection: computed(() => collection.value), error: computed(() => error.value), loading: computed(() => loading.value), saving: computed(() => saving.value), restricted: computed(() => restricted.value), refresh, equip, record }
}
