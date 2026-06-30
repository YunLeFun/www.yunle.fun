<script setup lang="ts">
const route = useRoute()
const shouldMount = useState('deferred_user_menu_ready', () => false)
const isPreparing = useState('deferred_user_menu_preparing', () => false)

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

    // hover/focus 只预热登录态。访客保持按钮 DOM 稳定，避免
    // 「登录 / 注册」→ UserMenuSkeleton →「登录 / 注册」的闪烁。
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
  if (!isPublicAuthRoute(route.path))
    revealUserMenu()
})

watch(
  () => route.path,
  (path) => {
    if (!isPublicAuthRoute(path))
      revealUserMenu()
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

  <AuthActionButtons
    v-else
    @prepare="prepareUserMenu"
  />
</template>
