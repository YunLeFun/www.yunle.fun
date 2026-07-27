<script setup lang="ts">
import {
  ArrowLeftIcon,
  EyeOffIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
} from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

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
  { label: '个人资料', short: '资料', value: 'profile', icon: UserIcon },
  { label: '隐私与通知', short: '隐私', value: 'privacy', icon: EyeOffIcon },
  { label: '安全设置', short: '安全', value: 'security', icon: ShieldIcon },
  { label: '账户管理', short: '账户', value: 'account', icon: SettingsIcon },
] as const

type SettingsTab = typeof tabs[number]['value']

function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && tabs.some(tab => tab.value === value)
}

const initialTab: SettingsTab = editProfileRequested.value
  ? 'profile'
  : isSettingsTab(route.query.tab) ? route.query.tab : 'profile'
const activeTab = ref<SettingsTab>(initialTab)

watch(activeTab, (val) => {
  router.replace({ query: val === 'profile' ? {} : { tab: val } })
})

// URL ?tab= → activeTab：支持深链与站内链接（如个人资料里跳「安全设置」）切换
watch(() => route.query.tab, (tab) => {
  const next = editProfileRequested.value
    ? 'profile'
    : isSettingsTab(tab) ? tab : 'profile'
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
  <main class="px-4 py-8 sm:px-6 sm:py-12">
    <div v-if="loading" class="flex justify-center py-20">
      <Spinner class="size-7 text-muted-foreground" />
    </div>

    <div
      v-else-if="user"
      class="mx-auto flex flex-col gap-6"
      :class="editProfileRequested ? 'max-w-4xl' : 'max-w-2xl'"
    >
      <!-- 页面标题 -->
      <div class="flex items-start gap-3">
        <Button
          as-child
          variant="ghost"
          size="icon-lg"
          class="mt-0.5 shrink-0"
        >
          <NuxtLink to="/profile" aria-label="返回个人中心">
            <ArrowLeftIcon />
          </NuxtLink>
        </Button>
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {{ editProfileRequested ? '编辑资料' : '设置' }}
          </h1>
          <p class="mt-1 text-sm leading-6 text-muted-foreground">
            {{ editProfileRequested ? '调整其他人看到的头像、昵称和个人介绍' : '管理个人资料、隐私和账户安全' }}
          </p>
        </div>
      </div>

      <SettingsProfileTab
        v-if="editProfileRequested"
        :start-editing="true"
        @edit-finished="clearProfileEditRequest"
      />

      <Tabs
        v-else
        v-model="activeTab"
        class="flex-col gap-6"
      >
        <!-- Tab 切换：移动端图标 + 短标签，桌面端全标签 -->
        <TabsList class="h-auto w-full">
          <TabsTrigger
            v-for="tab in tabs"
            :key="tab.value"
            :value="tab.value"
            :aria-label="tab.label"
            class="min-w-0 py-2 sm:px-3"
          >
            <component :is="tab.icon" data-icon="inline-start" aria-hidden="true" />
            <span class="sm:hidden">{{ tab.short }}</span>
            <span class="hidden sm:inline">{{ tab.label }}</span>
          </TabsTrigger>
        </TabsList>

        <!-- Tab 内容 -->
        <TabsContent value="profile">
          <SettingsProfileTab
            :start-editing="false"
            @edit-finished="clearProfileEditRequest"
          />
        </TabsContent>
        <TabsContent value="privacy">
          <SettingsPrivacyTab />
        </TabsContent>
        <TabsContent value="security">
          <SettingsSecurityTab />
        </TabsContent>
        <TabsContent value="account">
          <SettingsAccountTab />
        </TabsContent>
      </Tabs>
    </div>
  </main>
</template>
