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
    active: route.path.startsWith('/pricing'),
  },
  {
    label: '博客',
    to: '/blog',
    active: route.path.startsWith('/blog'),
  },
  {
    label: '日志',
    to: '/changelog',
    active: route.path.startsWith('/changelog'),
  },
])
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-border/80 bg-[var(--ylf-glass-bg)] backdrop-filter-[var(--ylf-glass-blur)]">
    <span data-testid="menu-title" class="sr-only">主导航</span>
    <span data-testid="menu-description" class="sr-only">浏览云乐坊的主要页面和账号入口</span>

    <AppContainer class="flex h-16 items-center gap-3 md:gap-4">
      <div class="flex shrink-0 items-center gap-3">
        <NuxtLink to="/" class="inline-flex min-h-11 shrink-0 items-center" aria-label="云乐坊首页">
          <AppLogo class="h-6 w-auto shrink-0 sm:h-7 [&_svg]:h-full [&_svg]:w-auto" />
        </NuxtLink>
        <YlfSiteMenu />
      </div>

      <NavigationMenu :viewport="false" class="hidden flex-none md:flex" aria-label="主导航">
        <NavigationMenuList class="gap-2">
          <NavigationMenuItem v-for="item in items" :key="item.to">
            <NavigationMenuLink as-child :active="item.active" class="ylf-header__link ylf-header__link--desktop">
              <NuxtLink :to="item.to">
                {{ item.label }}
              </NuxtLink>
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>

      <div class="ylf-header__actions ml-auto flex items-center gap-1.5">
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
            <Button variant="ghost" size="icon-lg" class="md:hidden" aria-label="打开主导航">
              <MenuIcon class="size-5" />
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
                class="ylf-header__link ylf-header__link--mobile"
                :data-active="item.active ? '' : undefined"
                :aria-current="item.active ? 'page' : undefined"
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

<style scoped>
.ylf-header__link {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 2.75rem;
  padding: var(--ylf-space-2) var(--ylf-space-4);
  border-radius: var(--ylf-radius-sm);
  background: transparent;
  color: var(--ylf-c-text-2);
  font-family: var(--ylf-font-body);
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
  white-space: nowrap;
  transition:
    background-color var(--ylf-duration-fast) var(--ylf-ease-standard),
    color var(--ylf-duration-fast) var(--ylf-ease-standard);
}

.ylf-header__link--desktop {
  justify-content: center;
  min-width: 3.75rem;
}

.ylf-header__link:hover {
  background: var(--ylf-c-bg-soft);
  color: var(--ylf-c-text);
}

.ylf-header__link[data-active] {
  color: var(--ylf-c-brand);
}

.ylf-header__link--desktop[data-active]::after {
  position: absolute;
  bottom: 3px;
  left: calc(50% - 8px);
  width: 16px;
  height: 2px;
  border-radius: var(--ylf-radius-pill);
  background: currentColor;
  content: '';
}

.ylf-header__link--mobile[data-active] {
  background: var(--ylf-c-brand-soft);
}

/* Keep keyboard focus inside the hit area so adjacent states never touch. */
.ylf-header__link:focus-visible {
  outline: 2px solid var(--ylf-c-brand);
  outline-offset: -2px;
  box-shadow: none;
}

.ylf-header__actions :deep([data-slot='button']) {
  min-width: 2.75rem;
  min-height: 2.75rem;
  font-size: 0.9375rem;
}

.ylf-header__actions :deep([data-icon]) {
  width: 1.25rem;
  height: 1.25rem;
}
</style>
