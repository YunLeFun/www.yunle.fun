<script setup lang="ts">
import type { ExplorerApp } from '~/types/app-explorer'
import { computed, shallowRef, watch } from 'vue'

const props = defineProps<{
  app: ExplorerApp
}>()

const imageFailed = shallowRef(false)
const imageSource = computed(() => props.app.logo || props.app.icon)

watch(imageSource, () => {
  imageFailed.value = false
})
</script>

<template>
  <span
    class="app-explorer-icon"
    :style="{ '--app-accent': app.accent }"
    aria-hidden="true"
  >
    <img
      v-if="imageSource && !imageFailed"
      data-testid="app-icon-image"
      :src="imageSource"
      alt=""
      class="app-explorer-icon__image"
      loading="lazy"
      @error="imageFailed = true"
    >
    <span
      v-else-if="app.emoji"
      data-testid="app-icon-emoji"
      class="app-explorer-icon__emoji"
    >{{ app.emoji }}</span>
    <Icon
      v-else
      data-testid="app-icon-cloud"
      name="i-lucide-cloud"
      class="app-explorer-icon__cloud"
    />
  </span>
</template>

<style scoped>
.app-explorer-icon {
  display: inline-grid;
  width: 3.25rem;
  height: 3.25rem;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--app-accent) 35%, transparent);
  border-radius: 1rem;
  background:
    radial-gradient(circle at 30% 20%, color-mix(in srgb, white 70%, transparent), transparent 42%),
    color-mix(in srgb, var(--app-accent) 14%, var(--ui-bg));
  box-shadow: 0 10px 30px color-mix(in srgb, var(--app-accent) 14%, transparent);
}

.app-explorer-icon__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.app-explorer-icon__emoji {
  font-size: 1.75rem;
  line-height: 1;
}

.app-explorer-icon__cloud {
  width: 1.75rem;
  height: 1.75rem;
  color: var(--app-accent);
}
</style>
