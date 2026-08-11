<script setup lang="ts">
interface PageFeature {
  description?: string
  icon?: string
  name?: string
  title?: string
}

defineOptions({ inheritAttrs: false })

defineProps<{
  description?: string
  features?: PageFeature[]
  headline?: string
  orientation?: 'horizontal' | 'vertical'
  reverse?: boolean
  title?: string
}>()
</script>

<template>
  <section v-bind="$attrs" class="py-14 sm:py-20">
    <AppContainer class="flex flex-col gap-8">
      <header class="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
        <slot name="headline">
          <YlfEyebrow v-if="headline" :label="headline" />
        </slot>
        <h2 class="font-heading text-2xl font-semibold text-foreground sm:text-3xl">
          {{ title }}
        </h2>
        <p v-if="description" class="text-base leading-7 text-muted-foreground">
          {{ description }}
        </p>
      </header>

      <div v-if="features?.length" class="grid gap-5 md:grid-cols-3">
        <AppPageCard
          v-for="feature in features"
          :key="feature.name || feature.title"
          :title="feature.name || feature.title"
          :description="feature.description"
          :icon="feature.icon"
        />
      </div>
      <slot />
    </AppContainer>
  </section>
</template>
