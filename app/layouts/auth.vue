<script setup lang="ts">
// 跟随站点明暗模式：浅色=晴朗白日，深色=新海诚式黄昏
const colorMode = useColorMode()
const skyTheme = computed(() => (colorMode.value === 'dark' ? 'dark' : 'light'))
</script>

<template>
  <div class="ylf-auth-shell relative min-h-screen min-h-dvh overflow-x-hidden">
    <!-- 梦幻晴空背景（天气之子） -->
    <SkyScene :theme="skyTheme" class="pointer-events-none" />
    <!-- 顶部留白处压一层柔和提亮，保证返回按钮在亮空下清晰 -->
    <div class="pointer-events-none absolute inset-x-0 top-0 z-[1] h-32 bg-gradient-to-b from-white/35 to-transparent dark:from-black/20" aria-hidden="true" />

    <div class="absolute left-4 top-[calc(env(safe-area-inset-top)_+_0.75rem)] z-20 sm:left-8 sm:top-8">
      <UButton
        icon="i-lucide-arrow-left"
        to="/"
        size="lg"
        color="neutral"
        variant="subtle"
        class="ylf-auth-back rounded-full"
        aria-label="返回首页"
        title="返回首页"
      >
        <span class="sm:hidden">返回</span>
        <span class="hidden sm:inline">返回首页</span>
      </UButton>
    </div>

    <!-- 移动端：晴空铺满顶部，表单做成贴底全宽「上滑卡」；桌面端：居中玻璃卡 -->
    <!-- 桌面端顶部锚定（而非垂直居中）：切换 Tab 内容变高时只向下生长，卡片顶边/Logo/标题/Tab 栏不动；矮屏也不会被裁顶 -->
    <div class="relative z-10 flex min-h-screen min-h-dvh flex-col justify-end pt-[calc(env(safe-area-inset-top)_+_5rem)] sm:items-center sm:justify-start sm:px-6 sm:pb-10 sm:pt-[12vh]">
      <UPageCard
        variant="soft"
        class="ylf-auth-card relative w-full overflow-hidden rounded-t-3xl rounded-b-none pb-[env(safe-area-inset-bottom)] sm:mx-auto sm:max-w-sm sm:rounded-b-3xl sm:pb-0"
      >
        <slot />
      </UPageCard>
    </div>
  </div>
</template>

<style scoped>
.ylf-auth-shell {
  isolation: isolate;
}

/* 磨砂玻璃卡片 —— 让晴空背景隐约透出；圆角由模板按端响应式控制（移动端只圆上方） */
.ylf-auth-card {
  background: color-mix(in srgb, var(--ylf-surface) 90%, transparent);
  border: 1px solid color-mix(in srgb, #fff 55%, transparent);
  box-shadow:
    0 1px 0 0 color-mix(in srgb, #fff 70%, transparent) inset,
    0 30px 64px -28px color-mix(in srgb, #0b82c4 55%, transparent);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
}

.dark .ylf-auth-card {
  background: color-mix(in srgb, var(--ylf-surface) 80%, transparent);
  border-color: color-mix(in srgb, #fff 16%, transparent);
  box-shadow:
    0 1px 0 0 color-mix(in srgb, #fff 10%, transparent) inset,
    0 30px 64px -28px color-mix(in srgb, #000 72%, transparent);
}

.ylf-auth-back {
  min-height: 2.75rem;
  border: 1px solid color-mix(in srgb, var(--ui-border) 74%, transparent);
  background: color-mix(in srgb, var(--ylf-surface) 76%, transparent);
  box-shadow: 0 10px 24px -18px var(--ui-text);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.ylf-auth-back:hover {
  background: color-mix(in srgb, var(--ylf-surface) 92%, transparent);
  border-color: color-mix(in srgb, var(--ui-primary) 28%, var(--ui-border));
  box-shadow: 0 14px 28px -20px var(--ui-primary);
  transform: translateY(-1px);
}

.ylf-auth-back:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 3px var(--ylf-ring),
    0 10px 24px -18px var(--ui-text);
}
</style>
