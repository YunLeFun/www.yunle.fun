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
  <AppContainer class="py-8 sm:py-10">
    <div class="mx-auto flex max-w-4xl flex-col gap-8 sm:gap-10">
      <SubpageHero
        :title="page?.title || '更新日志'"
        :description="page?.description || '云乐坊的每一次成长，都记在这里'"
        :back="false"
        icon="i-lucide-scroll-text"
      />

      <div v-if="versions?.length">
        <AppChangelogVersion
          v-for="(version, index) in versions"
          :key="version.title ?? index"
          class="ylf-rise"
          :style="{ '--i': index + 1 }"
          :title="version.title"
          :description="version.description"
          :date="version.date"
          :image="version.image"
          :illustration="version.illustration"
          :latest="index === 0"
        >
          <template #body>
            <MDCRenderer
              v-if="version.body"
              :body="version.body"
              :data="version"
            />
          </template>
        </AppChangelogVersion>
      </div>
    </div>
  </AppContainer>
</template>
