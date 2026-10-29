<script setup lang="ts">
const colorMode = useColorMode()
const route = useRoute()
const config = useRuntimeConfig()

const color = computed(() => colorMode.value === 'dark' ? '#020618' : 'white')
const siteUrl = config.public.siteUrl.replace(/\/$/, '')
const canonicalUrl = computed(() => `${siteUrl}${route.path}`)
const socialImageUrl = `${siteUrl}/yunlefun-logo-1024.png`

useHead({
  meta: [
    { charset: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'theme-color', name: 'theme-color', content: color },
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' },
    { key: 'canonical', rel: 'canonical', href: canonicalUrl },
  ],
  htmlAttrs: {
    lang: 'zh-CN',
  },
})

useSeoMeta({
  titleTemplate: '%s - 云乐坊',
  ogSiteName: '云乐坊',
  ogUrl: canonicalUrl,
  ogImage: socialImageUrl,
  ogImageType: 'image/png',
  ogImageWidth: 1024,
  ogImageHeight: 1024,
  ogImageAlt: '云乐坊 YunLeFun Logo',
  twitterImage: socialImageUrl,
  twitterImageAlt: '云乐坊 YunLeFun Logo',
  twitterCard: 'summary',
})

// 方案 B：登录态就绪后自动领取每日签到云币（替代手动签到），到账时以 toast 呈现。
// 服务端 signIn 幂等（按东八区自然日只入账一次），autoClaim 再按 uid 去重，重复触发安全。
const toast = useAppToast()
const user = useState<{ id?: string } | null>('auth_user', () => null)
const hasUser = computed(() => Boolean(user.value?.id))
const isAuthLayout = computed(() => route.meta.layout === 'auth')
const showAccountExtras = computed(() => hasUser.value && !isAuthLayout.value)
// 戳云满 10 / 50 / 100 下时的小徽章，到点才懒加载
const { milestone: cloudMilestone } = useCloudCollection()

async function claimDailyReward(userId: string) {
  const { useSignIn } = await import('~/composables/useSignIn')
  if (user.value?.id !== userId || isAuthLayout.value)
    return
  const { autoClaim } = useSignIn()
  const res = await autoClaim()
  if (user.value?.id !== userId || isAuthLayout.value || !res || res.alreadySigned)
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

// 授权期间专注登录；离开认证布局后再处理签到与新用户引导。
onMounted(() => {
  watch([() => user.value?.id, isAuthLayout], ([id, authLayout]) => {
    if (id && !authLayout)
      void claimDailyReward(id)
  }, { immediate: true })
})
</script>

<template>
  <NuxtLoadingIndicator />

  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>

  <AppToaster />

  <!--
    登录态会在客户端路由中间件中于 hydration 前恢复，而首页预渲染时 auth_user 恒为空。
    将登录后才需要的引导弹窗移出服务端渲染树，确保两端首帧结构一致。
  -->
  <ClientOnly>
    <LazyOnboardingModal v-if="showAccountExtras" />
  </ClientOnly>

  <!-- 戳云满 10 / 50 / 100 下时的「云朵收藏家」小徽章 -->
  <ClientOnly>
    <LazyCloudCollectorBadge
      v-if="cloudMilestone"
      :key="cloudMilestone"
      :count="cloudMilestone"
      @done="cloudMilestone = null"
    />
  </ClientOnly>
</template>
