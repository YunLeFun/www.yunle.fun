<script setup lang="ts">
import { ConstructionIcon } from '@lucide/vue'
import developerPage from '~~/content/5.developer.yml'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

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
    <AppPageHero
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
    </AppPageHero>

    <AppContainer
      v-if="page.notice"
      class="-mt-4 mb-4"
    >
      <Alert>
        <ConstructionIcon />
        <AlertTitle>{{ page.notice.title }}</AlertTitle>
        <AlertDescription>{{ page.notice.description }}</AlertDescription>
      </Alert>
    </AppContainer>

    <AppPageSection
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
    </AppPageSection>

    <AppPageSection
      :title="page.features.title"
      :description="page.features.description"
    >
      <template #headline>
        <div class="flex justify-center">
          <YlfEyebrow :label="page.features.headline" />
        </div>
      </template>

      <AppPageGrid>
        <AppPageCard
          v-for="(item, index) in (page.features.items as any[])"
          :key="index"
          v-bind="item"
          spotlight
          :ui="{ leadingIcon: featureIconColors[index % featureIconColors.length] }"
        />
      </AppPageGrid>
    </AppPageSection>

    <AppPageSection
      id="resources"
      :headline="page.resources.headline"
      :title="page.resources.title"
      :description="page.resources.description"
    >
      <AppPageGrid>
        <AppPageCard
          v-for="(resource, index) in page.resources.items"
          :key="index"
          v-bind="resource"
          variant="subtle"
        />
      </AppPageGrid>
    </AppPageSection>

    <AppSeparator />

    <AppPageCta
      v-bind="page.cta"
      variant="naked"
      class="overflow-hidden"
    >
      <div class="ylf-cta-glow" />
      <LazyStarsBg />
    </AppPageCta>
  </div>
</template>
