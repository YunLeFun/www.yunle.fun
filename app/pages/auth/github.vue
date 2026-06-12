<script setup lang="ts">
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
  <div class="text-center space-y-6">
    <div class="flex justify-center">
      <UIcon
        name="i-lucide-loader-circle"
        class="w-16 h-16 text-primary animate-spin"
      />
    </div>

    <div class="space-y-2">
      <h1 class="text-2xl font-bold">
        处理中
      </h1>
      <p class="text-muted">
        正在跳转到登录回调...
      </p>
    </div>
  </div>
</template>
