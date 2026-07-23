<script setup lang="ts">
definePageMeta({
  layout: 'default',
})

const route = useRoute()
const editProfileRequested = computed(() => route.query.edit === 'profile')

useSeoMeta({
  title: computed(() => editProfileRequested.value ? '编辑资料 - YunLeFun' : '设置 - YunLeFun'),
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
const tabs = [
  { label: '个人资料', short: '资料', value: 'profile', icon: 'i-lucide-user' },
  { label: '隐私与通知', short: '隐私', value: 'privacy', icon: 'i-lucide-eye-off' },
  { label: '安全设置', short: '安全', value: 'security', icon: 'i-lucide-shield' },
  { label: '账户管理', short: '账户', value: 'account', icon: 'i-lucide-settings' },
]

const tabParam = (route.query.tab as string) || ''
const initialTab = editProfileRequested.value
  ? 'profile'
  : tabs.some(t => t.value === tabParam) ? tabParam : 'profile'
const activeTab = ref(initialTab)

watch(activeTab, (val) => {
  router.replace({ query: val === 'profile' ? {} : { tab: val } })
})

// URL ?tab= → activeTab：支持深链与站内链接（如个人资料里跳「安全设置」）切换
watch(() => route.query.tab, (tab) => {
  const next = editProfileRequested.value
    ? 'profile'
    : typeof tab === 'string' && tabs.some(t => t.value === tab) ? tab : 'profile'
  if (next !== activeTab.value)
    activeTab.value = next
})

function clearProfileEditRequest() {
  if (!editProfileRequested.value)
    return

  const query = { ...route.query }
  delete query.edit
  router.replace({ query })
}
</script>

<template>
  <UContainer class="py-8 sm:py-12">
    <div v-if="loading" class="flex justify-center py-20">
      <UIcon
        name="i-lucide-loader-2"
        class="text-3xl text-muted animate-spin"
      />
    </div>

    <div
      v-else-if="user"
      class="mx-auto space-y-6"
      :class="editProfileRequested ? 'max-w-4xl' : 'max-w-2xl'"
    >
      <!-- 页面标题 -->
      <div class="flex items-start gap-3">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="lg"
          to="/profile"
          aria-label="返回个人中心"
          class="mt-0.5 shrink-0"
        />
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
            {{ editProfileRequested ? '编辑资料' : '设置' }}
          </h1>
          <p class="mt-1 text-sm leading-6 text-muted">
            {{ editProfileRequested ? '调整其他人看到的头像、昵称和个人介绍' : '管理个人资料、隐私和账户安全' }}
          </p>
        </div>
      </div>

      <!-- Tab 切换：移动端图标 + 短标签，桌面端全标签 -->
      <div
        v-if="!editProfileRequested"
        class="flex gap-1 rounded-xl border border-muted bg-elevated/70 p-1"
      >
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
      <SettingsProfileTab
        v-if="activeTab === 'profile'"
        :start-editing="editProfileRequested"
        @edit-finished="clearProfileEditRequest"
      />
      <SettingsPrivacyTab v-else-if="activeTab === 'privacy'" />
      <SettingsSecurityTab v-else-if="activeTab === 'security'" />
      <SettingsAccountTab v-else-if="activeTab === 'account'" />
    </div>
  </UContainer>
</template>
