<script setup lang="ts">
import { MoonIcon, SunIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'

const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

function toggleColorMode() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}
</script>

<template>
  <Button
    type="button"
    variant="ghost"
    size="icon-sm"
    title="切换配色模式"
    @click="toggleColorMode"
  >
    <SunIcon class="hidden dark:block" aria-hidden="true" />
    <MoonIcon class="dark:hidden" aria-hidden="true" />
    <span class="sr-only dark:hidden">切换到深色模式</span>
    <span class="sr-only hidden dark:inline">切换到浅色模式</span>
  </Button>
</template>
