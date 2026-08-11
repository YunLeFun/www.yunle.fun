<script setup lang="ts">
const props = defineProps<{
  date?: string
  description?: string
  image?: string | { src?: string, alt?: string }
  title?: string
}>()

const imageSrc = computed(() => typeof props.image === 'string' ? props.image : props.image?.src)
</script>

<template>
  <article class="grid gap-5 border-b border-border pb-10 sm:grid-cols-[10rem_minmax(0,1fr)]">
    <time class="text-sm font-medium text-muted-foreground">{{ date }}</time>
    <div class="flex min-w-0 flex-col gap-3">
      <h2 class="font-heading text-2xl font-semibold text-foreground">
        {{ title }}
      </h2>
      <p v-if="description" class="leading-7 text-muted-foreground">
        {{ description }}
      </p>
      <img v-if="imageSrc" :src="imageSrc" :alt="typeof image === 'object' ? image.alt || title : title" class="rounded-2xl border border-border">
      <div class="prose prose-neutral max-w-none dark:prose-invert">
        <slot name="body" />
      </div>
    </div>
  </article>
</template>
