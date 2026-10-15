<script setup lang="ts">
import { MoonIcon, SunIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { useAppearanceTransition } from '~/composables/useAppearanceTransition'

// 夜幕从顶端落下、晴空从点击处展开，与 YunLeFun/design 文档站的切换方式一致。
const { toggleAppearance } = useAppearanceTransition()
</script>

<template>
  <Button
    type="button"
    variant="ghost"
    size="icon-lg"
    title="切换配色模式"
    @click="toggleAppearance"
  >
    <SunIcon class="hidden size-5 dark:block" aria-hidden="true" />
    <MoonIcon class="size-5 dark:hidden" aria-hidden="true" />
    <span class="sr-only dark:hidden">切换到深色模式</span>
    <span class="sr-only hidden dark:inline">切换到浅色模式</span>
  </Button>
</template>
