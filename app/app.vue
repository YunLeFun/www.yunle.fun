<script setup lang="ts">
import { zh_cn } from '@nuxt/ui/locale'

const colorMode = useColorMode()

const color = computed(() => colorMode.value === 'dark' ? '#020618' : 'white')

useHead({
  meta: [
    { charset: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'theme-color', name: 'theme-color', content: color },
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' },
  ],
  htmlAttrs: {
    lang: 'zh-CN',
  },
})

useSeoMeta({
  titleTemplate: '%s - 云乐坊',
  ogImage: 'https://ui.nuxt.com/assets/templates/nuxt/saas-light.png',
  twitterImage: 'https://ui.nuxt.com/assets/templates/nuxt/saas-light.png',
  twitterCard: 'summary_large_image',
})

// 方案 B：登录态就绪后自动领取每日签到云币（替代手动签到），到账时以 toast 呈现。
// 服务端 signIn 幂等（按东八区自然日只入账一次），autoClaim 再按 uid 去重，重复触发安全。
const toast = useToast()
const user = useState<{ id?: string } | null>('auth_user', () => null)
const hasUser = computed(() => Boolean(user.value?.id))

async function claimDailyReward(userId: string) {
  const { useSignIn } = await import('~/composables/useSignIn')
  if (user.value?.id !== userId)
    return
  const { autoClaim } = useSignIn()
  const res = await autoClaim()
  if (!res || res.alreadySigned)
    return
  toast.add({
    title: `每日 +${res.reward} 云币已到账`,
    description: `已连续签到 ${res.currentStreak} 天`,
    icon: 'i-lucide-coins',
    color: 'success',
  })
  // 满一个周期：额外庆祝里程碑大奖
  if (res.milestone) {
    toast.add({
      title: `🎉 连续 ${res.milestone.streak} 天达成！`,
      description: `里程碑奖励 +${res.milestone.bonus} 云币`,
      icon: 'i-lucide-gift',
      color: 'success',
    })
  }
}

// 已登录直接领；登录态在中间件恢复后由 watch 接住（首次访问 / 刚登录）
onMounted(() => {
  const id = user.value?.id
  if (id)
    void claimDailyReward(id)
})
watch(() => user.value?.id, (id) => {
  if (id)
    void claimDailyReward(id)
})
</script>

<template>
  <UApp :locale="zh_cn">
    <NuxtLoadingIndicator />

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <!-- 新手机号用户首次登录引导（设置昵称 / 头像），由 needsOnboarding 状态驱动 -->
    <LazyOnboardingModal v-if="hasUser" />
  </UApp>
</template>
