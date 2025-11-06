<script setup lang="ts">
const route = useRoute()

const items = computed(() => [
  {
    label: '文档',
    to: '/docs',
    active: route.path.startsWith('/docs')
  },
  {
    label: '会员',
    to: '/pricing'
  },
  {
    label: '博客',
    to: '/blog'
  },
  {
    label: '日志',
    to: '/changelog'
  }])
</script>

<template>
  <UHeader>
    <template #left>
      <div class="flex items-center justify-center gap-2">
        <NuxtLink to="/">
          <AppLogo class="w-auto h-6 shrink-0" />
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

      <UButton
        icon="i-lucide-log-in"
        color="neutral"
        variant="ghost"
        to="/login"
        class="lg:hidden"
      />

      <UButton
        label="登录"
        color="neutral"
        variant="outline"
        to="/login"
        class="hidden lg:inline-flex"
      />

      <UButton
        label="注册"
        color="neutral"
        trailing-icon="i-lucide-arrow-right"
        class="hidden lg:inline-flex"
        to="/signup"
      />
    </template>

    <template #body>
      <UNavigationMenu
        :items="items"
        orientation="vertical"
        class="-mx-2.5"
      />

      <USeparator class="my-6" />

      <UButton
        label="Sign in"
        color="neutral"
        variant="subtle"
        to="/login"
        block
        class="mb-3"
      />
      <UButton
        label="Sign up"
        color="neutral"
        to="/signup"
        block
      />
    </template>
  </UHeader>
</template>
