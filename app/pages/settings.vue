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
  { label: '个人资料', short: '资料', value: 'profile', icon: 'i-lucide-user' },
  { label: '隐私', short: '隐私', value: 'privacy', icon: 'i-lucide-eye-off' },
  { label: '安全设置', short: '安全', value: 'security', icon: 'i-lucide-shield' },
  { label: '账户管理', short: '账户', value: 'account', icon: 'i-lucide-settings' },
]

const tabParam = (route.query.tab as string) || ''
const initialTab = tabs.some(t => t.value === tabParam) ? tabParam : 'profile'
const activeTab = ref(initialTab)

watch(activeTab, (val) => {
  router.replace({ query: val === 'profile' ? {} : { tab: val } })
})

// URL ?tab= → activeTab：支持深链与站内链接（如个人资料里跳「安全设置」）切换
watch(() => route.query.tab, (tab) => {
  const next = typeof tab === 'string' && tabs.some(t => t.value === tab) ? tab : 'profile'
  if (next !== activeTab.value)
    activeTab.value = next
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

      <!-- Tab 切换：移动端图标 + 短标签，桌面端全标签 -->
      <div class="flex gap-1 rounded-lg bg-elevated p-1">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium transition-all sm:gap-2 sm:px-3"
          :class="activeTab === tab.value
            ? 'bg-default text-default shadow-sm'
            : 'text-muted hover:text-default'"
          @click="activeTab = tab.value"
        >
          <UIcon :name="tab.icon" class="shrink-0 text-base" />
          <span class="sm:hidden">{{ tab.short }}</span>
          <span class="hidden sm:inline">{{ tab.label }}</span>
        </button>
      </div>

      <!-- Tab 内容 -->
      <SettingsProfileTab v-if="activeTab === 'profile'" />
      <SettingsPrivacyTab v-else-if="activeTab === 'privacy'" />
      <SettingsSecurityTab v-else-if="activeTab === 'security'" />
      <SettingsAccountTab v-else-if="activeTab === 'account'" />
    </div>
  </UContainer>
</template>
