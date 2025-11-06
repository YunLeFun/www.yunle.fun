<script lang="ts" setup>
import type { SocialItem } from '~/config'

defineProps<{
  socialList: SocialItem[]
}>()
</script>

<template>
  <div
    flex
    gap-5
    justify="center"
  >
    <a
      v-for="(item, i) in socialList"
      :key="i"
      :href="item.link"
      :title="item.title"
      target="_blank"
    >
      <div
        v-if="item.icon.startsWith('i-')"
        :class="item.icon"
      />
      <div v-else>
        <img :src="item.icon">
      </div>
    </a>
  </div>
</template>
