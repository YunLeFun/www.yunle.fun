<script setup lang="ts">
import blogMeta from '~~/content/3.blog.yml'

const page = ref(blogMeta)
const { data: posts } = await useAsyncData('blog-posts', () => getBlogPosts())

const title = page.value?.seo?.title || page.value?.title
const description = page.value?.seo?.description || page.value?.description

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
})
</script>

<template>
  <AppContainer class="py-8 sm:py-10">
    <div class="mx-auto flex max-w-5xl flex-col gap-6 sm:gap-8">
      <SubpageHero
        :title="page?.title || '博客'"
        :description="page?.description"
        :back="false"
        icon="i-lucide-newspaper"
      />

      <div v-if="posts?.length" class="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <AppBlogPost
          v-for="(post, index) in posts"
          :key="post.path"
          class="ylf-rise"
          :class="[index === 0 && 'col-span-full']"
          :style="{ '--i': index + 1 }"
          :to="post.path"
          :title="post.title"
          :description="post.description"
          :image="post.image"
          :illustration="post.illustration"
          :date="formatContentDate(post.date)"
          :reading-minutes="estimateReadingMinutes(post.body)"
          :authors="post.authors"
          :badge="post.badge"
          :orientation="index === 0 ? 'horizontal' : 'vertical'"
        />
      </div>
      <div v-else class="ylf-empty-state ylf-rise rounded-[var(--ylf-radius-lg)] px-4 py-14 text-center" style="--i: 1">
        <span class="ylf-empty-cloud ylf-bob" aria-hidden="true">
          <Icon name="i-lucide-pen-line" class="size-6" />
        </span>
        <p class="text-sm text-muted">
          第一篇文章还在路上
        </p>
      </div>
    </div>
  </AppContainer>
</template>
