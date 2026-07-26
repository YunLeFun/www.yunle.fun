<script setup lang="ts">
const route = useRoute()

const items = computed(() => [
  {
    label: '帮助',
    to: '/docs',
    active: route.path.startsWith('/docs'),
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
        首页保持可预渲染；认证区域在服务端与客户端均预留相同最小尺寸，
        内容变宽时自然扩展且不参与 flex 压缩，避免控件溢出或互相遮挡。
      -->
      <div
        data-testid="header-auth-slot"
        class="flex min-w-24 shrink-0 items-center justify-end gap-1.5 lg:min-w-48"
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
