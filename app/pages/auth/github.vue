<script setup lang="ts">
import YlfProgress from '@yunlefun/vue/components/YlfProgress.vue'

/**
 * 旧版 GitHub OAuth 回调页面（兼容保留）
 *
 * OAuth 回调已统一为 /auth/callback（见 useOAuth 中的 redirectTo），
 * 此页面仅做转交，避免旧的回调配置落到重复的处理逻辑上。
 */
definePageMeta({
  layout: 'auth',
})

const route = useRoute()

onMounted(() => {
  navigateTo({ path: '/auth/callback', query: route.query }, { replace: true })
})
</script>

<template>
  <div class="space-y-4">
    <h1 class="ylf-title">
      正在登录
    </h1>
    <YlfProgress :value="null" aria-label="正在转到登录回调" />
    <p class="text-sm leading-6 text-muted" role="status" aria-live="polite">
      正在转到登录回调…
    </p>
  </div>
</template>
