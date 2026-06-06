<script setup lang="ts">
const appear = ref(false)

onMounted(() => {
  requestAnimationFrame(() => {
    appear.value = true
  })
})
</script>

<template>
  <div
    class="ylf-hero-bg pointer-events-none absolute inset-x-0 top-0 h-[760px] overflow-hidden transition-opacity duration-1000 sm:h-[840px]"
    :class="appear ? 'opacity-100' : 'opacity-0'"
    aria-hidden="true"
  >
    <!-- colorful glow blobs -->
    <div class="ylf-blob ylf-blob--blue" />
    <div class="ylf-blob ylf-blob--violet" />
    <div class="ylf-blob ylf-blob--pink" />
    <div class="ylf-blob ylf-blob--cyan" />

    <!-- dotted grid texture -->
    <div class="ylf-hero-grid" />

    <!-- fade into page background -->
    <div class="ylf-hero-fade" />
  </div>
</template>
