<script setup lang="ts">
const props = defineProps<{
  current: 1 | 2
  firstLabel: string
  secondLabel: string
}>()
</script>

<template>
  <div
    class="verification-progress"
    :aria-label="`第 ${props.current} 步，共 2 步`"
  >
    <div class="flex items-center justify-between gap-3 text-xs font-medium">
      <span class="text-muted-foreground">第 {{ props.current }} 步，共 2 步</span>
      <span class="text-foreground">
        {{ props.current === 1 ? props.firstLabel : props.secondLabel }}
      </span>
    </div>
    <div class="grid grid-cols-2 gap-1.5" aria-hidden="true">
      <span class="verification-progress__segment" data-active="true" />
      <span class="verification-progress__segment" :data-active="props.current === 2" />
    </div>
  </div>
</template>

<style scoped>
.verification-progress {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.875rem 1rem;
  background: color-mix(in srgb, var(--muted) 74%, var(--card));
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.verification-progress__segment {
  height: 0.25rem;
  background: var(--border);
  border-radius: 9999px;
  transition:
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.verification-progress__segment[data-active='true'] {
  background: var(--primary);
  box-shadow: 0 4px 14px -7px color-mix(in srgb, var(--primary) 78%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .verification-progress__segment {
    transition: none;
  }
}
</style>
