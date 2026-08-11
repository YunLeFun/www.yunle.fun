<script setup lang="ts">
import { MenuIcon } from '@lucide/vue'
import { shallowRef } from 'vue'
import { Button } from '@/components/ui/button'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '@/components/ui/navigation-menu'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

const route = useRoute()
const mobileOpen = shallowRef(false)

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
  <header class="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-xl">
    <span data-testid="menu-title" class="sr-only">主导航</span>
    <span data-testid="menu-description" class="sr-only">浏览云乐坊的主要页面和账号入口</span>

    <AppContainer class="flex h-16 items-center gap-4">
      <div class="flex gap-2 items-center justify-center">
        <NuxtLink to="/" aria-label="云乐坊首页">
          <AppLogo class="shrink-0 h-6 w-auto" />
        </NuxtLink>
        <YlfSiteMenu />
      </div>

      <NavigationMenu :viewport="false" class="hidden md:flex">
        <NavigationMenuList>
          <NavigationMenuItem v-for="item in items" :key="item.to">
            <NavigationMenuLink as-child :active="item.active">
              <NuxtLink :to="item.to">
                {{ item.label }}
              </NuxtLink>
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>

      <div class="ml-auto flex items-center gap-1.5">
        <AppColorModeButton />
        <!--
        首页保持可预渲染；认证区域在服务端与客户端均预留相同最小尺寸，
        内容变宽时自然扩展且不参与 flex 压缩，避免控件溢出或互相遮挡。
      -->
        <div
          data-testid="header-auth-slot"
          class="hidden min-w-24 shrink-0 items-center justify-end gap-1.5 md:flex lg:min-w-48"
        >
          <ClientOnly>
            <HeaderAuthArea />

            <template #fallback>
              <HeaderAuthSkeleton />
            </template>
          </ClientOnly>
        </div>

        <Sheet v-model:open="mobileOpen">
          <SheetTrigger as-child>
            <Button variant="ghost" size="icon" class="md:hidden" aria-label="打开主导航">
              <MenuIcon />
            </Button>
          </SheetTrigger>
          <SheetContent class="w-[min(22rem,90vw)]" side="right">
            <SheetHeader>
              <SheetTitle>主导航</SheetTitle>
              <SheetDescription>浏览云乐坊的主要页面和账号入口</SheetDescription>
            </SheetHeader>

            <nav class="flex flex-col gap-1 px-4" aria-label="移动端主导航">
              <NuxtLink
                v-for="item in items"
                :key="item.to"
                :to="item.to"
                class="rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                :class="item.active ? 'bg-muted text-foreground' : undefined"
                @click="mobileOpen = false"
              >
                {{ item.label }}
              </NuxtLink>
            </nav>

            <Separator class="mx-4 w-auto" />

            <div class="flex w-full items-center justify-start gap-1.5 px-4">
              <ClientOnly>
                <HeaderAuthArea guest-presentation="labeled" />

                <template #fallback>
                  <HeaderAuthSkeleton />
                </template>
              </ClientOnly>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </AppContainer>
  </header>
</template>
