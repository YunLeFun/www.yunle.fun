import type { MaybeRefOrGetter } from 'vue'
import { toPublicAvatarUrl } from '~/utils/avatar'

/** Resolve public avatars synchronously without creating temporary signatures. */
export function useAvatarUrl(source: MaybeRefOrGetter<string | null | undefined>) {
  const config = useRuntimeConfig()
  const envId = String(config.public.cloudbaseEnvId || '')
  const publicStorageOrigin = String(config.public.cloudbaseStoragePublicOrigin || '')
  return computed(() =>
    toPublicAvatarUrl(toValue(source), envId, publicStorageOrigin) || undefined,
  )
}
