<script setup lang="ts">
const route = useRoute()

const { data: page } = await useAsyncData(route.path, () => getDocPage(route.path))
if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}

const title = page.value.seo?.title || page.value.title
const description = page.value.seo?.description || page.value.description

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
})
</script>

<template>
  <UContainer v-if="page" class="py-10">
    <UPageHeader
      :title="page.title"
      :description="page.description"
      class="mb-8"
    />

    <UPageBody>
      <MDCRenderer
        v-if="page.body"
        :body="page.body"
        :data="page"
      />
    </UPageBody>
  </UContainer>
</template>
