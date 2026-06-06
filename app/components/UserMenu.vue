<script setup lang="ts">
/**
 * 用户菜单组件
 * 显示用户头像和下拉菜单
 */
const { user, isAuthenticated, logout } = useTcbAuth()

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
  <div v-if="isAuthenticated && user">
    <UDropdownMenu
      :items="items"
      :content="{ align: 'end' }"
    >
      <UButton
        color="neutral"
        variant="ghost"
        class="gap-2"
      >
        <UAvatar
          :src="user.avatar || undefined"
          :alt="user.nickname || user.login || 'User'"
          size="xs"
        />
        <span class="hidden md:inline">
          {{ user.nickname || user.login }}
        </span>
      </UButton>

      <template #account="{ item }">
        <div class="flex items-center gap-3">
          <UAvatar
            :src="user.avatar || undefined"
            :alt="user.nickname || user.login || 'User'"
            size="md"
          />
          <div class="flex-1 min-w-0">
            <p class="font-medium truncate">
              {{ item.label }}
            </p>
            <p class="text-sm text-(--ui-text-muted) truncate">
              {{ user.email || user.phone || `@${user.login}` }}
            </p>
          </div>
        </div>
      </template>
    </UDropdownMenu>
  </div>

  <div v-else class="flex items-center gap-2">
    <UButton
      to="/login"
      label="登录"
      color="neutral"
      variant="outline"
      class="hidden lg:inline-flex"
    />
    <UButton
      to="/login"
      icon="i-ri-login-box-line"
      color="neutral"
      variant="ghost"
      class="lg:hidden"
    />
    <UButton
      label="注册"
      color="neutral"
      trailing-icon="i-lucide-arrow-right"
      class="hidden lg:inline-flex"
      to="/signup"
    />
  </div>
</template>
