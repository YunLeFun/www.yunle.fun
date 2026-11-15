<script setup lang="ts">
import MyCloudAchievements from '~/components/achievements/MyCloudAchievements.vue'

definePageMeta({
  layout: 'default',
})

useSeoMeta({
  title: '我的天空 - YunLeFun',
  description: '收集不同气象和性格的云朵，选择一朵在个人主页佩戴',
})

const { user, isAuthenticated, loading, authReady } = useTcbAuth()
const { equipped: equippedCloud } = useCloudAchievementDisplay()
const router = useRouter()

watch([isAuthenticated, () => authReady?.value ?? true], ([authed, ready]) => {
  if (import.meta.client && ready && !authed) {
    router.push('/login?redirect=/clouds')
  }
}, { immediate: true })
</script>

<template>
  <AppContainer class="py-8 sm:py-10">
    <div v-if="loading" class="mx-auto max-w-3xl space-y-5" aria-busy="true" aria-label="正在加载我的天空">
      <div class="ylf-shimmer h-24 rounded-[var(--ylf-radius-xl)]" />
      <div class="ylf-shimmer h-96 rounded-[var(--ylf-radius-lg)]" />
    </div>

    <div v-else-if="user" class="mx-auto max-w-3xl space-y-5">
      <SubpageHero
        title="我的天空"
        description="收集不同气象和性格的云朵，挑一朵在个人主页陪着你"
        :cloud-effect="equippedCloud?.effect"
      />

      <MyCloudAchievements />
    </div>
  </AppContainer>
</template>
