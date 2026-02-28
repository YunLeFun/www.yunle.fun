/**
 * 导航数据共享 composable
 * 消除 app.vue 和 error.vue 中的重复数据获取
 */
export function useNavigation() {
  const { data: navigation } = useAsyncData('navigation', () => queryCollectionNavigation('docs'), {
    transform: data => data.find(item => item.path === '/docs')?.children || [],
  })

  const { data: files } = useLazyAsyncData('search', () => queryCollectionSearchSections('docs'), {
    server: false,
  })

  const links = [
    { label: 'Docs', icon: 'i-lucide-book', to: '/docs/getting-started' },
    { label: 'Pricing', icon: 'i-lucide-credit-card', to: '/pricing' },
    { label: 'Blog', icon: 'i-lucide-pencil', to: '/blog' },
    { label: 'Changelog', icon: 'i-lucide-history', to: '/changelog' },
  ]

  return { navigation, files, links }
}
