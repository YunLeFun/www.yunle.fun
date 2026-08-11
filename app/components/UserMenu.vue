<script setup lang="ts">
import type { FocusOutsideEvent, PointerDownOutsideEvent } from 'reka-ui'
import { useMediaQuery } from '@vueuse/core'
import { shallowRef, useTemplateRef } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'

/**
 * 用户菜单组件
 * 桌面端支持悬停预览与点击保持，移动端使用底部抽屉。
 */
const { user, authStatus, authReady, logout, checkAuthStatus } = useTcbAuthSession()
const coin = useCoin()
const route = useRoute()

const isDesktop = useMediaQuery('(min-width: 768px)')
const desktopTrigger = useTemplateRef<HTMLElement>('desktopTrigger')
const desktopOpen = shallowRef(false)
const desktopPinned = shallowRef(false)
const mobileOpen = shallowRef(false)
let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
let pinnedResetTimer: ReturnType<typeof setTimeout> | undefined

function clearOpenTimer() {
  if (openTimer)
    clearTimeout(openTimer)
  openTimer = undefined
}

function clearCloseTimer() {
  if (closeTimer)
    clearTimeout(closeTimer)
  closeTimer = undefined
}

function clearPinnedResetTimer() {
  if (pinnedResetTimer)
    clearTimeout(pinnedResetTimer)
  pinnedResetTimer = undefined
}

function scheduleDesktopOpen() {
  if (!isDesktop.value || desktopPinned.value)
    return
  clearCloseTimer()
  clearOpenTimer()
  openTimer = setTimeout(() => {
    desktopOpen.value = true
  }, 150)
}

function scheduleDesktopClose() {
  clearOpenTimer()
  if (!isDesktop.value || desktopPinned.value)
    return
  clearCloseTimer()
  closeTimer = setTimeout(() => {
    desktopOpen.value = false
  }, 250)
}

function keepDesktopOpen() {
  clearCloseTimer()
}

function keepTriggerInsidePopover(event: PointerDownOutsideEvent | FocusOutsideEvent) {
  const target = event.target
  if (target instanceof Node && desktopTrigger.value?.contains(target))
    event.preventDefault()
}

function toggleDesktopPinned() {
  clearOpenTimer()
  clearCloseTimer()
  clearPinnedResetTimer()
  if (desktopPinned.value) {
    desktopPinned.value = false
    desktopOpen.value = false
    return
  }
  desktopPinned.value = true
  desktopOpen.value = true
}

function closeSurfaces() {
  clearOpenTimer()
  clearCloseTimer()
  clearPinnedResetTimer()
  desktopPinned.value = false
  desktopOpen.value = false
  mobileOpen.value = false
}

async function handleLogout() {
  closeSurfaces()
  await logout()
}

onMounted(async () => {
  // 公开路由下中间件不校验，这里兜底恢复登录态；authReady 已完成则跳过
  if (!authReady.value)
    await checkAuthStatus()
  // 账户快照同时提供云币余额与会员状态；复用全局缓存，避免重复请求。
  if (user.value && !coin.account.value)
    void coin.refresh()
})

watch(desktopOpen, (open) => {
  clearPinnedResetTimer()
  if (!open) {
    // Popover 会在点击独立 reference 时先发出 outside-close，再派发按钮 click。
    // 延至下一宏任务清理固定态，让同一次点击仍能正确表达“关闭”。
    pinnedResetTimer = setTimeout(() => {
      if (!desktopOpen.value)
        desktopPinned.value = false
    }, 0)
  }
})

watch(isDesktop, () => {
  closeSurfaces()
})

watch(() => route.fullPath, () => {
  closeSurfaces()
})

onBeforeUnmount(() => {
  clearOpenTimer()
  clearCloseTimer()
  clearPinnedResetTimer()
})
</script>

<template>
  <div v-if="user" class="inline-flex">
    <Popover v-if="isDesktop" v-model:open="desktopOpen">
      <PopoverAnchor as-child>
        <div
          ref="desktopTrigger"
          class="inline-flex"
          data-testid="desktop-user-menu-anchor"
          @pointerenter="scheduleDesktopOpen"
          @pointerleave="scheduleDesktopClose"
        >
          <Button
            type="button"
            variant="ghost"
            class="ylf-user-menu-trigger"
            :class="{ 'ylf-user-menu-trigger--open': desktopOpen }"
            aria-label="打开账户菜单"
            aria-haspopup="dialog"
            :aria-expanded="desktopOpen"
            aria-controls="desktop-user-account-panel"
            data-testid="desktop-user-menu-trigger"
            @click="toggleDesktopPinned"
          >
            <MemberAvatar
              :src="user.avatar"
              :alt="user.nickname || user.login || 'User'"
              size="xs"
              :is-member="coin.isMember.value"
              class="ylf-user-menu-trigger__avatar"
            />
            <span class="hidden w-16 truncate text-sm lg:inline-block">
              {{ user.nickname || user.login }}
            </span>
            <Icon
              name="i-lucide-chevron-down"
              class="hidden text-dimmed transition-transform duration-150 lg:block"
              :class="{ 'rotate-180': desktopOpen }"
              aria-hidden="true"
            />
          </Button>
        </div>
      </PopoverAnchor>

      <PopoverContent
        v-if="desktopOpen"
        align="end"
        side="bottom"
        :side-offset="8"
        :collision-padding="12"
        class="w-auto border-0 bg-transparent p-0 shadow-none ring-0"
        @interact-outside="keepTriggerInsidePopover"
      >
        <div
          id="desktop-user-account-panel"
          @pointerenter="keepDesktopOpen"
          @pointerleave="scheduleDesktopClose"
        >
          <UserAccountPanel
            :user="user"
            :is-member="coin.isMember.value"
            :coin-balance="coin.balance.value"
            :coin-loading="coin.loading.value && !coin.account.value"
            @close="closeSurfaces"
            @logout="handleLogout"
          />
        </div>
      </PopoverContent>
    </Popover>

    <Sheet v-else v-model:open="mobileOpen">
      <SheetTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="ylf-user-menu-trigger ylf-user-menu-trigger--mobile"
          aria-label="打开账户菜单"
          aria-haspopup="dialog"
          :aria-expanded="mobileOpen"
          data-testid="mobile-user-menu-trigger"
          @click="mobileOpen = true"
        >
          <MemberAvatar
            :src="user.avatar"
            :alt="user.nickname || user.login || 'User'"
            size="xs"
            :is-member="coin.isMember.value"
            class="ylf-user-menu-trigger__avatar"
          />
        </Button>
      </SheetTrigger>

      <SheetContent
        v-if="mobileOpen"
        side="bottom"
        :show-close-button="false"
        class="overflow-hidden rounded-t-3xl bg-(--ylf-surface) p-0 ring-0"
      >
        <SheetHeader class="sr-only">
          <SheetTitle>账户快捷菜单</SheetTitle>
          <SheetDescription>查看账户信息与常用入口</SheetDescription>
        </SheetHeader>
        <UserAccountPanel
          :user="user"
          :is-member="coin.isMember.value"
          :coin-balance="coin.balance.value"
          :coin-loading="coin.loading.value && !coin.account.value"
          variant="drawer"
          @close="closeSurfaces"
          @logout="handleLogout"
        />
      </SheetContent>
    </Sheet>
  </div>

  <UserMenuSkeleton v-else-if="authStatus === 'pending'" />

  <AuthActionButtons v-else />
</template>

<style scoped>
.ylf-user-menu-trigger {
  display: inline-flex;
  min-height: 2rem;
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.75rem;
  padding: 0.125rem 0.5rem;
  color: var(--ui-text-muted);
  outline: none;
  transition:
    color 150ms ease,
    background-color 150ms ease,
    box-shadow 150ms ease;
}

.ylf-user-menu-trigger:hover,
.ylf-user-menu-trigger:focus-visible,
.ylf-user-menu-trigger--open {
  color: var(--ui-text-highlighted);
  background: var(--ylf-surface-hover);
}

.ylf-user-menu-trigger:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary) 25%, transparent);
}

.ylf-user-menu-trigger--mobile {
  padding-inline: 0.25rem;
}

.ylf-user-menu-trigger__avatar {
  transition:
    transform 180ms ease,
    filter 180ms ease;
}

.ylf-user-menu-trigger:hover .ylf-user-menu-trigger__avatar,
.ylf-user-menu-trigger:focus-visible .ylf-user-menu-trigger__avatar,
.ylf-user-menu-trigger--open .ylf-user-menu-trigger__avatar {
  filter: drop-shadow(0 0 7px color-mix(in srgb, var(--ui-primary) 42%, transparent));
  transform: scale(1.08);
}

@media (prefers-reduced-motion: reduce) {
  .ylf-user-menu-trigger,
  .ylf-user-menu-trigger__avatar,
  .ylf-user-menu-trigger :deep(svg) {
    transition-duration: 0.01ms !important;
  }

  .ylf-user-menu-trigger:hover .ylf-user-menu-trigger__avatar,
  .ylf-user-menu-trigger:focus-visible .ylf-user-menu-trigger__avatar,
  .ylf-user-menu-trigger--open .ylf-user-menu-trigger__avatar {
    transform: none;
  }
}
</style>
