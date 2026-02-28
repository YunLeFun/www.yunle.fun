<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()

const items = computed(() => [
  {
    label: t('nav.docs'),
    to: '/docs',
    active: route.path.startsWith('/docs'),
  },
  {
    label: t('nav.pricing'),
    to: '/pricing',
  },
  {
    label: t('nav.blog'),
    to: '/blog',
  },
  {
    label: t('nav.changelog'),
    to: '/changelog',
  },
])
</script>

<template>
  <UHeader>
    <template #left>
      <div class="flex gap-2 items-center justify-center">
        <NuxtLink to="/">
          <AppLogo class="shrink-0 h-6 w-auto" />
        </NuxtLink>
        <YlfSiteMenu />
      </div>
    </template>

    <UNavigationMenu
      :items="items"
      variant="link"
    />

    <template #right>
      <LanguageSwitcher />
      <UColorModeButton />
      <ClientOnly>
        <UserMenu />
      </ClientOnly>
    </template>

    <template #body>
      <UNavigationMenu
        :items="items"
        orientation="vertical"
        class="-mx-2.5"
      />

      <USeparator class="my-6" />

      <ClientOnly>
        <UserMenu />
      </ClientOnly>
    </template>
  </UHeader>
</template>
