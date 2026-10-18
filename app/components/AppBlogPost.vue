<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { cn } from '@/lib/utils'

/**
 * 博客文章卡片。
 *
 * vertical：图在上、文在下的常规卡片；horizontal：首篇精选，桌面端图文左右排布，
 * 手机端自动回落为上下排布。悬停时封面轻微放大、标题变蓝、「阅读全文」箭头前探。
 */
const props = defineProps<{
  authors?: Array<{ name?: string }>
  badge?: { label?: string }
  date?: string
  description?: string
  image?: string | { src?: string, alt?: string }
  orientation?: 'horizontal' | 'vertical'
  /** 预计阅读分钟数 */
  readingMinutes?: number
  title?: string
  to?: RouteLocationRaw
  ui?: {
    description?: HTMLAttributes['class']
  }
}>()

const imageSrc = computed(() => typeof props.image === 'string' ? props.image : props.image?.src)
const destination = computed<RouteLocationRaw>(() => props.to || '/blog')
const featured = computed(() => props.orientation === 'horizontal')
</script>

<template>
  <NuxtLink :to="destination" class="blog-card group block h-full" :data-featured="featured ? '' : undefined">
    <article
      class="blog-card__surface flex h-full flex-col overflow-hidden"
      :class="featured ? 'md:flex-row' : ''"
    >
      <div
        v-if="imageSrc"
        class="blog-card__media relative shrink-0 overflow-hidden"
        :class="featured ? 'md:w-[52%]' : ''"
      >
        <img
          :src="imageSrc"
          :alt="typeof image === 'object' ? image.alt || title : title"
          class="blog-card__image size-full object-cover"
          loading="lazy"
        >
        <span v-if="featured" class="blog-card__ribbon">
          <Icon name="i-lucide-sparkles" class="size-3" aria-hidden="true" />
          最新
        </span>
      </div>
      <div
        class="flex flex-1 flex-col gap-2.5 p-5"
        :class="featured ? 'md:justify-center md:gap-3 md:p-8' : ''"
      >
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <AppBadge v-if="badge?.label" variant="subtle">
            {{ badge.label }}
          </AppBadge>
          <time v-if="date">{{ date }}</time>
          <template v-if="readingMinutes">
            <span aria-hidden="true">·</span>
            <span>约 {{ readingMinutes }} 分钟</span>
          </template>
        </div>
        <h2
          class="font-heading font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary"
          :class="featured ? 'text-lg md:text-2xl' : 'text-lg'"
        >
          {{ title }}
        </h2>
        <p v-if="description" :class="cn('line-clamp-2 text-sm leading-6 text-muted-foreground', ui?.description)">
          {{ description }}
        </p>
        <div class="mt-auto flex items-center justify-between gap-3 pt-2 text-xs text-muted-foreground">
          <span v-if="authors?.length" class="truncate">
            {{ authors.map(author => author.name).filter(Boolean).join('、') }}
          </span>
          <span class="blog-card__more ms-auto inline-flex shrink-0 items-center gap-1 font-medium text-primary">
            阅读全文
            <Icon name="i-lucide-arrow-right" class="blog-card__arrow size-3.5" aria-hidden="true" />
          </span>
        </div>
      </div>
    </article>
  </NuxtLink>
</template>

<style scoped>
.blog-card {
  border-radius: var(--ylf-radius-lg);
  outline: none;
}

.blog-card__surface {
  border: 1px solid var(--ui-border-muted);
  border-radius: inherit;
  background: var(--ylf-surface);
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  transition:
    translate var(--ylf-duration-slow) var(--ylf-ease-spring),
    border-color var(--ylf-duration-fast) var(--ylf-ease-standard),
    box-shadow var(--ylf-duration-normal) var(--ylf-ease-standard);
}

.blog-card:hover .blog-card__surface {
  border-color: color-mix(in srgb, var(--ui-primary) 28%, var(--ui-border-muted));
  box-shadow: 0 18px 40px -28px color-mix(in srgb, #0b82c4 55%, transparent);
  translate: 0 -3px;
}

.blog-card:focus-visible .blog-card__surface {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.blog-card__media {
  aspect-ratio: 16 / 10;
  background: var(--ylf-surface-muted);
}

[data-featured] .blog-card__media {
  max-height: 22rem;
}

@media (min-width: 768px) {
  [data-featured] .blog-card__media {
    aspect-ratio: auto;
    min-height: 17rem;
  }
}

.blog-card__image {
  transition: scale 900ms var(--ylf-ease-standard);
}

.blog-card:hover .blog-card__image {
  scale: 1.04;
}

.blog-card__ribbon {
  position: absolute;
  top: 0.75rem;
  left: 0.75rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: var(--ylf-radius-pill);
  padding: 0.25rem 0.6rem;
  color: #fff;
  background: color-mix(in srgb, #0a3161 55%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  font-size: 0.75rem;
  font-weight: 600;
}

.blog-card__arrow {
  transition: translate var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.blog-card:hover .blog-card__arrow {
  translate: 3px 0;
}

@media (prefers-reduced-motion: reduce) {
  .blog-card:hover .blog-card__surface,
  .blog-card:hover .blog-card__image,
  .blog-card:hover .blog-card__arrow {
    translate: none;
    scale: none;
  }
}
</style>
