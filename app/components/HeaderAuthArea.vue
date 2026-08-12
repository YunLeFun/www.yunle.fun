<script setup lang="ts">
withDefaults(defineProps<{
  guestPresentation?: 'responsive' | 'labeled'
}>(), {
  guestPresentation: 'responsive',
})

const user = useState<{ id?: string } | null>('auth_user', () => null)
const authReady = useState<boolean>('auth_ready', () => false)
const shouldMount = useState('header_auth_area_ready', () => false)
const isPreparing = useState('header_auth_area_preparing', () => false)
const isMounted = shallowRef(false)
const config = useRuntimeConfig()
const cookieSessionEnabled = config.public.cookieSession === true
const serverSession = cookieSessionEnabled ? useUserSession() : null

const restorationState = computed(() => resolveAuthRestorationState({
  cookieSessionEnabled,
  hasCurrentUser: Boolean(user.value?.id),
  hasPersistedCredentials: hasPersistedCredentials(),
  serverSessionLoggedIn: Boolean(serverSession?.loggedIn.value),
  serverSessionReady: !cookieSessionEnabled || Boolean(serverSession?.ready.value),
}))
const serverSessionPending = computed(() => restorationState.value === 'pending')

function hasPersistedCredentials() {
  return hasPersistedCloudbaseCredentials(config.public.cloudbaseEnvId)
}

function hasRestorableSession() {
  return restorationState.value === 'restorable'
}

function revealAuthenticatedArea() {
  shouldMount.value = true
}

async function prepareAuthArea() {
  if (!isMounted.value || shouldMount.value || isPreparing.value || serverSessionPending.value)
    return

  // 先用持久化凭据是否存在这一轻量信号分流。匿名首页不解析 CloudBase SDK，
  // cookie 会话或 localStorage 会话存在时仍立即走完整的认证恢复。
  if (!hasRestorableSession()) {
    authReady.value = true
    return
  }

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
    await preloadComponents(['UserMenu', 'NotificationBell'])
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

if (serverSession) {
  watch(
    [serverSession.ready, serverSession.loggedIn],
    () => void prepareAuthArea(),
  )
}

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
    <LazyNotificationBell />

    <Suspense>
      <LazyUserMenu />

      <template #fallback>
        <UserMenuSkeleton />
      </template>
    </Suspense>
  </template>

  <HeaderAuthSkeleton v-else-if="!isMounted || isPreparing || serverSessionPending" />

  <AuthActionButtons v-else :presentation="guestPresentation" />
</template>
