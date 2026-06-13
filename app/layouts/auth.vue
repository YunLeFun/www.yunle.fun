<template>
  <div class="ylf-auth-shell relative min-h-screen min-h-dvh overflow-x-hidden">
    <!-- 彩色光晕背景 -->
    <div
      class="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      <div class="absolute -left-24 top-4 size-80 rounded-full bg-blue-400/30 blur-3xl dark:bg-blue-500/20" />
      <div class="absolute -right-20 top-20 size-80 rounded-full bg-violet-400/30 blur-3xl dark:bg-violet-500/20" />
      <div class="absolute -bottom-10 left-1/3 size-72 rounded-full bg-pink-400/25 blur-3xl dark:bg-pink-500/15" />
    </div>

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

    <div class="relative z-10 grid min-h-screen min-h-dvh place-items-center px-4 pb-[calc(env(safe-area-inset-bottom)_+_1.5rem)] pt-[calc(env(safe-area-inset-top)_+_5rem)] sm:px-6 sm:py-10">
      <UPageCard
        variant="soft"
        class="ylf-surface mx-auto w-full max-w-sm shadow-lg shadow-primary/5 hover:translate-y-0 hover:ring-0 sm:shadow-xl"
        :ui="{ root: 'transition-none hover:shadow-xl hover:shadow-primary/5' }"
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
