<script setup lang="ts">
const user = useState<{ id?: string } | null>('auth_user', () => null)
const shouldMount = useState('deferred_user_menu_ready', () => false)
const isPreparing = useState('deferred_user_menu_preparing', () => false)
const isMounted = shallowRef(false)

function revealUserMenu() {
  if (shouldMount.value)
    return

  shouldMount.value = true
}

async function prepareUserMenu() {
  if (shouldMount.value || isPreparing.value)
    return

  isPreparing.value = true
  try {
    const { useTcbAuthSession } = await import('~/composables/auth/useAuthSession')
    const { authReady, checkAuthStatus, isAuthenticated } = useTcbAuthSession()

    // 公开路由不经全局中间件，页头挂载后主动恢复持久化会话。
    // 校验期间由模板显示骨架，只有确认为访客后才显示登录 / 注册。
    if (!authReady.value)
      await checkAuthStatus()

    if (isAuthenticated.value) {
      await preloadComponents('UserMenu')
      revealUserMenu()
    }
  }
  finally {
    isPreparing.value = false
  }
}

onMounted(() => {
  isMounted.value = true
  void prepareUserMenu()
})

watch(
  () => user.value?.id,
  (id) => {
    // 登录页与页头共用 auth_user；在 SPA 导航中登录成功后立即切换用户菜单。
    if (id)
      void prepareUserMenu()
  },
)
</script>

<template>
  <Suspense v-if="shouldMount">
    <LazyUserMenu />

    <template #fallback>
      <UserMenuSkeleton />
    </template>
  </Suspense>

  <UserMenuSkeleton v-else-if="!isMounted || isPreparing" />

  <AuthActionButtons v-else />
</template>
