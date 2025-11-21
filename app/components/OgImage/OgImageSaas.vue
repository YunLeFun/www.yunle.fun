<script setup lang="ts">
defineOptions({
  inheritAttrs: false,
})

defineProps({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
})
</script>

<template>
  <div class="p-8 text-center bg-slate-900 flex flex-col h-full w-full justify-center">
    <div class="relative">
      <h1 class="text-8xl text-white mb-4">
        {{ title }}
      </h1>
      <p class="text-5xl text-gray-200 leading-tight">
        {{ description }}
      </p>
    </div>
  </div>
</template>
