<script setup lang="ts">
const { data: page } = await useAsyncData('index', () => queryCollection('index').first())

const title = page.value?.seo?.title || page.value?.title
const description = page.value?.seo?.description || page.value?.description

useSeoMeta({
  titleTemplate: '',
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
        <span class="ylf-eyebrow">{{ page.headline }}</span>
      </template>

      <template #title>
        <MDC
          :value="page.title"
          unwrap="p"
        />
      </template>

      <!-- <PromotionalVideo /> -->
    </UPageHero>

    <UPageSection
      v-for="(section, index) in page.sections"
      :key="index"
      :title="section.title"
      :description="section.description"
      :orientation="section.orientation"
      :reverse="section.reverse"
      :features="section.features"
    >
      <template #headline>
        <span class="ylf-eyebrow">{{ section.headline }}</span>
      </template>

      <MarketingPreview
        :kind="index === 0 ? 'marketplace' : 'developer'"
        :index="index"
      />
    </UPageSection>

    <UPageSection
      :title="page.features.title"
      :description="page.features.description"
    >
      <template #headline>
        <span class="ylf-eyebrow">{{ page.features.headline }}</span>
      </template>

      <UPageGrid>
        <UPageCard
          v-for="(item, index) in page.features.items"
          :key="index"
          v-bind="item"
          spotlight
          :ui="{ leadingIcon: featureIconColors[index % featureIconColors.length] }"
        />
      </UPageGrid>
    </UPageSection>

    <UPageSection
      id="testimonials"
      :headline="page.testimonials.headline"
      :title="page.testimonials.title"
      :description="page.testimonials.description"
    >
      <UPageColumns class="xl:columns-4">
        <UPageCard
          v-for="(testimonial, index) in page.testimonials.items"
          :key="index"
          variant="subtle"
          :description="testimonial.quote"
          :ui="{ description: 'before:content-[open-quote] after:content-[close-quote]' }"
        >
          <template #footer>
            <UUser
              v-bind="testimonial.user"
              size="lg"
            />
          </template>
        </UPageCard>
      </UPageColumns>
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
