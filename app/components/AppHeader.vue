<script setup lang="ts">
import type { User } from '~/composables/auth/types'
import { ChevronRightIcon, MenuIcon } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import { shallowRef } from 'vue'
import { Button } from '@/components/ui/button'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '@/components/ui/navigation-menu'
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
// 只读登录态展示账号卡片；登录恢复由全局中间件负责
const user = useState<User | null>('auth_user', () => null)

// 抽屉只属于窄屏：窗口拉宽到桌面布局时自动收起，避免遮罩残留在 PC 页面上
const isDesktop = useMediaQuery('(min-width: 768px)')
watch(isDesktop, (desktop) => {
  if (desktop)
    mobileOpen.value = false
})

const items = computed(() => [
  {
    label: '帮助',
    hint: '使用指南与常见问题',
    icon: 'i-lucide-life-buoy',
    tone: 'var(--ylf-dopa-cyan)',
    to: '/docs',
    active: route.path.startsWith('/docs'),
  },
  {
    label: '会员',
    hint: '点亮所有应用的晴空',
    icon: 'i-lucide-crown',
    tone: 'var(--ylf-dopa-pink)',
    to: '/pricing',
    active: route.path.startsWith('/pricing'),
  },
  {
    label: '博客',
    hint: '幕后故事与创作手记',
    icon: 'i-lucide-pen-line',
    tone: 'var(--ylf-dopa-amber)',
    to: '/blog',
    active: route.path.startsWith('/blog'),
  },
  {
    label: '日志',
    hint: '每一次更新都在这里',
    icon: 'i-lucide-history',
    tone: 'var(--ylf-dopa-green)',
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
          <SheetContent class="ylf-nav-drawer w-[min(22rem,88vw)] gap-0 overflow-x-hidden p-0" side="right">
            <!-- 晴空抬头：一朵小云在角落打招呼 -->
            <SheetHeader class="ylf-nav-drawer__sky">
              <CuteCloud shape="round" face mood="happy" class="ylf-nav-drawer__cloud" />
              <CuteCloud shape="small" class="ylf-nav-drawer__cloud ylf-nav-drawer__cloud--far" />
              <SheetTitle class="ylf-nav-drawer__title">
                主导航
              </SheetTitle>
              <SheetDescription class="ylf-nav-drawer__description">
                浏览云乐坊的主要页面和账号入口
              </SheetDescription>
            </SheetHeader>

            <div class="flex flex-1 flex-col gap-4 px-4 pt-4 pb-6">
              <NuxtLink
                v-if="user"
                to="/profile"
                class="ylf-nav-drawer__account ylf-nav-drawer__item"
                style="--i: 0"
                @click="mobileOpen = false"
              >
                <MemberAvatar
                  :src="user.avatar"
                  :alt="user.nickname || user.login || '我'"
                  size="lg"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-foreground">{{ user.nickname || user.login || '我的账号' }}</span>
                  <span class="block truncate text-xs text-muted-foreground">个人中心 · 钱包 · 设置</span>
                </span>
                <ChevronRightIcon class="ylf-nav-drawer__chevron" aria-hidden="true" />
              </NuxtLink>

              <nav class="flex flex-col gap-1" aria-label="移动端主导航">
                <NuxtLink
                  v-for="(item, index) in items"
                  :key="item.to"
                  :to="item.to"
                  class="ylf-header__link ylf-header__link--mobile ylf-nav-drawer__item"
                  :style="{ '--i': index + 1, '--tile': item.tone }"
                  :data-active="item.active ? '' : undefined"
                  :aria-current="item.active ? 'page' : undefined"
                  @click="mobileOpen = false"
                >
                  <span class="ylf-dopa-tile ylf-nav-drawer__icon" aria-hidden="true">
                    <Icon :name="item.icon" class="size-[1.125rem]" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block">{{ item.label }}</span>
                    <span class="ylf-nav-drawer__hint">{{ item.hint }}</span>
                  </span>
                  <ChevronRightIcon class="ylf-nav-drawer__chevron" aria-hidden="true" />
                </NuxtLink>
              </nav>

              <div class="ylf-nav-drawer__footer ylf-nav-drawer__item" :style="{ '--i': items.length + 1 }">
                <span class="text-xs text-muted-foreground">{{ user ? '通知与账号' : '登录后同步你的晴空' }}</span>
                <div class="flex items-center justify-end gap-1.5">
                  <ClientOnly>
                    <HeaderAuthArea guest-presentation="labeled" />

                    <template #fallback>
                      <HeaderAuthSkeleton />
                    </template>
                  </ClientOnly>
                </div>
              </div>
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

.ylf-header__link--mobile {
  gap: 0.75rem;
  min-height: 3.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--ylf-radius);
  color: var(--ylf-c-text);
  font-size: 0.9375rem;
  white-space: normal;
}

.ylf-header__link--mobile[data-active] {
  background: var(--ylf-c-brand-soft);
  color: var(--ylf-c-brand);
}

/* 当前页：左侧一道晴空蓝短条 */
.ylf-header__link--mobile[data-active]::before {
  position: absolute;
  top: 50%;
  left: 0;
  width: 3px;
  height: 1.25rem;
  border-radius: var(--ylf-radius-pill);
  background: currentColor;
  content: '';
  translate: 0 -50%;
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

<!-- 抽屉通过 Portal 渲染到 body，其外框样式不受 scoped 约束，这里用不带作用域的类名维护。 -->
<style>
/* 从右侧整屏滑入并软着陆；收起时干脆利落地滑走。 */
.ylf-nav-drawer[data-state='open'] {
  animation: ylf-nav-drawer-in 620ms var(--ylf-ease-spring);
}

.ylf-nav-drawer[data-state='closed'] {
  animation: ylf-nav-drawer-out 220ms cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes ylf-nav-drawer-in {
  from {
    translate: 100% 0;
  }
}

@keyframes ylf-nav-drawer-out {
  to {
    translate: 100% 0;
  }
}

.ylf-nav-drawer [data-slot='sheet-close'] {
  z-index: 2;
  color: #fff;
}

.ylf-nav-drawer [data-slot='sheet-close']:hover {
  background: rgb(255 255 255 / 18%);
  color: #fff;
}

.ylf-nav-drawer__sky {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  gap: 0.25rem;
  padding: 1.5rem 3.75rem 1.75rem 1.25rem;
  background: linear-gradient(170deg, #2f82e0 0%, #5aa6ea 45%, #9fd2f5 82%, #dceefb 100%);
}

.dark .ylf-nav-drawer__sky {
  background: linear-gradient(170deg, #33386f 0%, #6a5d9c 40%, #c77fa6 78%, #f2a07f 100%);
}

/* 抬头底部压一层淡色，让白字在最亮处也清晰 */
.ylf-nav-drawer__sky::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  background: linear-gradient(100deg, rgb(8 32 74 / 38%), transparent 70%);
  content: '';
}

.ylf-nav-drawer__title {
  color: #fff;
  font-size: 1.25rem;
  text-shadow: 0 1px 10px rgb(0 40 90 / 35%);
}

.ylf-nav-drawer__description {
  color: rgb(255 255 255 / 88%);
  text-shadow: 0 1px 8px rgb(0 40 90 / 30%);
}

.ylf-nav-drawer__cloud {
  position: absolute;
  z-index: -1;
  right: 0.75rem;
  bottom: -0.75rem;
  width: 5.5rem;
  animation: ylf-bob 5s ease-in-out infinite;
  filter: drop-shadow(0 6px 8px rgb(30 80 150 / 22%));
}

.ylf-nav-drawer__cloud--far {
  right: auto;
  bottom: auto;
  top: 0.5rem;
  left: 55%;
  width: 3rem;
  opacity: 0.6;
  animation-duration: 7s;
  animation-delay: -2s;
}

/* 各入口依次从右侧滑入，节奏略晚于抽屉本身 */
.ylf-nav-drawer__item {
  animation: ylf-nav-item-in 640ms var(--ylf-ease-spring) calc(140ms + var(--i, 0) * 50ms) backwards;
}

@keyframes ylf-nav-item-in {
  from {
    opacity: 0;
    translate: 28px 0;
  }
}

.ylf-nav-drawer__account {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--ylf-c-brand) 18%, var(--ylf-c-border));
  border-radius: var(--ylf-radius-lg);
  padding: 0.75rem;
  background: linear-gradient(
    120deg,
    color-mix(in srgb, var(--ylf-c-brand) 8%, var(--ylf-c-surface)),
    var(--ylf-c-surface)
  );
  transition:
    border-color var(--ylf-duration-fast) var(--ylf-ease-standard),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.ylf-nav-drawer__account:hover {
  border-color: color-mix(in srgb, var(--ylf-c-brand) 36%, var(--ylf-c-border));
}

.ylf-nav-drawer__account:active,
.ylf-header__link--mobile.ylf-nav-drawer__item:active {
  scale: var(--ylf-press-scale);
  transition-duration: var(--ylf-duration-press);
}

.ylf-nav-drawer__account:focus-visible {
  outline: 2px solid var(--ylf-c-brand);
  outline-offset: 2px;
}

.ylf-nav-drawer__icon {
  display: inline-flex;
  width: 2.25rem;
  height: 2.25rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 0.7rem;
  transition:
    rotate var(--ylf-duration-slow) var(--ylf-ease-spring),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.ylf-nav-drawer__item:hover .ylf-nav-drawer__icon {
  rotate: -8deg;
  scale: 1.06;
}

.ylf-nav-drawer__hint {
  display: block;
  overflow: hidden;
  color: var(--ylf-c-text-3);
  font-size: 0.75rem;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ylf-nav-drawer__chevron {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  color: var(--ylf-c-text-3);
  opacity: 0.6;
  transition:
    translate var(--ylf-duration-slow) var(--ylf-ease-spring),
    opacity var(--ylf-duration-fast) var(--ylf-ease-standard);
}

.ylf-nav-drawer__item:hover .ylf-nav-drawer__chevron {
  opacity: 1;
  translate: 3px 0;
}

.ylf-nav-drawer__footer {
  display: flex;
  min-height: 3.5rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: auto;
  border-radius: var(--ylf-radius-lg);
  padding: 0.5rem 0.5rem 0.5rem 1rem;
  background: var(--ylf-c-bg-soft);
}

@media (prefers-reduced-motion: reduce) {
  .ylf-nav-drawer[data-state='open'],
  .ylf-nav-drawer__item,
  .ylf-nav-drawer__cloud {
    animation: none;
  }

  .ylf-nav-drawer[data-state='closed'] {
    animation: ylf-nav-drawer-fade 120ms linear forwards;
  }

  .ylf-nav-drawer__item:hover .ylf-nav-drawer__icon,
  .ylf-nav-drawer__item:hover .ylf-nav-drawer__chevron {
    rotate: none;
    scale: none;
    translate: none;
  }
}

@keyframes ylf-nav-drawer-fade {
  to {
    opacity: 0;
  }
}
</style>
