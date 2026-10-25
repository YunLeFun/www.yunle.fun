<script setup lang="ts">
import {
  ArrowLeftIcon,
  EyeOffIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
} from '@lucide/vue'
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
const activeTab = shallowRef<SettingsTab>(initialTab)
const isDesktop = useMediaQuery('(min-width: 768px)')

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
  <div class="settings-page px-4 py-6 sm:px-6 sm:py-10">
    <div v-if="loading" class="mx-auto flex max-w-5xl flex-col gap-6" aria-busy="true" aria-label="正在加载设置">
      <div class="ylf-shimmer h-48 rounded-[var(--ylf-radius-xl)]" />
      <div class="ylf-shimmer h-72 rounded-[var(--ylf-radius-lg)]" />
    </div>

    <div v-else-if="user && editProfileRequested" class="settings-editor mx-auto flex max-w-4xl flex-col gap-7">
      <NuxtLink to="/settings" class="settings-back">
        <ArrowLeftIcon class="size-4" aria-hidden="true" /> 返回设置
      </NuxtLink>
      <SettingsPageHeader title="编辑资料" description="调整其他人看到的头像、昵称和个人介绍" />
      <SettingsProfileTab :start-editing="true" @edit-finished="clearProfileEditRequest" />
    </div>

    <Tabs v-else-if="user" v-model="activeTab" class="settings-layout" :orientation="isDesktop ? 'vertical' : 'horizontal'">
      <aside class="settings-nav">
        <NuxtLink to="/profile" class="settings-back">
          <ArrowLeftIcon class="size-4" aria-hidden="true" /> 返回个人中心
        </NuxtLink>
        <h2 class="settings-nav__title">
          设置
        </h2>
        <p class="settings-nav__description">
          让这里，更像你的空间。
        </p>
        <TabsList class="settings-nav__list" aria-label="设置分类">
          <TabsTrigger v-for="tab in tabs" :key="tab.value" :value="tab.value" :aria-label="tab.label" class="settings-nav__tab">
            <component :is="tab.icon" class="size-4" aria-hidden="true" />
            <span class="md:hidden">{{ tab.short }}</span>
            <span class="hidden md:inline">{{ tab.label }}</span>
          </TabsTrigger>
        </TabsList>
        <p class="settings-nav__footer">
          你的云端小天地<br>资料、偏好与安全，都在这里。
        </p>
      </aside>
      <TabsContent value="profile" class="settings-panel">
        <SettingsPageHeader title="个人资料" description="让大家认识独一无二的你。" />
        <SettingsProfileTab :start-editing="false" @edit-finished="clearProfileEditRequest" />
      </TabsContent>
      <TabsContent value="privacy" class="settings-panel">
        <SettingsPageHeader title="隐私与通知" description="留一点空间，也不错。由你决定分享与接收。" />
        <SettingsPrivacyTab />
      </TabsContent>
      <TabsContent value="security" class="settings-panel">
        <SettingsSecurityTab />
      </TabsContent>
      <TabsContent value="account" class="settings-panel">
        <SettingsPageHeader title="账户管理" description="账户的每一步，都由你掌握。" />
        <SettingsAccountTab />
      </TabsContent>
    </Tabs>
  </div>
</template>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 11.25rem minmax(0, 1fr);
  gap: 2.625rem;
  max-width: 77rem;
  margin-inline: auto;
  align-items: start;
}
.settings-nav {
  position: sticky;
  top: 6rem;
}
.settings-back {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  font-size: 0.8125rem;
  color: var(--ylf-c-text-2);
}
.settings-back:hover {
  color: var(--ylf-c-brand);
}
.settings-nav__title {
  margin-top: 1.125rem;
  font: 700 1.5625rem/1.4 var(--ylf-font-heading);
}
.settings-nav__description {
  margin-top: 0.375rem;
  font-size: 0.75rem;
  color: var(--ylf-c-text-3);
}
.settings-nav__list {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.4375rem;
  width: 100%;
  height: auto;
  padding: 0;
  margin-top: 1.75rem;
  background: none;
  border-radius: 0;
}
.settings-nav__tab {
  justify-content: flex-start;
  gap: 0.75rem;
  width: 100%;
  min-height: 3rem;
  flex: none;
  border: 0;
  border-radius: var(--ylf-radius);
  padding: 0.75rem 0.9375rem;
  color: var(--ylf-c-text-2);
  box-shadow: none;
  font-size: 0.875rem;
}
.settings-nav__tab:hover {
  background: var(--ylf-c-bg-soft);
}
.settings-nav__tab[data-state='active'] {
  background: var(--ylf-c-brand-soft);
  color: var(--ylf-c-brand);
  box-shadow: none;
}
.settings-nav__tab[data-state='active']::after {
  content: '';
  position: static;
  opacity: 1;
  width: 0.3125rem;
  height: 0.3125rem;
  border-radius: 50%;
  margin-left: auto;
  background: currentColor;
}
.settings-nav__footer {
  border-top: 1px solid var(--ylf-c-border);
  margin: 2.25rem 0.875rem 0;
  padding-top: 1.25rem;
  color: var(--ylf-c-text-3);
  font-size: 0.75rem;
  line-height: 1.9;
}
.settings-panel {
  min-width: 0;
  margin: 0;
}
.settings-panel[data-state='active'] {
  display: flex;
  flex-direction: column;
  gap: 1.875rem;
  animation: settings-enter var(--ylf-duration-fast) var(--ylf-ease-standard);
}
.settings-panel :deep([data-slot='card']),
.settings-editor :deep([data-slot='card']) {
  border-color: var(--ylf-c-border);
  border-radius: var(--ylf-radius-lg);
  box-shadow: none;
}
.settings-page :deep([data-slot='button']) {
  min-height: 2.75rem;
  min-width: 2.75rem;
}
@keyframes settings-enter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 1100px) {
  .settings-layout {
    grid-template-columns: 10rem minmax(0, 1fr);
    gap: 1.75rem;
  }
}
@media (max-width: 767px) {
  .settings-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 1.25rem;
  }
  .settings-nav {
    position: static;
  }
  .settings-nav__title {
    margin-top: 0.5rem;
    font-size: 1.375rem;
  }
  .settings-nav__description,
  .settings-nav__footer {
    display: none;
  }
  .settings-nav__list {
    flex-direction: row;
    gap: 0.375rem;
    margin-top: 1rem;
  }
  .settings-nav__tab {
    width: auto;
    flex: 1;
    justify-content: center;
    padding: 0.625rem;
    min-height: 2.75rem;
    gap: 0.375rem;
  }
  .settings-nav__tab[data-state='active']::after {
    display: none;
  }
  .settings-panel[data-state='active'] {
    gap: 1.5rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .settings-panel[data-state='active'] {
    animation: none;
  }
  .settings-page :deep(*) {
    transition-duration: 0.01ms !important;
  }
}
</style>
