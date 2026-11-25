<script setup lang="ts">
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from '@lucide/vue'
import { useMounted } from '@vueuse/core'
import { useAppearanceTransition } from '~/composables/useAppearanceTransition'

const options = [
  { value: 'system', label: '跟随系统', icon: MonitorIcon },
  { value: 'light', label: '浅色', icon: SunIcon },
  { value: 'dark', label: '深色', icon: MoonIcon },
] as const

const { preference, setAppearance } = useAppearanceTransition()
const mounted = useMounted()
// 浏览器保存的偏好只在客户端可见，挂载后再显示对应的图标和标签。
const current = computed(() => mounted.value ? options.find(option => option.value === preference.value) : undefined)
const label = computed(() => current.value ? `外观：${current.value.label}` : '外观')

function chooseAppearance(value: typeof options[number]['value'], trigger: HTMLElement | null, select: () => void) {
  select()
  setAppearance(value, trigger ?? undefined)
}
</script>

<template>
  <HeaderDisclosure :label="label" align="end" icon-only>
    <template #trigger>
      <component :is="current?.icon ?? MonitorIcon" class="size-5" aria-hidden="true" />
    </template>

    <template #default="{ select, trigger }">
      <div role="group" aria-label="外观">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          :aria-pressed="current?.value === option.value"
          class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-[var(--ylf-radius-menu-item)] px-2 py-2 text-sm whitespace-nowrap hover:bg-[var(--ylf-c-brand-soft)] hover:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-[var(--ylf-c-brand-soft)] aria-pressed:text-primary"
          @click="chooseAppearance(option.value, trigger, select)"
        >
          <component :is="option.icon" class="size-4 shrink-0" aria-hidden="true" />
          {{ option.label }}
          <CheckIcon v-if="current?.value === option.value" class="ml-auto size-4 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </template>
  </HeaderDisclosure>
</template>
