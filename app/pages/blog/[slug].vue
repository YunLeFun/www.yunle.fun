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
</script>

<template>
  <AppContainer v-if="post">
    <AppPageHeader
      :title="post.title"
      :description="post.description"
    >
      <template #headline>
        <AppBadge
          v-if="post.badge"
          v-bind="post.badge"
          variant="subtle"
        />
        <span class="text-muted">&middot;</span>
        <time class="text-muted">{{ new Date(post.date ?? Date.now()).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) }}</time>
      </template>

      <div class="mt-4 flex flex-wrap gap-3 items-center">
        <AppButton
          v-for="(author, index) in post.authors"
          :key="index"
          :to="author.to"
          color="neutral"
          variant="subtle"
          target="_blank"
          size="sm"
        >
          <Avatar
            v-if="author.avatar"
            size="sm"
          >
            <AvatarImage :src="author.avatar.src" :alt="author.name || '作者头像'" />
            <AvatarFallback>{{ (author.name || '作').slice(0, 1) }}</AvatarFallback>
          </Avatar>

          {{ author.name }}
        </AppButton>
      </div>
    </AppPageHeader>

    <AppPage>
      <AppPageBody>
        <MDCRenderer
          v-if="post.body"
          :body="post.body"
          :data="post"
        />
      </AppPageBody>
    </AppPage>
  </AppContainer>
</template>
