import type { MaybeRefOrGetter } from 'vue'
import { normalizeAvatarSource, toCloudbaseAvatarFileID } from '~/utils/avatar'

const pendingAvatarUrls = new Map<string, Promise<string | null>>()
// Classic CloudBase temporary URLs accept at most 86,400 seconds.
const AVATAR_SIGNED_URL_TTL_SECONDS = 24 * 60 * 60
const AVATAR_SIGNED_URL_CACHE_TTL_MS = (AVATAR_SIGNED_URL_TTL_SECONDS - 5 * 60) * 1000
const AVATAR_UPLOAD_URL_CACHE_TTL_MS = 60 * 60 * 1000

interface CachedAvatarUrl {
  url: string
  expiresAt: number
}

function pickSignedUrl(result: unknown): string | null {
  if (!result || typeof result !== 'object')
    return null
  const data = (result as { data?: unknown }).data
  if (!data || typeof data !== 'object')
    return null
  const url = (data as { signedUrl?: unknown }).signedUrl
  return typeof url === 'string' && url ? url : null
}

export function rememberAvatarUrl(
  fileID: string,
  url: string,
  ttlMs = AVATAR_UPLOAD_URL_CACHE_TTL_MS,
) {
  if (!fileID.startsWith('cloud://') || !url)
    return
  const cache = useState<Record<string, CachedAvatarUrl>>('avatar_url_cache', () => ({}))
  cache.value = {
    ...cache.value,
    [fileID]: { url, expiresAt: Date.now() + ttlMs },
  }
}

/** Resolve durable CloudBase file IDs to browser-displayable URLs per session. */
export function useAvatarUrl(source: MaybeRefOrGetter<string | null | undefined>) {
  const config = useRuntimeConfig()
  const envId = String(config.public.cloudbaseEnvId || '')
  const cache = useState<Record<string, CachedAvatarUrl>>('avatar_url_cache', () => ({}))
  const resolvedUrl = shallowRef<string>()
  let revision = 0

  watch(
    () => toValue(source),
    async (value) => {
      const currentRevision = ++revision
      const normalized = normalizeAvatarSource(value, envId)
      if (!normalized) {
        resolvedUrl.value = undefined
        return
      }

      const fileID = toCloudbaseAvatarFileID(normalized, envId)
      if (!fileID) {
        resolvedUrl.value = normalized
        return
      }

      const cached = cache.value[fileID]
      if (cached && cached.expiresAt > Date.now()) {
        resolvedUrl.value = cached.url
        return
      }
      if (cached) {
        const nextCache = { ...cache.value }
        delete nextCache[fileID]
        cache.value = nextCache
      }
      if (import.meta.server) {
        resolvedUrl.value = undefined
        return
      }

      let pending = pendingAvatarUrls.get(fileID)
      if (!pending) {
        const { app } = useCloudbase()
        pending = (async () => {
          try {
            const result = await app.storage.from().createSignedUrl(fileID, AVATAR_SIGNED_URL_TTL_SECONDS)
            return pickSignedUrl(result)
          }
          catch {
            return null
          }
          finally {
            pendingAvatarUrls.delete(fileID)
          }
        })()
        pendingAvatarUrls.set(fileID, pending)
      }

      const freshUrl = await pending
      if (currentRevision !== revision)
        return
      if (freshUrl) {
        rememberAvatarUrl(fileID, freshUrl, AVATAR_SIGNED_URL_CACHE_TTL_MS)
        resolvedUrl.value = freshUrl
      }
      else {
        // A legacy HTTP URL may still be valid even when refreshing it fails.
        resolvedUrl.value = normalized === fileID ? undefined : normalized
      }
    },
    { immediate: true },
  )

  return readonly(resolvedUrl)
}
