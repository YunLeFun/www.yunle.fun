<script setup lang="ts">
const route = useRoute()

const items = computed(() => [
  {
    label: '文档',
    to: '/docs',
    active: route.path.startsWith('/docs'),
  },
  {
    label: '开发者',
    to: '/developer',
  },
  {
    label: '会员',
    to: '/pricing',
  },
  {
    label: '博客',
    to: '/blog',
  },
  {
    label: '日志',
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
      <UColorModeButton />
      <ClientOnly>
        <DeferredUserMenu />
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
        <DeferredUserMenu />
      </ClientOnly>
    </template>
  </UHeader>
</template>
