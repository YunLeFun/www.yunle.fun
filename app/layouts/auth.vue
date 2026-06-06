<template>
  <div class="flex min-h-screen items-center justify-center px-4 py-8">
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
      class="ylf-surface w-full max-w-sm"
    >
      <slot />
    </UPageCard>
  </div>
</template>
