<script setup lang="ts">
import type { AppRecord } from '~/types/app'
import type { UserProfile } from '~/types/social'
import { isOfficialUser } from '~/config'

definePageMeta({
  layout: 'default',
})

useSeoMeta({
  title: '个人中心 - YunLeFun',
  description: '管理您的个人信息',
})

const { user, isAuthenticated, loading } = useTcbAuth()
const { getMyApps } = useApps()
const { isActive: isMember, state: membershipState, refresh: refreshMembership } = useMembership()
const { balance: coinBalance, refresh: refreshAccount } = useCoin()
const { getProfile } = useUserProfile()
const router = useRouter()

watch(isAuthenticated, (value) => {
  if (!value) {
    router.push('/login')
  }
}, { immediate: true })

const joinDate = computed(() => {
  if (!user.value?.createdAt)
    return ''
  return new Date(user.value.createdAt).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
})

const displayName = computed(() => user.value?.nickname || user.value?.login || '未设置')

// 开发者平台未上线，仅官方账号可自助发布应用
const canCreate = computed(() => isOfficialUser(user.value))

// 我的应用
const myApps = ref<AppRecord[]>([])
const appsLoading = ref(true)

// 我的公开资料（取关注 / 粉丝数）
const myProfile = ref<UserProfile | null>(null)

// 粉丝 / 关注列表弹窗
const showList = ref(false)
const listType = ref<'following' | 'followers'>('followers')
function openList(type: 'following' | 'followers') {
  listType.value = type
  showList.value = true
}

// 顶部数据条（点击直达 / 打开列表）
const stats = computed<Array<{ label: string, value: number, to?: string, onClick?: () => void }>>(() => [
  { label: '云币', value: coinBalance.value, to: '/wallet' },
  { label: '应用', value: myApps.value.length, to: '/apps' },
  { label: '关注', value: myProfile.value?.followingCount ?? 0, onClick: () => openList('following') },
  { label: '粉丝', value: myProfile.value?.followersCount ?? 0, onClick: () => openList('followers') },
])

// 快捷入口宫格
const entries = computed(() => {
  const list = [
    { label: '关注动态', icon: 'i-lucide-rss', to: '/feed', color: 'var(--ylf-dopa-amber)' },
    { label: '我的钱包', icon: 'i-lucide-wallet', to: '/wallet', color: 'var(--ylf-dopa-cyan)' },
    { label: '我的应用', icon: 'i-lucide-layout-grid', to: '/apps', color: 'var(--ylf-dopa-violet)' },
    { label: '账户设置', icon: 'i-lucide-settings', to: '/settings', color: 'var(--ylf-dopa-blue)' },
    { label: '安全设置', icon: 'i-lucide-lock', to: '/settings?tab=security', color: 'var(--ylf-dopa-green)' },
  ]
  // 有用户名才有公开主页地址
  if (user.value?.login)
    list.unshift({ label: '我的主页', icon: 'i-lucide-id-card', to: `/u/${user.value.login}`, color: 'var(--ylf-dopa-pink)' })
  return list
})

onMounted(async () => {
  // profile 挂载时 user 通常已登录，会员/账户 composable 的 watch（immediate:false）不会自动触发，需手动刷新
  refreshMembership()
  refreshAccount()
  try {
    const [apps, profile] = await Promise.all([
      getMyApps(),
      user.value ? getProfile({ userId: user.value.id }) : Promise.resolve(null),
    ])
    myApps.value = apps
    myProfile.value = profile
  }
  catch (err) {
    console.error('加载个人数据失败:', err)
  }
  finally {
    appsLoading.value = false
  }
})

function formatAppDate(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <UContainer class="py-8 sm:py-10">
    <div v-if="loading" class="flex justify-center py-20">
      <UIcon
        name="i-lucide-loader-2"
        class="animate-spin text-3xl text-muted"
      />
    </div>

    <div v-else-if="user" class="mx-auto max-w-3xl space-y-6">
      <!-- 晴空 hero：身份 + 数据条 -->
      <SkyHero>
        <div class="p-6 sm:p-8">
          <div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div class="flex items-center gap-4 sm:gap-5">
              <MemberAvatar
                :src="user.avatar"
                :alt="displayName"
                size="3xl"
                :is-member="isMember"
                ring-class="ring-white/60"
              />
              <div class="min-w-0 text-white">
                <h1 class="ylf-hero-shadow truncate text-2xl font-bold sm:text-3xl">
                  {{ displayName }}
                </h1>
                <p
                  v-if="user.login || user.description"
                  class="ylf-hero-shadow mt-0.5 line-clamp-1 text-sm text-white/85"
                >
                  <span v-if="user.login">@{{ user.login }}</span>
                  <span v-if="user.description">{{ user.login ? ' · ' : '' }}{{ user.description }}</span>
                </p>
                <div class="ylf-hero-shadow mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    v-if="user.role === 'ADMIN'"
                    class="ylf-glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-white"
                  >
                    <UIcon name="i-lucide-shield-check" class="size-3" />
                    管理员
                  </span>
                  <MemberBadge
                    v-if="isMember"
                    size="sm"
                    variant="frost"
                    :expire-at="membershipState?.expireAt ?? null"
                  />
                  <span v-else class="ylf-glass rounded-full px-2.5 py-1 font-medium text-white">
                    {{ joinDate }} 加入
                  </span>
                </div>
              </div>
            </div>
            <UButton
              to="/settings"
              label="编辑资料"
              icon="i-lucide-pencil"
              size="lg"
              class="ylf-glass-btn shrink-0 self-start rounded-full"
            />
          </div>

          <!-- 数据条（点击直达） -->
          <div class="ylf-glass-deep ylf-hero-shadow mt-6 flex items-stretch rounded-2xl px-2 py-2.5">
            <component
              :is="s.to ? 'NuxtLink' : 'button'"
              v-for="(s, i) in stats"
              :key="s.label"
              :to="s.to"
              :type="s.to ? undefined : 'button'"
              class="flex flex-1 flex-col items-center gap-0.5 py-1 text-white transition-transform hover:-translate-y-0.5"
              :class="i > 0 ? 'border-l border-white/25' : ''"
              @click="s.onClick?.()"
            >
              <span class="text-xl font-semibold leading-none tabular-nums">{{ s.value }}</span>
              <span class="text-xs text-white/90">{{ s.label }}</span>
            </component>
          </div>
        </div>
      </SkyHero>

      <!-- 未开通会员引导 -->
      <NuxtLink
        v-if="!isMember"
        to="/pricing"
        class="ylf-join-cta group flex items-center justify-between gap-3 rounded-3xl px-5 py-4 text-white sm:px-6"
      >
        <span class="flex items-center gap-3">
          <span class="ylf-pass-tile inline-flex size-10 shrink-0 items-center justify-center rounded-xl">
            <UIcon name="i-lucide-cloud" class="size-5" />
          </span>
          <span class="min-w-0">
            <span class="block font-semibold">开通云乐坊会员 · 点亮晴空</span>
            <span class="block text-sm text-white/85">跨应用通用 · 数据同步 · 免扣云币</span>
          </span>
        </span>
        <UIcon name="i-lucide-arrow-right" class="size-5 shrink-0 transition-transform group-hover:translate-x-1" />
      </NuxtLink>

      <!-- 快捷入口 -->
      <section class="ylf-card rounded-3xl p-6">
        <h2 class="ylf-dreamy-display mb-4 text-xl text-highlighted">
          快捷入口
        </h2>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NuxtLink
            v-for="e in entries"
            :key="e.to"
            :to="e.to"
            class="ylf-entry-tile group flex flex-col items-center gap-2.5 rounded-2xl p-4 text-center"
          >
            <span
              class="ylf-dopa-tile inline-flex size-11 items-center justify-center rounded-xl"
              :style="{ '--tile': e.color }"
            >
              <UIcon :name="e.icon" class="size-5" />
            </span>
            <span class="text-sm font-medium text-highlighted">{{ e.label }}</span>
          </NuxtLink>
        </div>
      </section>

      <!-- 我的应用 -->
      <section class="ylf-card rounded-3xl p-6">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="ylf-dreamy-display text-xl text-highlighted">
            我的应用
          </h2>
          <UButton
            to="/apps"
            label="查看全部"
            icon="i-lucide-arrow-right"
            color="neutral"
            variant="ghost"
            size="xs"
            trailing
          />
        </div>

        <div v-if="appsLoading" class="flex justify-center py-6">
          <UIcon name="i-lucide-loader-2" class="animate-spin text-xl text-muted" />
        </div>
        <div v-else-if="myApps.length === 0" class="ylf-empty-state rounded-2xl py-8 text-center">
          <p class="mb-3 text-sm text-muted">
            还没有发布任何应用
          </p>
          <UButton
            v-if="canCreate"
            to="/apps/new"
            label="创建应用"
            icon="i-lucide-plus"
            color="primary"
            variant="subtle"
            size="xs"
          />
          <p v-else class="text-xs text-muted">
            自助发布敬请期待 🚧
          </p>
        </div>
        <div v-else class="space-y-1.5">
          <NuxtLink
            v-for="item in myApps.slice(0, 5)"
            :key="item._id"
            :to="`/apps/${item.slug}`"
            class="group flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-elevated/60"
          >
            <div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-elevated">
              <img v-if="item.icon" :src="item.icon" :alt="item.name" class="size-6 rounded">
              <UIcon v-else name="i-lucide-box" class="text-base text-muted" />
            </div>
            <div class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium transition-colors group-hover:text-primary">{{ item.name }}</span>
              <span class="font-mono text-xs text-muted">{{ item.slug }}</span>
            </div>
            <span class="shrink-0 text-xs text-muted">{{ formatAppDate(item.updatedAt) }}</span>
          </NuxtLink>
        </div>
      </section>

      <FollowListModal v-if="user" v-model:open="showList" :user-id="user.id" :type="listType" />
    </div>
  </UContainer>
</template>

<style scoped>
.ylf-hero-shadow {
  text-shadow: 0 1px 10px rgba(0, 40, 90, 0.35);
}

.ylf-join-cta {
  background: var(--ylf-gradient-brand);
  box-shadow: 0 16px 36px -20px color-mix(in srgb, #0b82c4 70%, transparent);
  transition:
    transform 180ms ease,
    box-shadow 180ms ease;
}

.ylf-join-cta:hover {
  transform: translateY(-2px);
  box-shadow: 0 22px 44px -22px color-mix(in srgb, #0b82c4 75%, transparent);
}

.ylf-pass-tile {
  background: rgba(255, 255, 255, 0.25);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
}

.ylf-entry-tile {
  transition:
    background-color 160ms ease,
    transform 160ms ease;
}

.ylf-entry-tile:hover {
  background: var(--ylf-surface-hover);
  transform: translateY(-2px);
}
</style>
