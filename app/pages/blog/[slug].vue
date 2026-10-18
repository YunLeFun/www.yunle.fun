<script setup lang="ts">
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

const route = useRoute()
const slug = computed(() => route.params.slug as string)

const { data: post } = await useAsyncData(route.path, () => getBlogPost(slug.value))
if (!post.value) {
  throw createError({ statusCode: 404, statusMessage: 'Post not found', fatal: true })
}

const title = post.value.seo?.title || post.value.title
const description = post.value.seo?.description || post.value.description

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
})

const coverSrc = computed(() => typeof post.value?.image === 'string' ? post.value.image : post.value?.image?.src)
const publishedAt = computed(() => formatContentDate(post.value?.date))
const readingMinutes = computed(() => estimateReadingMinutes(post.value?.body))

// 阅读进度：正文从进入视口顶部到读完的比例，驱动导航栏下方的细进度条
const articleRef = shallowRef<HTMLElement | null>(null)
const progress = shallowRef(0)
let frame = 0

function measure() {
  frame = 0
  const el = articleRef.value
  if (!el)
    return
  const box = el.getBoundingClientRect()
  const total = box.height - window.innerHeight * 0.6
  progress.value = total > 0 ? Math.min(Math.max(-box.top / total, 0), 1) : 1
}

function schedule() {
  if (!frame)
    frame = requestAnimationFrame(measure)
}

useEventListener('scroll', schedule, { passive: true })
useEventListener('resize', schedule, { passive: true })
onMounted(measure)
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div v-if="post">
    <div class="blog-progress" aria-hidden="true">
      <span class="blog-progress__bar" :style="{ scale: `${progress} 1` }" />
    </div>

    <AppContainer class="py-8 sm:py-12">
      <article ref="articleRef" class="mx-auto max-w-[44rem]">
        <NuxtLink to="/blog" class="blog-back ylf-rise">
          <Icon name="i-lucide-arrow-left" class="blog-back__icon size-4" aria-hidden="true" />
          博客
        </NuxtLink>

        <header class="ylf-rise mt-5 flex flex-col gap-4" style="--i: 1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <AppBadge v-if="post.badge" v-bind="post.badge" variant="subtle" />
            <time>{{ publishedAt }}</time>
            <span aria-hidden="true">·</span>
            <span>约 {{ readingMinutes }} 分钟读完</span>
          </div>
          <h1 class="font-heading text-[1.75rem] leading-tight font-bold tracking-tight text-foreground text-balance sm:text-4xl">
            {{ post.title }}
          </h1>
          <p v-if="post.description" class="text-base leading-7 text-muted-foreground sm:text-lg">
            {{ post.description }}
          </p>
          <div v-if="post.authors?.length" class="flex flex-wrap items-center gap-2">
            <component
              :is="author.to ? 'a' : 'span'"
              v-for="(author, index) in post.authors"
              :key="index"
              :href="author.to"
              :target="author.to ? '_blank' : undefined"
              :rel="author.to ? 'noopener noreferrer' : undefined"
              class="blog-author"
            >
              <Avatar class="size-7">
                <AvatarImage v-if="author.avatar" :src="author.avatar.src" :alt="author.name || '作者头像'" />
                <AvatarFallback class="text-xs">
                  {{ (author.name || '作').slice(0, 1) }}
                </AvatarFallback>
              </Avatar>
              <span class="text-sm font-medium text-foreground">{{ author.name }}</span>
            </component>
          </div>
        </header>

        <figure v-if="post.illustration || coverSrc" class="blog-cover ylf-rise mt-8" style="--i: 2" data-vt="blog-cover">
          <ContentIllustration v-if="post.illustration" :name="post.illustration" />
          <img v-else :src="coverSrc" :alt="post.title" class="size-full object-cover">
          <figcaption v-if="post.illustration" class="blog-cover__hint">
            <Icon name="i-lucide-mouse-pointer-click" class="size-3.5" aria-hidden="true" />
            可以戳一戳
          </figcaption>
        </figure>

        <div class="ylf-rise mt-8 sm:mt-10" style="--i: 3">
          <MDCRenderer
            v-if="post.body"
            :body="post.body"
            :data="post"
            class="ylf-prose"
          />
        </div>

        <footer class="blog-end mt-12">
          <CuteCloud shape="round" face mood="happy" class="blog-end__cloud" />
          <p class="text-sm font-medium text-foreground">
            读完啦，谢谢你陪云乐坊走了这一段
          </p>
          <NuxtLink to="/blog" class="blog-end__link">
            看看其他文章
            <Icon name="i-lucide-arrow-right" class="size-4" aria-hidden="true" />
          </NuxtLink>
        </footer>
      </article>
    </AppContainer>
  </div>
</template>

<style scoped>
/* 阅读进度条：贴在吸顶导航栏下沿，晴空蓝到青色的细线 */
.blog-progress {
  position: sticky;
  z-index: 30;
  top: 4rem;
  height: 3px;
  margin-bottom: -3px;
  pointer-events: none;
}

.blog-progress__bar {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--ylf-palette-blue), var(--ylf-palette-cyan));
  transform-origin: 0 50%;
  transition: scale 120ms linear;
}

.blog-back {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  gap: 0.375rem;
  color: var(--ui-text-muted);
  font-size: 0.875rem;
  font-weight: 500;
  transition: color var(--ylf-duration-fast) var(--ylf-ease-standard);
}

.blog-back:hover {
  color: var(--ui-primary);
}

.blog-back__icon {
  transition: translate var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.blog-back:hover .blog-back__icon {
  translate: -3px 0;
}

.blog-author {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ylf-radius-pill);
  padding: 0.25rem 0.75rem 0.25rem 0.25rem;
  background: var(--ylf-surface);
  transition: border-color var(--ylf-duration-fast) var(--ylf-ease-standard);
}

a.blog-author:hover {
  border-color: color-mix(in srgb, var(--ui-primary) 35%, var(--ui-border-muted));
}

.blog-cover {
  position: relative;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ylf-radius-lg);
  background: var(--ylf-surface-muted);
}

.blog-cover__hint {
  position: absolute;
  bottom: 0.75rem;
  left: 0.75rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: var(--ylf-radius-pill);
  padding: 0.25rem 0.6rem;
  color: #fff;
  background: color-mix(in srgb, #0a3161 50%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  font-size: 0.75rem;
  font-weight: 500;
  pointer-events: none;
}

.blog-end {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  border-top: 1px dashed var(--ui-border);
  padding-top: 2.5rem;
  text-align: center;
}

.blog-end__cloud {
  width: 4.5rem;
  margin-bottom: 0.25rem;
  animation: ylf-bob 5s ease-in-out infinite;
  filter: drop-shadow(0 6px 10px color-mix(in srgb, var(--ui-primary) 20%, transparent));
}

.blog-end__link {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  gap: 0.25rem;
  color: var(--ui-primary);
  font-size: 0.875rem;
  font-weight: 500;
}

@media (prefers-reduced-motion: reduce) {
  .blog-progress__bar {
    transition: none;
  }

  .blog-end__cloud {
    animation: none;
  }

  .blog-back:hover .blog-back__icon {
    translate: none;
  }
}
</style>
