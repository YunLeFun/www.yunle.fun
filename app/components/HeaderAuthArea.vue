<script setup lang="ts">
withDefaults(defineProps<{
  guestPresentation?: 'responsive' | 'labeled'
}>(), {
  guestPresentation: 'responsive',
})

const user = useState<{ id?: string } | null>('auth_user', () => null)
const shouldMount = useState('header_auth_area_ready', () => false)
const isPreparing = useState('header_auth_area_preparing', () => false)
const isMounted = shallowRef(false)

function revealAuthenticatedArea() {
  shouldMount.value = true
}

async function prepareAuthArea() {
  if (shouldMount.value || isPreparing.value)
    return

  isPreparing.value = true
  try {
    const { useTcbAuthSession } = await import('~/composables/auth/useAuthSession')
    const { authReady, checkAuthStatus, isAuthenticated } = useTcbAuthSession()

    // 公开路由不经全局中间件，页头需要主动恢复持久化会话。
    // pending 期间始终保留完整认证区域骨架，只有确认访客后才展示登录 / 注册。
    if (!authReady.value)
      await checkAuthStatus()

    if (!isAuthenticated.value)
      return

    // 认证恢复与用户菜单代码加载都完成后再原子切换，避免通知图标先出现造成抖动。
    await preloadComponents('UserMenu')
    revealAuthenticatedArea()
  }
  finally {
    isPreparing.value = false
  }
}

onMounted(() => {
  isMounted.value = true
  void prepareAuthArea()
})

watch(
  () => user.value?.id,
  (id) => {
    // 登录页与页头共用 auth_user；SPA 登录成功后立即切换完整认证区域。
    if (id)
      void prepareAuthArea()
  },
)
</script>

<template>
  <template v-if="shouldMount">
    <NotificationBell />

    <Suspense>
      <LazyUserMenu />

      <template #fallback>
        <UserMenuSkeleton />
      </template>
    </Suspense>
  </template>

  <HeaderAuthSkeleton v-else-if="!isMounted || isPreparing" />

  <AuthActionButtons v-else :presentation="guestPresentation" />
</template>
