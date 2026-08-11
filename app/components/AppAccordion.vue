<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

interface AccordionEntry {
  content?: string
  label?: string
  title?: string
  to?: string
}

withDefaults(defineProps<{
  defaultValue?: string[]
  items: AccordionEntry[]
  type?: 'single' | 'multiple'
  unmountOnHide?: boolean
  ui?: {
    body?: HTMLAttributes['class']
    item?: HTMLAttributes['class']
    trigger?: HTMLAttributes['class']
  }
}>(), {
  type: 'single',
  unmountOnHide: true,
})
</script>

<template>
  <Accordion :type="type" :default-value="type === 'multiple' ? defaultValue : defaultValue?.[0]" collapsible>
    <AccordionItem v-for="(item, index) in items" :key="index" :value="String(index)" :class="ui?.item">
      <AccordionTrigger :class="ui?.trigger">
        {{ item.label || item.title }}
      </AccordionTrigger>
      <AccordionContent :class="ui?.body">
        <slot name="body" :item="item" :index="index">
          {{ item.content }}
        </slot>
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</template>
