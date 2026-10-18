<script setup lang="ts">
import type { Component } from 'vue'
import IllustrationApps from '~/components/illustration/Apps.vue'
import IllustrationLaunch from '~/components/illustration/Launch.vue'
import IllustrationStudio from '~/components/illustration/Studio.vue'

/**
 * 可交互插画的统一入口。
 *
 * - 博客 / 更新日志的 frontmatter 写 `illustration: apps`，卡片与封面会用它代替图片；
 * - Markdown 正文里也能直接嵌入：`::content-illustration{name="apps"}`。
 *
 * 新增插画时在 illustration/ 下实现场景，再把名字登记到 SCENES。
 */
const props = withDefaults(defineProps<{
  name: string
  /** 正文嵌入时的宽高比 */
  ratio?: string
}>(), {
  ratio: '16 / 9',
})

const SCENES: Record<string, Component> = {
  apps: IllustrationApps,
  launch: IllustrationLaunch,
  studio: IllustrationStudio,
}

const scene = computed(() => SCENES[props.name] ?? IllustrationLaunch)
</script>

<template>
  <div class="content-illustration" :style="{ '--ratio': ratio }">
    <ClientOnly>
      <component :is="scene" />
      <template #fallback>
        <div class="content-illustration__placeholder" />
      </template>
    </ClientOnly>
  </div>
</template>

<style scoped>
.content-illustration {
  width: 100%;
  height: 100%;
}

/* 正文中嵌入时没有外层定高，按 ratio 撑开并带上与图片一致的圆角描边 */
:where(.ylf-prose) .content-illustration {
  overflow: hidden;
  height: auto;
  aspect-ratio: var(--ratio);
  margin-block: 0 1.1em;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ylf-radius);
}

.content-illustration__placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(170deg, #3b8be4, #8cc8f3 55%, #e3f1fc);
}

.dark .content-illustration__placeholder {
  background: linear-gradient(170deg, #2f3568, #8a6aa8 55%, #f2a98a);
}
</style>
