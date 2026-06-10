import type { ContentNavigationItem } from '@nuxt/content'

/**
 * 导航数据共享 composable。
 * 文档导航只在文档页或搜索面板真正打开时加载，避免所有页面首屏拉取 Nuxt Content 索引。
 */
export function useNavigation() {
  const route = useRoute()
  const shouldLoadInitially = route.path.startsWith('/docs')

  const {
    data: navigation,
    execute,
    status: navigationStatus,
  } = useAsyncData<ContentNavigationItem[]>(
    'navigation',
    async () => {
      const data = await queryCollectionNavigation('docs')
      return data.find(item => item.path === '/docs')?.children || []
    },
    {
      default: () => [],
      immediate: shouldLoadInitially,
      server: shouldLoadInitially,
    },
  )

  async function ensureNavigation() {
    if (navigationStatus.value === 'idle' || navigationStatus.value === 'error')
      await execute()
  }

  if (import.meta.client) {
    watch(
      () => route.path,
      (path) => {
        if (path.startsWith('/docs'))
          void ensureNavigation()
      },
    )
  }

  const links = [
    { label: '文档', icon: 'i-lucide-book', to: '/docs/getting-started' },
    { label: '会员', icon: 'i-lucide-credit-card', to: '/pricing' },
    { label: '博客', icon: 'i-lucide-pencil', to: '/blog' },
    { label: '日志', icon: 'i-lucide-history', to: '/changelog' },
  ]

  return { navigation, links, ensureNavigation, navigationStatus }
}
