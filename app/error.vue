<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps({
  error: {
    type: Object as PropType<NuxtError>,
    required: true,
  },
})

useHead({
  htmlAttrs: {
    lang: 'zh-CN',
  },
})

useSeoMeta({
  title: '页面未找到',
  description: '抱歉，您访问的页面不存在。',
})
</script>

<template>
  <div class="relative">
    <AppHeader />

    <!-- 彩色光晕背景 -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 h-[520px] overflow-hidden"
      aria-hidden="true"
    >
      <div class="absolute -left-24 top-10 size-80 rounded-full bg-blue-400/25 blur-3xl dark:bg-blue-500/15" />
      <div class="absolute -right-20 top-4 size-80 rounded-full bg-violet-400/25 blur-3xl dark:bg-violet-500/15" />
      <div class="absolute left-1/3 top-24 size-72 rounded-full bg-pink-400/20 blur-3xl dark:bg-pink-500/10" />
    </div>

    <UMain class="relative">
      <UContainer>
        <UPage>
          <UError :error="error" />
        </UPage>
      </UContainer>
    </UMain>

    <AppFooter />

    <UToaster />
  </div>
</template>
