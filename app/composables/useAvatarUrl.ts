import type { MaybeRefOrGetter } from 'vue'
import { normalizeAvatarSource, toCloudbaseAvatarFileID } from '~/utils/avatar'

const pendingAvatarUrls = new Map<string, Promise<string | null>>()
const AVATAR_URL_CACHE_TTL_MS = 60 * 60 * 1000

interface CachedAvatarUrl {
  url: string
  expiresAt: number
}

function pickTempFileURL(result: unknown, fileID: string): string | null {
  if (!result || typeof result !== 'object')
    return null
  const fileList = (result as { fileList?: unknown }).fileList
  if (!Array.isArray(fileList))
    return null
  const item = fileList.find(file => file && typeof file === 'object' && (file as { fileID?: unknown }).fileID === fileID)
    || fileList[0]
  const url = item && typeof item === 'object' ? (item as { tempFileURL?: unknown }).tempFileURL : null
  return typeof url === 'string' && url ? url : null
}

export function rememberAvatarUrl(fileID: string, url: string) {
  if (!fileID.startsWith('cloud://') || !url)
    return
  const cache = useState<Record<string, CachedAvatarUrl>>('avatar_url_cache', () => ({}))
  cache.value = {
    ...cache.value,
    [fileID]: { url, expiresAt: Date.now() + AVATAR_URL_CACHE_TTL_MS },
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
        pending = app.getTempFileURL({ fileList: [fileID] })
          .then(result => pickTempFileURL(result, fileID))
          .catch(() => null)
          .finally(() => pendingAvatarUrls.delete(fileID))
        pendingAvatarUrls.set(fileID, pending)
      }

      const freshUrl = await pending
      if (currentRevision !== revision)
        return
      if (freshUrl) {
        rememberAvatarUrl(fileID, freshUrl)
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
