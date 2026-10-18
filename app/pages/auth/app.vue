<script setup lang="ts">
import { isCrossAppAuthorizationUrl } from '~/utils/cross-app-authorization'
import SsoAuthorization from './sso.vue'

// 云乐坊 App 未安装或通用链接不可用时，原生 App 的系统网页授权落到这里。
// 校验通过后沿用 `/auth/sso` 的同一套页面与协议逻辑。
definePageMeta({
  layout: 'auth',
})

useSeoMeta({
  title: '账号同步 - 云乐坊',
  robots: 'noindex,nofollow',
})

useHead({
  meta: [{ name: 'referrer', content: 'no-referrer' }],
})

const route = useRoute()
const valid = import.meta.client && isCrossAppAuthorizationUrl(`${window.location.origin}${route.fullPath}`)
</script>

<template>
  <SsoAuthorization v-if="valid" />
  <div v-else class="mx-auto max-w-sm py-16 text-center" role="alert">
    <p class="text-lg font-medium">
      该授权请求无效
    </p>
    <p class="mt-2 text-sm op-70">
      请回到发起登录的 App 重新尝试。
    </p>
  </div>
</template>
