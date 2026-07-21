<script setup lang="ts">
import developerPage from '~~/content/5.developer.yml'

const page = ref(developerPage)

const title = page.value?.seo?.title || page.value?.title
const description = page.value?.seo?.description || page.value?.description

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
})

// Rotate icon colors across the feature grid for a playful, colorful look
const featureIconColors = [
  'text-blue-500 dark:text-blue-400',
  'text-violet-500 dark:text-violet-400',
  'text-pink-500 dark:text-pink-400',
]
</script>

<template>
  <div v-if="page">
    <UPageHero
      :title="page.title"
      :description="page.description"
      :links="page.hero.links"
    >
      <template #top>
        <HeroBackground />
      </template>

      <template #headline>
        <YlfEyebrow :label="page.headline" />
      </template>

      <template #title>
        云乐坊 <span class="ylf-gradient-text">应用生态</span>
      </template>
    </UPageHero>

    <UContainer
      v-if="page.notice"
      class="-mt-4 mb-4"
    >
      <UAlert
        :title="page.notice.title"
        :description="page.notice.description"
        icon="i-lucide-construction"
        color="warning"
        variant="subtle"
      />
    </UContainer>

    <UPageSection
      v-for="(section, index) in (page.sections as any[])"
      :key="index"
      :title="section.title"
      :description="section.description"
      :orientation="section.orientation"
      :reverse="section.reverse"
      :features="section.features"
    >
      <template #headline>
        <YlfEyebrow :label="section.headline" />
      </template>
    </UPageSection>

    <UPageSection
      :title="page.features.title"
      :description="page.features.description"
    >
      <template #headline>
        <div class="flex justify-center">
          <YlfEyebrow :label="page.features.headline" />
        </div>
      </template>

      <UPageGrid>
        <UPageCard
          v-for="(item, index) in (page.features.items as any[])"
          :key="index"
          v-bind="item"
          spotlight
          :ui="{ leadingIcon: featureIconColors[index % featureIconColors.length] }"
        />
      </UPageGrid>
    </UPageSection>

    <UPageSection
      id="resources"
      :headline="page.resources.headline"
      :title="page.resources.title"
      :description="page.resources.description"
    >
      <UPageGrid>
        <UPageCard
          v-for="(resource, index) in page.resources.items"
          :key="index"
          v-bind="resource"
          variant="subtle"
        />
      </UPageGrid>
    </UPageSection>

    <USeparator />

    <UPageCTA
      v-bind="page.cta"
      variant="naked"
      class="overflow-hidden"
    >
      <div class="ylf-cta-glow" />
      <LazyStarsBg />
    </UPageCTA>
  </div>
</template>
