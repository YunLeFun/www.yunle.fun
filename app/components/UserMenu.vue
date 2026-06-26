<script setup lang="ts">
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'
import { maskPhone } from '~/utils/mask'

/**
 * 用户菜单组件
 * 显示用户头像和下拉菜单
 */
const { user, authStatus, authReady, logout, checkAuthStatus } = useTcbAuthSession()
const { isActive: isMember, refresh: refreshMembership } = useMembership()

onMounted(async () => {
  // 公开路由下中间件不校验，这里兜底恢复登录态；authReady 已完成则跳过
  if (!authReady.value)
    await checkAuthStatus()
  // 会员状态用于头像角标；登录态已就绪时拉取一次（后续随用户变化自动刷新）
  if (user.value)
    refreshMembership()
})

const items = computed(() => [
  [{
    label: user.value?.nickname || user.value?.login || '用户',
    slot: 'account',
    type: 'label' as const,
  }],
  [{
    label: '个人中心',
    icon: 'i-lucide-user',
    to: '/profile',
  }, {
    label: '我的钱包',
    icon: 'i-lucide-wallet',
    to: '/wallet',
  }, {
    label: '我的应用',
    icon: 'i-lucide-layout-grid',
    to: '/apps',
  }, {
    label: '设置',
    icon: 'i-lucide-settings',
    to: '/settings',
  }],
  [{
    label: '退出登录',
    icon: 'i-lucide-log-out',
    onSelect: () => logout(),
  }],
])
</script>

<template>
  <div v-if="user">
    <UDropdownMenu
      :items="items"
      :content="{ align: 'end' }"
    >
      <UButton
        color="neutral"
        variant="ghost"
        class="gap-2"
      >
        <MemberAvatar
          :src="user.avatar"
          :alt="user.nickname || user.login || 'User'"
          size="xs"
          :is-member="isMember"
        />
        <span class="hidden md:inline">
          {{ user.nickname || user.login }}
        </span>
      </UButton>

      <template #account="{ item }">
        <div class="flex items-center gap-3">
          <MemberAvatar
            :src="user.avatar"
            :alt="user.nickname || user.login || 'User'"
            size="md"
            :is-member="isMember"
            ring-class="ring-(color:--ui-bg-elevated)"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <p class="font-medium truncate">
                {{ item.label }}
              </p>
              <MemberBadge v-if="isMember" size="xs" />
            </div>
            <p class="text-sm text-(--ui-text-muted) truncate">
              {{ user.email || (user.phone ? maskPhone(user.phone) : '') || `@${user.login}` }}
            </p>
          </div>
        </div>
      </template>
    </UDropdownMenu>
  </div>

  <UserMenuSkeleton v-else-if="authStatus === 'pending'" />

  <AuthActionButtons v-else />
</template>
