<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
    <!-- 彩色光晕背景 -->
    <div
      class="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      <div class="absolute -left-24 top-4 size-80 rounded-full bg-blue-400/30 blur-3xl dark:bg-blue-500/20" />
      <div class="absolute -right-20 top-20 size-80 rounded-full bg-violet-400/30 blur-3xl dark:bg-violet-500/20" />
      <div class="absolute -bottom-10 left-1/3 size-72 rounded-full bg-pink-400/25 blur-3xl dark:bg-pink-500/15" />
    </div>

    <UButton
      icon="i-lucide-chevron-left"
      to="/"
      size="xl"
      color="neutral"
      variant="subtle"
      class="absolute left-4 top-4 z-10 rounded-full sm:left-8 sm:top-8"
    />

    <UPageCard
      variant="subtle"
      class="ylf-surface relative z-10 w-full max-w-sm shadow-xl shadow-primary/5"
    >
      <slot />
    </UPageCard>
  </div>
</template>
