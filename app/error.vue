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
    <header class="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <a href="/" aria-label="云乐坊首页" class="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring">
        云乐坊
      </a>
    </header>

    <!-- 彩色光晕背景 -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 h-[520px] overflow-hidden"
      aria-hidden="true"
    >
      <div class="absolute -left-24 top-10 size-80 rounded-full bg-blue-400/25 blur-3xl dark:bg-blue-500/15" />
      <div class="absolute -right-20 top-4 size-80 rounded-full bg-violet-400/25 blur-3xl dark:bg-violet-500/15" />
      <div class="absolute left-1/3 top-24 size-72 rounded-full bg-pink-400/20 blur-3xl dark:bg-pink-500/10" />
    </div>

    <main class="relative mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center sm:py-28">
      <p class="font-heading text-8xl font-bold text-primary sm:text-9xl">
        {{ error.statusCode }}
      </p>
      <h1 class="mt-5 text-2xl font-semibold text-foreground">
        {{ error.statusMessage || '页面未找到' }}
      </h1>
      <p class="mt-3 max-w-md text-muted-foreground">
        {{ error.message || '抱歉，您访问的页面不存在。' }}
      </p>
      <div class="mt-8 flex flex-wrap justify-center gap-3">
        <a href="/" class="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring">
          返回首页
        </a>
        <a href="/docs/getting-started" class="inline-flex min-h-11 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          帮助中心
        </a>
      </div>
    </main>

    <AppToastHost />
  </div>
</template>
