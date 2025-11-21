<script setup lang="ts">
import { UCard } from '#components'

defineProps<{
  reverse?: boolean
  card?: boolean
}>()
</script>

<template>
  <component :is="card ? UCard : 'div'">
    <div class="gap-x-8 grid grid-cols-3 w-full items-center">
      <div :class="{ 'order-2': reverse }">
        <slot name="image" />
      </div>
      <div class="col-span-2">
        <slot />
      </div>
    </div>
  </component>
</template>
