<script setup lang="ts">
const route = useRoute()
const shouldMount = useState('deferred_user_menu_ready', () => false)

function revealUserMenu() {
  if (shouldMount.value)
    return

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
  <Suspense v-if="shouldMount">
    <LazyUserMenu />

    <template #fallback>
      <AuthActionButtons />
    </template>
  </Suspense>

  <AuthActionButtons
    v-else
    @reveal="revealUserMenu"
  />
</template>
