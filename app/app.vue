<script setup lang="ts">
import { en, zh_cn } from '@nuxt/ui/locale'

const colorMode = useColorMode()
const { locale } = useI18n()

const color = computed(() => colorMode.value === 'dark' ? '#020618' : 'white')

useHead({
  meta: [
    { charset: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'theme-color', name: 'theme-color', content: color },
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' },
  ],
  htmlAttrs: {
    lang: locale,
  },
})

useSeoMeta({
  titleTemplate: '%s - 云乐坊',
  ogImage: 'https://ui.nuxt.com/assets/templates/nuxt/saas-light.png',
  twitterImage: 'https://ui.nuxt.com/assets/templates/nuxt/saas-light.png',
  twitterCard: 'summary_large_image',
})

const { navigation, files, links } = useNavigation()
provide('navigation', navigation)

// Map locale codes to @nuxt/ui locale objects
const localeMap = { 'zh-CN': zh_cn, 'en': en } as const

const uiLocale = computed(() => localeMap[locale.value as keyof typeof localeMap] || en)
</script>

<template>
  <UApp :locale="uiLocale">
    <NuxtLoadingIndicator />

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <ClientOnly>
      <LazyUContentSearch
        :files="files"
        shortcut="meta_k"
        :navigation="navigation"
        :links="links"
        :fuse="{ resultLimit: 42 }"
      />
    </ClientOnly>
  </UApp>
</template>
