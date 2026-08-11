<script setup lang="ts">
import type { SeparatorProps } from 'reka-ui'
import { Separator } from '@/components/ui/separator'

const props = defineProps<SeparatorProps>()
</script>

<template>
  <Separator v-bind="props" />
</template>
