<script setup lang="ts">
const { data: page } = await useAsyncData('developer', () => queryCollection('developer').first())

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
        <MDC
          :value="page.title"
          unwrap="p"
        />
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
      v-for="(section, index) in page.sections"
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

      <MarketingPreview
        kind="developer"
        :index="index"
      />
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
          v-for="(item, index) in page.features.items"
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

    <UPageSection
      id="pricing"
      :headline="page.pricing.headline"
      :title="page.pricing.title"
      :description="page.pricing.description"
    >
      <UPageGrid
        :ui="{ base: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' }"
      >
        <UPageCard
          v-for="(plan, index) in page.pricing.items"
          :key="index"
          :title="plan.title"
          :description="plan.description"
          :class="plan.highlight ? 'ring-2 ring-primary' : ''"
          class="flex flex-col"
        >
          <template #header>
            <div class="flex gap-1 items-baseline">
              <span class="text-3xl font-bold">{{ plan.price }}</span>
              <span
                v-if="plan.period"
                class="text-muted"
              >{{ plan.period }}</span>
            </div>
          </template>

          <ul class="mb-6 flex-1 space-y-3">
            <li
              v-for="(feature, idx) in plan.features"
              :key="idx"
              class="flex gap-2 items-center"
            >
              <UIcon
                name="i-lucide-check"
                class="text-primary shrink-0"
              />
              <span class="text-sm">{{ feature }}</span>
            </li>
          </ul>

          <template #footer>
            <UButton
              v-bind="plan.cta"
              :color="plan.highlight ? 'primary' : 'neutral'"
              :variant="plan.highlight ? 'solid' : 'outline'"
              block
            />
          </template>
        </UPageCard>
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
