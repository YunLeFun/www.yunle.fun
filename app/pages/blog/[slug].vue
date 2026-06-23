<script setup lang="ts">
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
  <UContainer v-if="post">
    <UPageHeader
      :title="post.title"
      :description="post.description"
    >
      <template #headline>
        <UBadge
          v-if="post.badge"
          v-bind="post.badge"
          variant="subtle"
        />
        <span class="text-muted">&middot;</span>
        <time class="text-muted">{{ new Date(post.date ?? Date.now()).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) }}</time>
      </template>

      <div class="mt-4 flex flex-wrap gap-3 items-center">
        <UButton
          v-for="(author, index) in post.authors"
          :key="index"
          :to="author.to"
          color="neutral"
          variant="subtle"
          target="_blank"
          size="sm"
        >
          <UAvatar
            v-if="author.avatar"
            v-bind="author.avatar"
            alt="Author avatar"
            size="2xs"
          />

          {{ author.name }}
        </UButton>
      </div>
    </UPageHeader>

    <UPage>
      <UPageBody>
        <MDCRenderer
          v-if="post.body"
          :body="post.body"
          :data="post"
        />
      </UPageBody>
    </UPage>
  </UContainer>
</template>
