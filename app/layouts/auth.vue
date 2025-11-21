<template>
  <div class="px-4 flex h-screen items-center justify-center">
    <UButton
      icon="i-lucide-chevron-left"
      to="/"
      size="xl"
      color="neutral"
      variant="subtle"
      class="rounded-full left-8 top-8 absolute z-10"
    />

    <UPageCard
      variant="subtle"
      class="max-w-sm w-full"
    >
      <slot />
    </UPageCard>
  </div>
</template>
