<template>
  <div class="relative min-h-screen min-h-dvh overflow-x-hidden">
    <!-- 彩色光晕背景 -->
    <div
      class="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      <div class="absolute -left-24 top-4 size-80 rounded-full bg-blue-400/30 blur-3xl dark:bg-blue-500/20" />
      <div class="absolute -right-20 top-20 size-80 rounded-full bg-violet-400/30 blur-3xl dark:bg-violet-500/20" />
      <div class="absolute -bottom-10 left-1/3 size-72 rounded-full bg-pink-400/25 blur-3xl dark:bg-pink-500/15" />
    </div>

    <div class="relative z-10 flex min-h-screen min-h-dvh flex-col px-4 pb-[calc(env(safe-area-inset-bottom)_+_1.5rem)] pt-[calc(env(safe-area-inset-top)_+_0.75rem)] sm:items-center sm:justify-center sm:px-6 sm:py-10">
      <div class="mx-auto mb-4 flex h-11 w-full max-w-sm items-center sm:absolute sm:left-8 sm:top-8 sm:mx-0 sm:mb-0 sm:w-auto sm:max-w-none">
        <UButton
          icon="i-lucide-chevron-left"
          to="/"
          size="lg"
          color="neutral"
          variant="subtle"
          class="rounded-full"
          aria-label="返回首页"
        />
      </div>

      <UPageCard
        variant="soft"
        class="ylf-surface w-full max-w-sm shadow-lg shadow-primary/5 hover:translate-y-0 hover:ring-0 sm:shadow-xl"
        :ui="{ root: 'transition-none hover:shadow-xl hover:shadow-primary/5' }"
      >
        <slot />
      </UPageCard>
    </div>
  </div>
</template>
