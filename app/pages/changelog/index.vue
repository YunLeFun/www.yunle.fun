<script setup lang="ts">
import changelogMeta from '~~/content/4.changelog.yml'

const page = ref(changelogMeta)
const { data: versions } = await useAsyncData('changelog-versions', () => getChangelogVersions())

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
  <AppContainer>
    <AppPageHeader
      v-bind="page"
      class="py-[50px]"
    >
      <template #headline>
        <YlfEyebrow label="🧾 更新日志" />
      </template>
    </AppPageHeader>

    <AppPageBody>
      <AppChangelogVersions>
        <AppChangelogVersion
          v-for="(version, index) in versions"
          :key="index"
          :title="version.title"
          :description="version.description"
          :date="version.date"
          :image="version.image"
        >
          <template #body>
            <MDCRenderer
              v-if="version.body"
              :body="version.body"
              :data="version"
            />
          </template>
        </AppChangelogVersion>
      </AppChangelogVersions>
    </AppPageBody>
  </AppContainer>
</template>
