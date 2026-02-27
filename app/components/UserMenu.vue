<script setup lang="ts">
/**
 * 用户菜单组件
 * 显示用户头像和下拉菜单
 */
const { t } = useI18n()
const { user, isAuthenticated, logout } = useTcbAuth()

const items = computed(() => [
  [{
    label: user.value?.nickname || user.value?.login || '用户',
    slot: 'account',
    type: 'label' as const,
  }],
  [{
    label: t('user.profile'),
    icon: 'i-lucide-user',
    to: '/profile',
  }, {
    label: t('user.myApps'),
    icon: 'i-lucide-layout-grid',
    to: '/apps',
  }, {
    label: t('user.settings'),
    icon: 'i-lucide-settings',
    to: '/settings',
  }],
  [{
    label: t('auth.logout'),
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
      :label="t('nav.login')"
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
      :label="t('nav.signup')"
      color="neutral"
      trailing-icon="i-lucide-arrow-right"
      class="hidden lg:inline-flex"
      to="/signup"
    />
  </div>
</template>
