import type { ContentKind } from '~~/shared/public-content'
import { validatePublished } from '~~/shared/public-content'

export function usePublicContent(kind: ContentKind) {
  return useAsyncData(`public-content:${kind}`, async () => {
    return validatePublished(await $fetch(`/api/public-content/${kind}`), kind)
  }, { server: false })
}
