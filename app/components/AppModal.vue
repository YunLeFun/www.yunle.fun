<script setup lang="ts">
import { computed } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const props = withDefaults(defineProps<{
  close?: boolean
  description?: string
  dismissible?: boolean
  title: string
  ui?: { content?: string }
}>(), {
  close: true,
  description: '对话框内容',
  dismissible: true,
})

const open = defineModel<boolean>('open', { default: false })
const contentClass = computed(() => props.ui?.content)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :class="contentClass"
      :show-close-button="close"
      @escape-key-down="dismissible ? undefined : $event.preventDefault()"
      @pointer-down-outside="dismissible ? undefined : $event.preventDefault()"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <slot name="content" />
      <slot />
    </DialogContent>
  </Dialog>
</template>
