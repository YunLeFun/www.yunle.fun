<script setup lang="ts">
definePageMeta({
  layout: 'default',
})

useSeoMeta({
  title: '设置 - YunLeFun',
  description: '管理您的账户设置',
})

const { user, isAuthenticated, loading } = useTcbAuth()
const router = useRouter()

watch(isAuthenticated, (value) => {
  if (!value) {
    router.push('/login')
  }
}, { immediate: true })

// Tab 切换
const route = useRoute()
const tabs = [
  { label: '个人资料', value: 'profile', icon: 'i-lucide-user' },
  { label: '安全设置', value: 'security', icon: 'i-lucide-shield' },
  { label: '账户管理', value: 'account', icon: 'i-lucide-settings' },
]

const initialTab = typeof route.hash === 'string' && tabs.some(t => t.value === route.hash.replace('#', ''))
  ? route.hash.replace('#', '')
  : 'profile'
const activeTab = ref(initialTab)

watch(activeTab, (val) => {
  router.replace({ hash: val === 'profile' ? '' : `#${val}` })
})
</script>

<template>
  <UContainer class="py-12">
    <div v-if="loading" class="flex justify-center py-20">
      <UIcon
        name="i-lucide-loader-2"
        class="text-3xl text-muted animate-spin"
      />
    </div>

    <div v-else-if="user" class="max-w-2xl mx-auto space-y-6">
      <!-- 页面标题 -->
      <div class="flex items-center gap-3">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/profile"
        />
        <h1 class="text-2xl font-bold">
          设置
        </h1>
      </div>

      <!-- Tab 切换 -->
      <div class="flex gap-1 rounded-lg bg-elevated p-1">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="flex items-center gap-2 flex-1 justify-center py-2 px-3 text-sm font-medium rounded-md transition-all"
          :class="activeTab === tab.value
            ? 'bg-default text-default shadow-sm'
            : 'text-muted hover:text-default'"
          @click="activeTab = tab.value"
        >
          <UIcon :name="tab.icon" class="text-base" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Tab 内容 -->
      <SettingsProfileTab v-if="activeTab === 'profile'" />
      <SettingsSecurityTab v-else-if="activeTab === 'security'" />
      <SettingsAccountTab v-else-if="activeTab === 'account'" />
    </div>
  </UContainer>
</template>
