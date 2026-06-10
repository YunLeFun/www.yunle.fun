<script setup lang="ts">
const route = useRoute()
const shouldMount = useState('deferred_user_menu_ready', () => false)

function revealUserMenu() {
  shouldMount.value = true
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
  <LazyUserMenu v-if="shouldMount" />

  <div
    v-else
    class="flex items-center gap-2"
    @pointerenter.once="revealUserMenu"
    @focusin.once="revealUserMenu"
  >
    <UButton
      to="/login"
      label="登录"
      color="neutral"
      variant="outline"
      class="hidden lg:inline-flex"
    />
    <UButton
      to="/login"
      icon="i-ri-login-box-line"
      color="neutral"
      variant="ghost"
      class="lg:hidden"
    />
    <UButton
      label="注册"
      color="neutral"
      trailing-icon="i-lucide-arrow-right"
      class="hidden lg:inline-flex"
      to="/signup"
    />
  </div>
</template>
