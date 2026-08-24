<script setup lang="ts">
import type { AppRecord, MyWorkshopOverview, WorkshopSurface } from '~/types/app'
import type { UserProfile } from '~/types/social'
import AppSurfaceList from '~/components/apps/AppSurfaceList.vue'
import { isOfficialUser } from '~/config'
import { getPublicProfilePath } from '~/utils/publicProfilePath'

definePageMeta({
  layout: 'default',
})

useSeoMeta({
  title: '个人中心 - YunLeFun',
  description: '管理您的个人信息',
})

const { user, isAuthenticated, loading } = useTcbAuth()
const { getMyApps, getMyWorkshops } = useApps()
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
const myWorkshops = ref<MyWorkshopOverview>({ owned: null, joined: [] })
const appsLoading = ref(true)
const homeApps = computed(() => myApps.value.filter(app =>
  (app.audience === 'public' || (!app.audience && app.isPublic))
  && (!app.publicationStatus || app.publicationStatus === 'published'),
))
const workshopSurfaces = computed<WorkshopSurface[]>(() => [
  ...(myWorkshops.value.owned ? [myWorkshops.value.owned] : []),
  ...myWorkshops.value.joined,
])
const appsProfileUrl = computed(() =>
  user.value?.login
    ? `https://apps.yunle.fun/developer/${encodeURIComponent(user.value.login)}`
    : 'https://apps.yunle.fun/tabs/apps',
)

// 我的公开资料（取关注 / 粉丝数）
const myProfile = ref<UserProfile | null>(null)
const publicProfilePath = computed(() => getPublicProfilePath(user.value, myProfile.value))

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
  { label: '主页应用', value: homeApps.value.length, to: appsProfileUrl.value },
  { label: '关注', value: myProfile.value?.followingCount ?? 0, onClick: () => openList('following') },
  { label: '粉丝', value: myProfile.value?.followersCount ?? 0, onClick: () => openList('followers') },
])

// 快捷入口宫格
const entries = computed(() => {
  const list = [
    { label: '关注动态', icon: 'i-lucide-rss', to: '/feed', color: 'var(--ylf-dopa-amber)' },
    { label: '我的钱包', icon: 'i-lucide-wallet', to: '/wallet', color: 'var(--ylf-dopa-cyan)' },
    { label: '主页应用', icon: 'i-lucide-layout-grid', to: appsProfileUrl.value, color: 'var(--ylf-dopa-violet)' },
    { label: '私人工坊', icon: 'i-lucide-key-round', to: 'https://apps.yunle.fun/user/workshop', color: 'var(--ylf-dopa-green)' },
    { label: '账户设置', icon: 'i-lucide-settings', to: '/settings', color: 'var(--ylf-dopa-blue)' },
    { label: '安全设置', icon: 'i-lucide-lock', to: '/settings?tab=security', color: 'var(--ylf-dopa-green)' },
  ]
  // 未设置用户名的老账号使用不可变 uid，仍可访问自己的公开主页。
  if (publicProfilePath.value)
    list.unshift({ label: '我的主页', icon: 'i-lucide-id-card', to: publicProfilePath.value, color: 'var(--ylf-dopa-pink)' })
  return list
})

// 会话就绪后再拉数据：双层会话的 cookie→setSession 恢复窗口内 user 尚未就绪，直接发会 403。
// 会员/账户 composable 的 watch（immediate:false）在「挂载时已登录」场景不触发，故这里手动刷新。
onUserSession(async () => {
  refreshMembership()
  refreshAccount()
  try {
    const [appsResult, workshopsResult, profileResult] = await Promise.allSettled([
      getMyApps(),
      getMyWorkshops(),
      user.value ? getProfile({ userId: user.value.id }) : Promise.resolve(null),
    ])
    if (appsResult.status === 'fulfilled')
      myApps.value = appsResult.value
    if (workshopsResult.status === 'fulfilled')
      myWorkshops.value = workshopsResult.value
    if (profileResult.status === 'fulfilled')
      myProfile.value = profileResult.value
  }
  catch (err) {
    console.error('加载个人数据失败:', err)
  }
  finally {
    appsLoading.value = false
  }
})

function workshopHref(surface: WorkshopSurface) {
  return `https://apps.yunle.fun/w/${encodeURIComponent(surface.workshop._id)}`
}
</script>

<template>
  <AppContainer class="py-8 sm:py-10">
    <div v-if="loading" class="flex justify-center py-20">
      <Icon
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
                    <Icon name="i-lucide-shield-check" class="size-3" />
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
            <AppButton
              to="/settings?edit=profile"
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
            <Icon name="i-lucide-cloud" class="size-5" />
          </span>
          <span class="min-w-0">
            <span class="block font-semibold">开通云乐坊会员 · 点亮晴空</span>
            <span class="block text-sm text-white/85">跨应用通用 · 数据同步 · 免扣云币</span>
          </span>
        </span>
        <Icon name="i-lucide-arrow-right" class="size-5 shrink-0 transition-transform group-hover:translate-x-1" />
      </NuxtLink>

      <!-- 快捷入口 -->
      <section class="ylf-card rounded-3xl p-4 sm:p-5">
        <div class="mb-3 flex items-center justify-between gap-3 px-1">
          <h2 class="font-heading text-lg font-bold tracking-tight text-highlighted">
            快捷入口
          </h2>
          <span class="text-xs text-dimmed">{{ entries.length }} 个服务</span>
        </div>
        <nav class="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="个人中心快捷入口">
          <NuxtLink
            v-for="e in entries"
            :key="e.to"
            :to="e.to"
            class="ylf-entry-tile group flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-start"
            :style="{ '--tile': e.color }"
          >
            <span
              class="ylf-dopa-tile inline-flex size-9 shrink-0 items-center justify-center rounded-[0.65rem]"
            >
              <Icon :name="e.icon" class="size-[1.125rem]" aria-hidden="true" />
            </span>
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">{{ e.label }}</span>
            <Icon
              name="i-lucide-chevron-right"
              class="entry-arrow size-3.5 shrink-0 text-dimmed"
              aria-hidden="true"
            />
          </NuxtLink>
        </nav>
      </section>

      <!-- 主页应用 -->
      <section class="ylf-card rounded-3xl p-6">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <h2 class="font-heading text-xl font-bold tracking-tight text-highlighted">
              主页应用
            </h2>
            <p class="mt-1 text-xs text-muted">
              已发布并展示在你的云乐坊个人主页
            </p>
          </div>
          <AppButton
            :to="appsProfileUrl"
            label="打开主页"
            icon="i-lucide-external-link"
            color="neutral"
            variant="ghost"
            size="xs"
            trailing
          />
        </div>

        <div v-if="appsLoading" class="flex justify-center py-6">
          <Icon name="i-lucide-loader-2" class="animate-spin text-xl text-muted" />
        </div>
        <div v-else-if="homeApps.length === 0" class="ylf-empty-state rounded-2xl py-8 text-center">
          <p class="mb-3 text-sm text-muted">
            还没有在主页展示应用
          </p>
          <AppButton
            v-if="canCreate"
            to="https://apps.yunle.fun/workshop/new"
            label="前往云乐坊发布"
            icon="i-lucide-plus"
            color="primary"
            variant="subtle"
            size="xs"
          />
          <p v-else class="text-xs text-muted">
            自助发布敬请期待 🚧
          </p>
        </div>
        <AppSurfaceList v-else :apps="homeApps.slice(0, 6)" />
      </section>

      <!-- 私人工坊 -->
      <section class="ylf-card rounded-3xl p-6">
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 class="font-heading flex items-center gap-2 text-xl font-bold tracking-tight text-highlighted">
              私人工坊
              <Icon name="i-lucide-key-round" class="size-4 text-primary" aria-hidden="true" />
            </h2>
            <p class="mt-1 text-xs text-muted">
              这里只展示你作为坊主或坊客有权查看的作品
            </p>
          </div>
          <AppButton
            to="https://apps.yunle.fun/user/workshop"
            :label="myWorkshops.owned ? '管理' : '开启'"
            icon="i-lucide-external-link"
            color="neutral"
            variant="ghost"
            size="xs"
          />
        </div>

        <div v-if="appsLoading" class="flex justify-center py-6">
          <Icon name="i-lucide-loader-2" class="animate-spin text-xl text-muted" />
        </div>
        <div v-else-if="workshopSurfaces.length === 0" class="ylf-empty-state rounded-2xl px-4 py-8 text-center">
          <Icon name="i-lucide-door-open" class="mb-2 size-7 text-muted" />
          <p class="text-sm text-muted">
            还没有开启或加入私人工坊
          </p>
          <AppButton
            to="https://apps.yunle.fun/user/workshops"
            label="查看我的工坊"
            icon="i-lucide-arrow-right"
            color="neutral"
            variant="link"
            size="xs"
            trailing
          />
        </div>
        <div v-else class="space-y-3">
          <article
            v-for="surface in workshopSurfaces"
            :key="surface.workshop._id"
            class="private-workshop"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="truncate text-sm font-semibold text-highlighted">
                    {{ surface.workshop.name }}
                  </h3>
                  <AppBadge
                    :label="surface.access === 'owner' ? '我的工坊' : '已加入'"
                    :icon="surface.access === 'owner' ? 'i-lucide-crown' : 'i-lucide-key-round'"
                    color="primary"
                    variant="subtle"
                    size="xs"
                  />
                  <AppBadge
                    v-if="surface.workshop.status === 'disabled'"
                    label="已停用"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  />
                </div>
                <p v-if="surface.workshop.description" class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                  {{ surface.workshop.description }}
                </p>
                <p v-if="surface.access === 'owner'" class="mt-1.5 text-[11px] text-dimmed">
                  {{ surface.guestCount || 0 }} 位坊客
                  <template v-if="surface.pendingCount">
                    · {{ surface.pendingCount }} 个申请待处理
                  </template>
                </p>
              </div>
              <a
                :href="workshopHref(surface)"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-elevated hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                :aria-label="`打开${surface.workshop.name}`"
              >
                <Icon name="i-lucide-arrow-up-right" class="size-4" aria-hidden="true" />
              </a>
            </div>

            <AppSurfaceList
              v-if="surface.apps.length"
              :apps="surface.apps.slice(0, 6)"
              :show-audience="true"
              compact
              class="mt-3"
            />
            <p v-else class="mt-3 rounded-xl bg-elevated/45 px-3 py-3 text-center text-xs text-muted">
              {{ surface.workshop.status === 'disabled' ? '工坊停用期间暂不展示作品' : '工坊里还没有可见作品' }}
            </p>
          </article>
        </div>
      </section>

      <FollowListModal v-if="user" v-model:open="showList" :user-id="user.id" :type="listType" />
    </div>
  </AppContainer>
</template>

<style scoped>
.ylf-hero-shadow {
  text-shadow: 0 1px 10px rgba(0, 40, 90, 0.35);
}

.private-workshop {
  position: relative;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ylf-dopa-violet) 20%, var(--ui-border));
  border-radius: 1.1rem;
  padding: 1rem;
  background:
    linear-gradient(120deg, color-mix(in srgb, var(--ylf-dopa-violet) 7%, transparent), transparent 42%),
    color-mix(in srgb, var(--ylf-surface-muted) 54%, transparent);
}

.private-workshop::before {
  position: absolute;
  width: 4px;
  border-radius: 999px;
  background: linear-gradient(var(--ylf-dopa-violet), var(--ylf-dopa-cyan));
  content: '';
  inset-block: 1rem;
  inset-inline-start: 0;
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
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--ylf-surface-muted) 66%, transparent);
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    transform 160ms ease;
}

.ylf-entry-tile:hover {
  border-color: color-mix(in srgb, var(--tile, var(--ui-primary)) 22%, var(--ui-border-muted));
  background: color-mix(in srgb, var(--tile, var(--ui-primary)) 6%, var(--ylf-surface));
  transform: translateY(-1px);
}

.entry-arrow {
  opacity: 0.45;
  transition:
    color 160ms ease,
    opacity 160ms ease,
    transform 160ms ease;
}

.ylf-entry-tile:hover .entry-arrow {
  color: var(--tile, var(--ui-primary));
  opacity: 1;
  transform: translateX(2px);
}

@media (prefers-reduced-motion: reduce) {
  .ylf-entry-tile,
  .entry-arrow {
    transition: none;
  }

  .ylf-entry-tile:hover,
  .ylf-entry-tile:hover .entry-arrow {
    transform: none;
  }
}
</style>
