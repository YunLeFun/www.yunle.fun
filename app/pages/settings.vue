<script setup lang="ts">
import {
  EyeOffIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
} from '@lucide/vue'
import { TabsIndicator } from 'reka-ui'
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
const { isActive: isMember } = useMembership()
const displayName = computed(() => user.value?.nickname || user.value?.login || '')
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

// 面板切换方向：切到右侧标签时内容从右侧滑入，反之从左侧滑入
const tabDirection = ref<1 | -1>(1)
const tabIndex = (value: SettingsTab) => tabs.findIndex(tab => tab.value === value)

watch(activeTab, (val, old) => {
  tabDirection.value = tabIndex(val) >= tabIndex(old) ? 1 : -1
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
  <div class="px-4 py-8 sm:px-6 sm:py-12">
    <div
      v-if="loading"
      class="mx-auto flex max-w-2xl flex-col gap-6"
      aria-busy="true"
      aria-label="正在加载设置"
    >
      <div class="ylf-shimmer h-[5.5rem] rounded-[var(--ylf-radius-xl)]" />
      <div class="ylf-shimmer h-11 rounded-xl" />
      <div class="ylf-shimmer h-72 rounded-[var(--ylf-radius-lg)]" />
    </div>

    <div
      v-else-if="user"
      class="mx-auto flex flex-col gap-6"
      :class="editProfileRequested ? 'max-w-4xl' : 'max-w-2xl'"
    >
      <!-- 页面标题：与个人中心同款的晴空横幅，缩成一条 -->
      <SubpageHero
        :title="editProfileRequested ? '编辑资料' : '设置'"
        :description="editProfileRequested ? '调整其他人看到的头像、昵称和个人介绍' : '管理个人资料、隐私和账户安全'"
      >
        <template #trailing>
          <MemberAvatar
            :src="user.avatar"
            :alt="displayName"
            size="xl"
            :is-member="isMember"
            ring-class="ring-white/60"
            class="max-sm:hidden"
          />
        </template>
      </SubpageHero>

      <SettingsProfileTab
        v-if="editProfileRequested"
        class="ylf-rise"
        style="--i: 1"
        :start-editing="true"
        @edit-finished="clearProfileEditRequest"
      />

      <Tabs
        v-else
        v-model="activeTab"
        class="settings-tabs flex-col gap-6"
        :style="{ '--settings-dir': tabDirection }"
      >
        <!-- Tab 切换：滑动的晴空药丸指示当前页；滚动时吸附在导航栏下方 -->
        <div class="settings-tabs__bar ylf-rise sticky top-16 z-20" style="--i: 1">
          <TabsList class="settings-tabs__list relative h-auto w-full rounded-xl p-1">
            <TabsIndicator class="settings-tabs__indicator" aria-hidden="true">
              <span class="settings-tabs__pill" />
            </TabsIndicator>
            <TabsTrigger
              v-for="tab in tabs"
              :key="tab.value"
              :value="tab.value"
              :aria-label="tab.label"
              class="settings-tabs__trigger relative z-[1] min-w-0 py-2 sm:px-3"
            >
              <component :is="tab.icon" data-icon="inline-start" aria-hidden="true" />
              <span class="sm:hidden">{{ tab.short }}</span>
              <span class="hidden sm:inline">{{ tab.label }}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <!-- Tab 内容 -->
        <TabsContent value="profile" class="settings-panel">
          <SettingsProfileTab
            :start-editing="false"
            @edit-finished="clearProfileEditRequest"
          />
        </TabsContent>
        <TabsContent value="privacy" class="settings-panel">
          <SettingsPrivacyTab />
        </TabsContent>
        <TabsContent value="security" class="settings-panel">
          <SettingsSecurityTab />
        </TabsContent>
        <TabsContent value="account" class="settings-panel">
          <SettingsAccountTab />
        </TabsContent>
      </Tabs>
    </div>
  </div>
</template>

<style scoped>
/* 吸附时用页面底色垫住标签栏上方，滚动的内容不会从导航栏与标签栏的缝隙里露出来 */
.settings-tabs__bar {
  margin-block: -0.5rem;
  padding-block: 0.5rem;
  background: linear-gradient(var(--ui-bg) 70%, transparent);
}

.settings-tabs__list {
  background: var(--ylf-glass-bg);
  -webkit-backdrop-filter: var(--ylf-glass-blur);
  backdrop-filter: var(--ylf-glass-blur);
  box-shadow:
    0 0 0 1px var(--ui-border-muted),
    0 12px 28px -22px color-mix(in srgb, #0b82c4 60%, transparent);
}

/* 滑动药丸：位置与宽度由 Reka 实时给出，用 spring 跟随，像云朵一样软着陆。 */
.settings-tabs__indicator {
  position: absolute;
  top: 50%;
  left: 0;
  width: var(--reka-tabs-indicator-size);
  height: var(--reka-tabs-indicator-thickness);
  translate: var(--reka-tabs-indicator-position) -50%;
  transition:
    translate var(--ylf-duration-slow) var(--ylf-ease-spring),
    width var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.settings-tabs__pill {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: calc(var(--radius) - 0.25rem);
  background: var(--ylf-surface);
  box-shadow:
    inset 0 1px 0 var(--ylf-glass-highlight),
    0 0 0 1px color-mix(in srgb, var(--ui-primary) 22%, transparent),
    0 6px 16px -8px color-mix(in srgb, var(--ui-primary) 55%, transparent);
}

.settings-tabs__trigger[data-state='active'] {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  color: var(--ui-primary);
}

.settings-tabs__trigger :deep(svg) {
  transition:
    rotate var(--ylf-duration-slow) var(--ylf-ease-spring),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.settings-tabs__trigger[data-state='active'] :deep(svg) {
  scale: 1.12;
}

.settings-tabs__trigger:hover:not([data-state='active']) :deep(svg) {
  rotate: -10deg;
}

/* 面板按切换方向横向滑入，内部卡片再依次浮起。 */
.settings-panel[data-state='active'] {
  animation: settings-panel-in 560ms var(--ylf-ease-spring);
}

@keyframes settings-panel-in {
  from {
    opacity: 0;
    translate: calc(var(--settings-dir, 1) * 28px) 0;
  }
  45% {
    opacity: 1;
  }
}

.settings-panel > :deep(* > *) {
  animation: ylf-rise 760ms var(--ylf-ease-spring) backwards;
}

.settings-panel > :deep(* > *:nth-child(2)) {
  animation-delay: 70ms;
}

.settings-panel > :deep(* > *:nth-child(3)) {
  animation-delay: 140ms;
}

.settings-panel > :deep(* > *:nth-child(n + 4)) {
  animation-delay: 210ms;
}

@media (prefers-reduced-motion: reduce) {
  .settings-tabs__indicator,
  .settings-tabs__trigger :deep(svg) {
    transition: none;
  }

  .settings-panel[data-state='active'],
  .settings-panel > :deep(* > *) {
    animation: none;
  }
}
</style>
