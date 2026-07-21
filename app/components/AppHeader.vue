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
  <UHeader
    :menu="{
      title: '主导航',
      description: '浏览云乐坊的主要页面和账号入口',
    }"
  >
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
      <!--
        首页保持可预渲染；认证区域在服务端与客户端均预留相同尺寸，
        避免通知、头像和登录按钮切换时推动颜色模式与导航图标。
      -->
      <div
        data-testid="header-auth-slot"
        class="flex w-20 items-center justify-end gap-1.5 lg:w-40"
      >
        <ClientOnly>
          <HeaderAuthArea />

          <template #fallback>
            <HeaderAuthSkeleton />
          </template>
        </ClientOnly>
      </div>
    </template>

    <template #body>
      <UNavigationMenu
        :items="items"
        orientation="vertical"
        class="-mx-2.5"
      />

      <USeparator class="my-6" />

      <div class="flex w-full items-center justify-start gap-1.5">
        <ClientOnly>
          <HeaderAuthArea />

          <template #fallback>
            <HeaderAuthSkeleton />
          </template>
        </ClientOnly>
      </div>
    </template>
  </UHeader>
</template>
