<script setup lang="ts">
/**
 * 应用页的标准内容卡片：圆角 20px、内边距 16 / 20px，标题用 section 字号。
 *
 * 个人中心、个人主页等页面的「标题 + 说明 + 右侧操作 + 内容」区块统一用它，
 * 不再在每个页面重复写 ylf-card、h2 和间距。rise 传入序号时随页面依次浮起。
 */
defineProps<{
  title?: string
  description?: string
  /** 标题旁的小图标 */
  icon?: string
  /** 进入动画的错开序号；不传则不播放 */
  rise?: number
}>()
</script>

<template>
  <section
    class="ylf-card ylf-section"
    :class="{ 'ylf-rise': rise !== undefined }"
    :style="rise !== undefined ? { '--i': rise } : undefined"
  >
    <header v-if="title || $slots.actions" class="ylf-section__header">
      <div class="min-w-0">
        <h2 v-if="title" class="ylf-section-title flex items-center gap-2">
          {{ title }}
          <Icon v-if="icon" :name="icon" class="size-4 text-primary" aria-hidden="true" />
        </h2>
        <p v-if="description" class="ylf-caption mt-0.5">
          {{ description }}
        </p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-1">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.ylf-section {
  padding: 1rem;
}

.ylf-section__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.875rem;
}

@media (min-width: 640px) {
  .ylf-section {
    padding: 1.25rem;
  }

  .ylf-section__header {
    margin-bottom: 1rem;
  }
}
</style>
