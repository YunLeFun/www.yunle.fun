<script setup lang="ts">
import type { User } from '~/composables/auth/types'
import { Button } from '@/components/ui/button'
import { maskPhone } from '~/utils/mask'

type AccountPanelUser = Pick<User, 'id' | 'login' | 'email' | 'phone' | 'nickname' | 'avatar'>

const props = withDefaults(defineProps<{
  user: AccountPanelUser
  isMember?: boolean
  coinBalance?: number
  coinLoading?: boolean
  variant?: 'popover' | 'drawer'
}>(), {
  isMember: false,
  coinBalance: 0,
  coinLoading: false,
  variant: 'popover',
})

const emit = defineEmits<{
  close: []
  logout: []
}>()

const displayName = computed(() => props.user.nickname || props.user.login || '用户')
const secondaryIdentity = computed(() =>
  props.user.email
  || (props.user.phone ? maskPhone(props.user.phone) : '')
  || (props.user.login ? `@${props.user.login}` : ''),
)
</script>

<template>
  <section
    class="ylf-account-panel"
    :class="`ylf-account-panel--${variant}`"
    aria-label="账户快捷菜单"
    data-testid="user-account-panel"
  >
    <NuxtLink
      to="/profile"
      class="ylf-account-panel__identity group"
      data-testid="account-profile-link"
      @click="emit('close')"
    >
      <span class="ylf-account-panel__sky-glow" aria-hidden="true" />

      <MemberAvatar
        :src="user.avatar"
        :alt="displayName"
        size="xl"
        :is-member="isMember"
        ring-class="ring-(color:--ylf-surface)"
        class="relative z-1"
      />

      <span class="relative z-1 min-w-0 flex-1">
        <span class="flex items-center gap-2">
          <span class="truncate text-base font-semibold text-highlighted">
            {{ displayName }}
          </span>
          <MemberBadge v-if="isMember" size="xs" />
          <span v-else class="shrink-0 text-xs font-medium text-muted">
            普通用户
          </span>
        </span>
        <span v-if="secondaryIdentity" class="mt-0.5 block truncate text-sm text-muted">
          {{ secondaryIdentity }}
        </span>
      </span>

      <Icon
        name="i-lucide-chevron-right"
        class="relative z-1 size-4 shrink-0 text-dimmed transition-transform duration-150 group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </NuxtLink>

    <div class="grid grid-cols-2 gap-2.5 px-4 py-3.5" aria-label="账户快捷入口">
      <NuxtLink
        to="/wallet"
        class="ylf-account-panel__shortcut group"
        data-testid="account-wallet-link"
        :aria-label="coinLoading ? '我的云币，加载中' : `我的云币，${coinBalance} 云币`"
        @click="emit('close')"
      >
        <span class="ylf-account-panel__shortcut-icon ylf-account-panel__shortcut-icon--coin">
          <Icon name="i-lucide-coins" class="size-4.5" aria-hidden="true" />
        </span>
        <span class="flex min-w-0 flex-1 items-center gap-1 text-sm leading-none font-semibold text-highlighted">
          <AppSkeleton
            v-if="coinLoading"
            class="h-4 w-10 rounded"
            data-testid="account-coin-skeleton"
          />
          <template v-else>
            <span class="tabular-nums" data-testid="account-coin-balance">{{ coinBalance }}</span>
            <span>云币</span>
          </template>
        </span>
      </NuxtLink>

      <NuxtLink
        to="/apps"
        class="ylf-account-panel__shortcut group"
        data-testid="account-apps-link"
        @click="emit('close')"
      >
        <span class="ylf-account-panel__shortcut-icon ylf-account-panel__shortcut-icon--apps">
          <Icon name="i-lucide-layout-grid" class="size-4.5" aria-hidden="true" />
        </span>
        <span class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted">
          我的应用
        </span>
      </NuxtLink>
    </div>

    <div class="border-t border-default px-2 py-2">
      <NuxtLink
        to="/settings"
        class="ylf-account-panel__action group"
        data-testid="account-settings-link"
        @click="emit('close')"
      >
        <Icon name="i-lucide-settings" class="size-4.5" aria-hidden="true" />
        <span class="flex-1">账户设置</span>
        <Icon
          name="i-lucide-chevron-right"
          class="size-4 text-dimmed transition-transform duration-150 group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </NuxtLink>
    </div>

    <div class="border-t border-default px-2 py-2">
      <Button
        type="button"
        variant="ghost"
        class="ylf-account-panel__action ylf-account-panel__action--logout"
        data-testid="account-logout"
        @click="emit('logout')"
      >
        <Icon name="i-lucide-log-out" class="size-4.5" aria-hidden="true" />
        <span class="flex-1">退出登录</span>
      </Button>
    </div>
  </section>
</template>

<style scoped>
.ylf-account-panel {
  overflow: hidden;
  background: var(--ylf-surface);
  color: var(--ui-text);
}

.ylf-account-panel--popover {
  width: 21rem;
  border: 1px solid color-mix(in srgb, var(--ui-border) 86%, transparent);
  border-radius: 1.375rem;
  box-shadow:
    0 24px 64px -32px color-mix(in srgb, var(--ylf-account-panel-shadow) 58%, transparent),
    0 8px 24px -16px color-mix(in srgb, var(--ui-primary) 38%, transparent);
}

.ylf-account-panel--drawer {
  width: 100%;
  padding-bottom: env(safe-area-inset-bottom);
}

.ylf-account-panel__identity {
  position: relative;
  display: flex;
  min-height: 5.5rem;
  align-items: center;
  gap: 0.875rem;
  overflow: hidden;
  padding: 1rem;
  outline: none;
  background:
    radial-gradient(circle at 88% 10%, color-mix(in srgb, var(--ylf-dopa-cyan) 20%, transparent), transparent 43%),
    linear-gradient(145deg, color-mix(in srgb, var(--ui-primary) 9%, var(--ylf-surface)), var(--ylf-surface) 72%);
  transition: background-color 150ms ease;
}

.ylf-account-panel__identity:hover,
.ylf-account-panel__identity:focus-visible {
  background:
    radial-gradient(circle at 88% 10%, color-mix(in srgb, var(--ylf-dopa-cyan) 26%, transparent), transparent 45%),
    linear-gradient(145deg, color-mix(in srgb, var(--ui-primary) 13%, var(--ylf-surface)), var(--ylf-surface) 72%);
}

.ylf-account-panel__identity:focus-visible {
  box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--ui-primary) 32%, transparent);
}

.ylf-account-panel__sky-glow {
  position: absolute;
  top: -2.4rem;
  right: -1.8rem;
  width: 9rem;
  height: 6rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ylf-sso-cloud-top) 56%, transparent);
  filter: blur(18px);
  opacity: 0.68;
  pointer-events: none;
}

.ylf-account-panel__shortcut {
  display: flex;
  min-width: 0;
  min-height: 4rem;
  align-items: center;
  gap: 0.625rem;
  border: 1px solid transparent;
  border-radius: 1rem;
  padding: 0.75rem;
  background: color-mix(in srgb, var(--ylf-surface-muted) 84%, var(--ylf-surface));
  outline: none;
  transition:
    transform 150ms ease,
    border-color 150ms ease,
    background-color 150ms ease;
}

.ylf-account-panel__shortcut:hover,
.ylf-account-panel__shortcut:focus-visible {
  border-color: color-mix(in srgb, var(--ui-primary) 22%, transparent);
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ylf-surface));
  transform: translateY(-1px);
}

.ylf-account-panel__shortcut:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary) 20%, transparent);
}

.ylf-account-panel__shortcut-icon {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 0.75rem;
}

.ylf-account-panel__shortcut-icon--coin {
  color: var(--ylf-dopa-amber);
  background: color-mix(in srgb, var(--ylf-dopa-amber) 14%, var(--ylf-surface));
}

.ylf-account-panel__shortcut-icon--apps {
  color: var(--ylf-dopa-cyan);
  background: color-mix(in srgb, var(--ylf-dopa-cyan) 14%, var(--ylf-surface));
}

.ylf-account-panel__action {
  display: flex;
  width: 100%;
  min-height: 2.75rem;
  align-items: center;
  justify-content: flex-start;
  gap: 0.75rem;
  border-radius: 0.875rem;
  padding: 0.625rem 0.75rem;
  color: var(--ui-text-muted);
  font-size: 0.875rem;
  font-weight: 500;
  text-align: left;
  outline: none;
  transition:
    color 150ms ease,
    background-color 150ms ease;
}

.ylf-account-panel__action:hover,
.ylf-account-panel__action:focus-visible {
  color: var(--ui-text-highlighted);
  background: var(--ylf-surface-hover);
}

.ylf-account-panel__action:focus-visible {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--ui-primary) 30%, transparent);
}

.ylf-account-panel__action--logout:hover,
.ylf-account-panel__action--logout:focus-visible {
  color: var(--ui-error);
  background: color-mix(in srgb, var(--ui-error) 9%, var(--ylf-surface));
}

:global(.dark) .ylf-account-panel__identity {
  background:
    radial-gradient(circle at 86% 8%, color-mix(in srgb, var(--ylf-dopa-violet) 24%, transparent), transparent 44%),
    linear-gradient(145deg, color-mix(in srgb, var(--ui-primary) 14%, var(--ylf-surface)), var(--ylf-surface) 74%);
}

:global(.dark) .ylf-account-panel__identity:hover,
:global(.dark) .ylf-account-panel__identity:focus-visible {
  background:
    radial-gradient(circle at 86% 8%, color-mix(in srgb, var(--ylf-dopa-violet) 31%, transparent), transparent 46%),
    linear-gradient(145deg, color-mix(in srgb, var(--ui-primary) 18%, var(--ylf-surface)), var(--ylf-surface) 74%);
}

:global(.dark) .ylf-account-panel__sky-glow {
  background: color-mix(in srgb, var(--ylf-dopa-cyan) 30%, transparent);
  opacity: 0.52;
}

@media (prefers-reduced-motion: reduce) {
  .ylf-account-panel__identity,
  .ylf-account-panel__shortcut,
  .ylf-account-panel__action,
  .ylf-account-panel__identity :deep(svg),
  .ylf-account-panel__shortcut :deep(svg) {
    transition-duration: 0.01ms !important;
  }

  .ylf-account-panel__shortcut:hover,
  .ylf-account-panel__shortcut:focus-visible {
    transform: none;
  }
}
</style>
