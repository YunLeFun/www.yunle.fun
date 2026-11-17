<script setup lang="ts">
import { MonitorIcon, MoonIcon, SunIcon } from '@lucide/vue'
import { useMounted } from '@vueuse/core'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
const trigger = useTemplateRef<InstanceType<typeof Button>>('trigger')
</script>

<template>
  <DropdownMenu :modal="false">
    <DropdownMenuTrigger as-child>
      <Button
        ref="trigger"
        type="button"
        variant="ghost"
        size="icon-lg"
        :title="label"
        :aria-label="label"
      >
        <component :is="current?.icon ?? MonitorIcon" class="size-5" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" :side-offset="8" class="w-auto min-w-36">
      <DropdownMenuRadioGroup :model-value="preference">
        <DropdownMenuRadioItem
          v-for="option in options"
          :key="option.value"
          :value="option.value"
          class="min-h-11"
          @select="setAppearance(option.value, trigger?.$el)"
        >
          <component :is="option.icon" aria-hidden="true" />
          {{ option.label }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
