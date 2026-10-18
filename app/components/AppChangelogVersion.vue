<script setup lang="ts">
/**
 * 更新日志中的一条版本记录，作为时间线上的一个节点。
 *
 * 桌面端左侧是吸顶的日期列，中间一条晴空色时间轴；手机端日期移到标题上方。
 * latest 为最新一条：节点会轻轻呼吸，并带「最新」标记。
 */
const props = defineProps<{
  date?: string
  description?: string
  image?: string | { src?: string, alt?: string }
  /** 可交互插画名，存在时代替配图 */
  illustration?: string
  title?: string
  latest?: boolean
}>()

const imageSrc = computed(() => typeof props.image === 'string' ? props.image : props.image?.src)

const parsedDate = computed(() => {
  if (!props.date)
    return null
  const value = new Date(props.date)
  return Number.isNaN(value.getTime()) ? null : value
})
const dateLabel = computed(() => parsedDate.value
  ? parsedDate.value.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  : props.date)
const yearLabel = computed(() => parsedDate.value?.getFullYear())
</script>

<template>
  <article class="changelog-entry" :data-latest="latest ? '' : undefined">
    <div class="changelog-entry__date">
      <time :datetime="date" class="changelog-entry__day">{{ dateLabel }}</time>
      <span v-if="yearLabel" class="changelog-entry__year">{{ yearLabel }}</span>
    </div>

    <span class="changelog-entry__node" aria-hidden="true" />

    <div class="changelog-entry__card">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="font-heading text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          {{ title }}
        </h2>
        <span v-if="latest" class="changelog-entry__badge">最新</span>
      </div>
      <p v-if="description" class="text-sm leading-6 text-muted-foreground">
        {{ description }}
      </p>
      <figure v-if="illustration || imageSrc" class="changelog-entry__media">
        <ContentIllustration v-if="illustration" :name="illustration" />
        <img
          v-else
          :src="imageSrc"
          :alt="typeof image === 'object' ? image.alt || title : title"
          class="size-full object-cover"
          loading="lazy"
        >
      </figure>
      <div class="ylf-prose">
        <slot name="body" />
      </div>
    </div>
  </article>
</template>

<style scoped>
.changelog-entry {
  position: relative;
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  column-gap: 1rem;
  padding-bottom: 2.5rem;
}

/* 时间轴：节点之间连成一条淡淡的晴空色细线 */
.changelog-entry::before {
  position: absolute;
  top: 1.25rem;
  bottom: -0.25rem;
  left: 0.75rem;
  width: 2px;
  border-radius: 999px;
  background: linear-gradient(
    color-mix(in srgb, var(--ui-primary) 35%, transparent),
    color-mix(in srgb, var(--ui-primary) 10%, transparent)
  );
  content: '';
  translate: -50% 0;
}

.changelog-entry:last-child::before {
  display: none;
}

.changelog-entry__date {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.changelog-entry__day {
  color: var(--ui-text-highlighted);
  font-size: 0.875rem;
  font-weight: 600;
}

.changelog-entry__year {
  color: var(--ui-text-dimmed);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.changelog-entry__node {
  grid-column: 1;
  grid-row: 1 / span 2;
  position: relative;
  width: 0.875rem;
  height: 0.875rem;
  margin-top: 0.25rem;
  justify-self: center;
  border: 3px solid var(--ylf-surface);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-primary) 55%, var(--ylf-surface));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-primary) 35%, transparent);
}

[data-latest] .changelog-entry__node {
  background: var(--ui-primary);
}

/* 最新节点：一圈光晕缓慢扩散 */
[data-latest] .changelog-entry__node::after {
  position: absolute;
  inset: -3px;
  border-radius: inherit;
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-primary) 45%, transparent);
  content: '';
  /* 列表里不做常驻循环：进场后呼吸三次就停下 */
  animation: changelog-pulse 2.4s var(--ylf-ease-standard) 3;
}

@keyframes changelog-pulse {
  70%,
  100% {
    box-shadow: 0 0 0 10px transparent;
  }
}

.changelog-entry__card {
  grid-column: 2;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.75rem;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ylf-radius-lg);
  padding: 1.25rem;
  background: var(--ylf-surface);
  transition:
    border-color var(--ylf-duration-fast) var(--ylf-ease-standard),
    box-shadow var(--ylf-duration-normal) var(--ylf-ease-standard);
}

.changelog-entry__card:hover {
  border-color: color-mix(in srgb, var(--ui-primary) 24%, var(--ui-border-muted));
  box-shadow: 0 16px 36px -28px color-mix(in srgb, #0b82c4 55%, transparent);
}

.changelog-entry__badge {
  border-radius: 999px;
  padding: 0.125rem 0.5rem;
  color: var(--ylf-c-text-on-accent);
  background: var(--ui-primary);
  font-size: 0.6875rem;
  font-weight: 600;
}

.changelog-entry__media {
  overflow: hidden;
  aspect-ratio: 2 / 1;
  max-height: 16rem;
  border-radius: var(--ylf-radius);
  background: var(--ylf-surface-muted);
}

.changelog-entry__card .ylf-prose {
  font-size: 0.9375rem;
}

.changelog-entry__card .ylf-prose:empty {
  display: none;
}

/* 桌面端：日期独占左列并吸顶，滚动时始终知道自己读到了哪一天 */
@media (min-width: 768px) {
  .changelog-entry {
    grid-template-columns: 8rem 1.5rem minmax(0, 1fr);
    column-gap: 1.25rem;
    padding-bottom: 3rem;
  }

  .changelog-entry::before {
    left: calc(8rem + 1.25rem + 0.75rem);
  }

  .changelog-entry__date {
    position: sticky;
    top: 5.5rem;
    grid-column: 1;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.125rem;
    align-self: start;
    margin: 0.125rem 0 0;
    text-align: right;
  }

  .changelog-entry__node {
    grid-column: 2;
    grid-row: 1;
  }

  .changelog-entry__card {
    grid-column: 3;
    grid-row: 1;
    padding: 1.5rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-latest] .changelog-entry__node::after {
    animation: none;
  }
}
</style>
