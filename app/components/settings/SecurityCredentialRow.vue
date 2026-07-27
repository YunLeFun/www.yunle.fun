<script setup lang="ts">
import type { Component } from 'vue'
import { ArrowRightIcon, CheckIcon } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  icon: Component
  label: string
  description: string
  status: string
  action: string
  accent: 'mail' | 'phone' | 'password'
  ready: boolean
  actionTestId?: string
}>()

const emit = defineEmits<{
  action: []
}>()
</script>

<template>
  <div
    class="security-credential-row group"
    :data-accent="props.accent"
  >
    <span class="security-credential-row__icon" aria-hidden="true">
      <component :is="props.icon" />
    </span>

    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <h4 class="font-heading text-sm font-medium text-foreground">
          {{ props.label }}
        </h4>
        <Badge :variant="props.ready ? 'secondary' : 'outline'">
          <CheckIcon v-if="props.ready" data-icon="inline-start" />
          {{ props.status }}
        </Badge>
      </div>
      <p class="text-sm leading-5 text-muted-foreground">
        {{ props.description }}
      </p>
    </div>

    <Button
      :data-testid="props.actionTestId"
      variant="outline"
      size="sm"
      :aria-label="`${props.action}${props.label}`"
      @click="emit('action')"
    >
      {{ props.action }}
      <ArrowRightIcon data-icon="inline-end" />
    </Button>
  </div>
</template>

<style scoped>
.security-credential-row {
  --credential-accent: var(--primary);

  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.875rem;
  padding: 1rem;
}

.security-credential-row[data-accent='mail'] {
  --credential-accent: var(--ylf-dopa-blue);
}

.security-credential-row[data-accent='phone'] {
  --credential-accent: var(--ylf-dopa-cyan);
}

.security-credential-row[data-accent='password'] {
  --credential-accent: var(--ylf-dopa-amber);
}

.security-credential-row__icon {
  display: flex;
  width: 2.75rem;
  height: 2.75rem;
  align-items: center;
  justify-content: center;
  align-self: start;
  color: var(--credential-accent);
  background: color-mix(in srgb, var(--credential-accent) 11%, var(--card));
  border: 1px solid color-mix(in srgb, var(--credential-accent) 22%, var(--border));
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 22px -18px color-mix(in srgb, var(--credential-accent) 70%, transparent);
}

.security-credential-row__icon :deep(svg) {
  width: 1.125rem;
  height: 1.125rem;
}

.security-credential-row :deep([data-slot='button']) {
  grid-column: 2;
  justify-self: start;
}

.security-credential-row :deep([data-slot='button'] svg) {
  transition: transform 150ms ease;
}

.security-credential-row :deep([data-slot='button']:hover svg) {
  transform: translateX(0.125rem);
}

@media (min-width: 640px) {
  .security-credential-row {
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 1rem;
    padding: 1.125rem 1.25rem;
  }

  .security-credential-row__icon {
    align-self: center;
  }

  .security-credential-row :deep([data-slot='button']) {
    grid-column: 3;
    justify-self: end;
  }
}

@media (prefers-reduced-motion: reduce) {
  .security-credential-row :deep([data-slot='button'] svg) {
    transition: none;
  }
}
</style>
