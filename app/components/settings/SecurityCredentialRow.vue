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
        <h3 class="font-heading text-[0.9375rem] font-semibold text-foreground">
          {{ props.label }}
        </h3>
        <Badge class="credential-status" :class="{ 'credential-status--ready': props.ready }" :variant="props.ready ? 'secondary' : 'outline'">
          <CheckIcon v-if="props.ready" data-icon="inline-start" />
          {{ props.status }}
        </Badge>
      </div>
      <p class="credential-description text-[0.8125rem] leading-5 text-muted-foreground">
        {{ props.description }}
      </p>
    </div>

    <Button
      :data-testid="props.actionTestId"
      class="credential-action"
      variant="secondary"
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
  --credential-soft: var(--ylf-accent-blue-soft);
  --credential-text: var(--ylf-accent-blue-text);
  display: grid;
  grid-template-columns: 3rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.875rem;
  padding: 1.375rem 0;
  border-bottom: 1px solid var(--ylf-c-border);
}
.security-credential-row[data-accent='phone'] {
  --credential-soft: var(--ylf-accent-cyan-soft);
  --credential-text: var(--ylf-accent-cyan-text);
}
.security-credential-row[data-accent='password'] {
  --credential-soft: var(--ylf-accent-sun-soft);
  --credential-text: var(--ylf-accent-sun-text);
}
.security-credential-row__icon {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: var(--ylf-radius);
  background: var(--credential-soft);
  color: var(--credential-text);
}
.security-credential-row__icon :deep(svg) {
  width: 1.375rem;
  height: 1.375rem;
  stroke-width: 1.75;
}
.credential-description {
  overflow-wrap: anywhere;
}
.credential-status {
  border: 0;
  border-radius: var(--ylf-radius-sm);
  font-size: 0.6875rem;
  font-weight: 500;
}
.credential-status--ready {
  color: var(--ylf-status-success-text);
  background: var(--ylf-status-success-soft);
}
.credential-action {
  min-height: 2.75rem;
  background: var(--ylf-c-brand-soft);
  color: var(--ylf-c-brand);
  border-radius: var(--ylf-radius-sm);
}
.credential-action:hover {
  background: color-mix(in srgb, var(--ylf-c-brand) 15%, var(--ylf-c-brand-soft));
}
@media (max-width: 380px) {
  .security-credential-row {
    grid-template-columns: 2.75rem minmax(0, 1fr) auto;
    gap: 0.625rem;
  }
  .security-credential-row__icon {
    width: 2.75rem;
    height: 2.75rem;
  }
  .credential-action :deep(svg) {
    display: none;
  }
}
</style>
