<script setup lang="ts">
import * as locales from '@nuxt/ui/locale'

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
  titleTemplate: '%s - Nuxt SaaS template',
  ogImage: 'https://ui.nuxt.com/assets/templates/nuxt/saas-light.png',
  twitterImage: 'https://ui.nuxt.com/assets/templates/nuxt/saas-light.png',
  twitterCard: 'summary_large_image',
})

const { data: navigation } = await useAsyncData('navigation', () => queryCollectionNavigation('docs'), {
  transform: data => data.find(item => item.path === '/docs')?.children || [],
})
const { data: files } = useLazyAsyncData('search', () => queryCollectionSearchSections('docs'), {
  server: false,
})

const links = [{
  label: 'Docs',
  icon: 'i-lucide-book',
  to: '/docs/getting-started',
}, {
  label: 'Pricing',
  icon: 'i-lucide-credit-card',
  to: '/pricing',
}, {
  label: 'Blog',
  icon: 'i-lucide-pencil',
  to: '/blog',
}, {
  label: 'Changelog',
  icon: 'i-lucide-history',
  to: '/changelog',
}]

provide('navigation', navigation)

// Map locale codes to @nuxt/ui locale keys
const localeMap: Record<string, keyof typeof locales> = {
  'zh-CN': 'zh_cn',
  'en': 'en',
}

const uiLocale = computed(() => locales[localeMap[locale.value] || 'en'])
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
