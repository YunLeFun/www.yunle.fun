<script setup lang="ts">
import { homePage as page } from '~/config'

const title = page.seo.title || page.title
const description = page.seo.description || page.description

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

// 晴空 hero：跟随明暗模式
const colorMode = useColorMode()
const skyTheme = computed(() => (colorMode.value === 'dark' ? 'dark' : 'light'))
const heroLinks = page.hero.links
</script>

<template>
  <div>
    <!-- 晴空 Hero（天气之子） -->
    <section class="ylf-home-hero relative isolate overflow-hidden">
      <SkyScene :theme="skyTheme" :sun="false" class="pointer-events-none" />
      <div class="ylf-home-hero__scrim pointer-events-none absolute inset-0 z-[1]" aria-hidden="true" />
      <div class="ylf-home-hero__fade pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-28" aria-hidden="true" />
      <UContainer class="relative z-[2] py-20 sm:py-28 lg:py-32">
        <div class="max-w-2xl">
          <span class="ylf-glass ylf-hero-shadow inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white">
            {{ page.headline }}
          </span>
          <h1 class="ylf-dreamy-display ylf-hero-shadow mt-5 text-4xl leading-[1.15] text-white sm:text-5xl lg:text-6xl">
            <MDC :value="page.title" unwrap="p" />
          </h1>
          <p class="ylf-hero-shadow mt-5 max-w-xl text-base/relaxed text-white/90 sm:text-lg/relaxed">
            {{ page.description }}
          </p>
          <div class="mt-8 flex flex-wrap items-center gap-3">
            <UButton
              :to="heroLinks[0].to"
              :target="heroLinks[0].target"
              :label="heroLinks[0].label"
              :icon="heroLinks[0].icon"
              :trailing="heroLinks[0].trailing"
              size="xl"
              class="ylf-brand-btn"
            />
            <UButton
              :to="heroLinks[1].to"
              :target="heroLinks[1].target"
              :label="heroLinks[1].label"
              :icon="heroLinks[1].icon"
              size="xl"
              color="neutral"
              variant="solid"
              class="ylf-glass-btn"
            />
          </div>
          <div class="ylf-hero-shadow mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/85">
            <span class="inline-flex items-center gap-1.5"><UIcon name="i-ri:smartphone-line" class="size-4" />10+ 自研/社区应用</span>
            <span class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-refresh-cw" class="size-4" />登录即云同步</span>
            <span class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-layers" class="size-4" />一处账号 · 全应用通用</span>
          </div>
        </div>
      </UContainer>
    </section>

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
        :kind="index === 0 ? 'marketplace' : 'developer'"
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

<style scoped>
.ylf-home-hero__scrim {
  background: linear-gradient(
    100deg,
    rgba(8, 32, 74, 0.5) 0%,
    rgba(8, 32, 74, 0.24) 42%,
    rgba(8, 32, 74, 0.04) 66%,
    transparent 80%
  );
}

.ylf-home-hero__fade {
  background: linear-gradient(to bottom, transparent, var(--ui-bg));
}
</style>
