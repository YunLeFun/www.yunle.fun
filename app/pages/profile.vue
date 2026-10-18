<script setup lang="ts">
import type { AppRecord, MyWorkshopOverview, WorkshopSurface } from '~/types/app'
import type { UserProfile } from '~/types/social'
import type { SkyGreeting } from '~/utils/skyGreeting'
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
const { getProfile, syncRestricted } = useUserProfile()
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

// 问候语跟随当地天色；挂载后计算，避免服务端与浏览器时区不一致
const greeting = ref<SkyGreeting | null>(null)
// 本浏览器里戳过的云朵数，悄悄跟在问候语后面
const { count: cloudPokes, load: loadCloudPokes } = useCloudCollection()
onMounted(() => {
  greeting.value = getSkyGreeting(new Date().getHours())
  loadCloudPokes()
})

// 360px 以下的窄屏，会员到期信息改为「剩 N 天」，避免徽章撑出头图
const narrowScreen = useMediaQuery('(max-width: 359px)')

// 戳一下头像：像首页的云朵一样 Q 弹一下
const avatarPoked = ref(false)
function pokeAvatar() {
  avatarPoked.value = false
  requestAnimationFrame(() => {
    avatarPoked.value = true
  })
}

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
// 快捷入口做成「应用桌面」：每个入口一枚纯色圆角图标，sky 是图标底色，on 是图标前景色
const entries = computed(() => {
  const list = [
    { label: '关注动态', icon: 'i-lucide-rss', to: '/feed', sky: 'var(--ylf-palette-sun)', on: 'var(--ylf-accent-sun-on)' },
    { label: '我的钱包', icon: 'i-lucide-wallet', to: '/wallet', sky: 'var(--ylf-palette-cyan)', on: '#fff' },
    { label: '主页应用', icon: 'i-lucide-layout-grid', to: appsProfileUrl.value, sky: 'var(--ylf-palette-blue)', on: '#fff' },
    { label: '私人工坊', icon: 'i-lucide-key-round', to: 'https://apps.yunle.fun/user/workshop', sky: 'var(--ylf-palette-coral)', on: '#fff' },
    { label: '账户设置', icon: 'i-lucide-settings', to: '/settings', sky: '#7b8aa3', on: '#fff' },
    { label: '安全设置', icon: 'i-lucide-shield-check', to: '/settings?tab=security', sky: 'var(--ylf-palette-green)', on: '#fff' },
  ]
  // 未设置用户名的老账号使用不可变 uid，仍可访问自己的公开主页。
  if (publicProfilePath.value)
    list.unshift({ label: '我的主页', icon: 'i-lucide-id-card', to: publicProfilePath.value, sky: 'var(--ylf-palette-pink)', on: '#fff' })
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
    <!-- 登录态恢复中：与正式布局同形的晴空骨架，避免内容加载后跳动 -->
    <div v-if="loading" class="mx-auto max-w-3xl space-y-6" aria-busy="true" aria-label="正在加载个人中心">
      <div class="ylf-shimmer h-52 rounded-[var(--ylf-radius-xl)] sm:h-56" />
      <div class="ylf-shimmer h-16 rounded-[var(--ylf-radius-lg)]" />
      <div class="ylf-shimmer h-44 rounded-[var(--ylf-radius-lg)]" />
    </div>

    <div v-else-if="user" class="mx-auto max-w-3xl space-y-6">
      <!-- 晴空 hero：身份 + 数据条 -->
      <SkyHero class="ylf-rise">
        <div class="p-5 sm:p-7">
          <div class="flex items-start justify-between gap-3 sm:gap-5">
            <div class="flex min-w-0 items-center gap-4 sm:gap-5">
              <div
                class="profile-avatar shrink-0"
                data-hero-interactive
                data-vt="avatar"
                :class="[{ 'ylf-squish': avatarPoked }, isMember ? 'profile-avatar--member' : '']"
                @click="pokeAvatar"
                @animationend.self="avatarPoked = false"
              >
                <span class="profile-avatar__halo" aria-hidden="true" />
                <MemberAvatar
                  :src="user.avatar"
                  :alt="displayName"
                  size="3xl"
                  :is-member="isMember"
                  ring-class="ring-white/60"
                />
              </div>
              <div class="min-w-0 text-white">
                <p
                  v-if="greeting"
                  class="profile-greeting ylf-hero-shadow mb-1 inline-flex items-center gap-1.5 text-xs font-medium text-white/90"
                >
                  <Icon :name="greeting.icon" class="size-3.5" aria-hidden="true" />
                  {{ greeting.text }}
                  <span v-if="cloudPokes" class="inline-flex items-center gap-1 text-white/75" title="在本浏览器里戳过的云朵">
                    · <Icon name="i-lucide-cloud" class="size-3" aria-hidden="true" /> 已收集 {{ cloudPokes }} 朵云
                  </span>
                </p>
                <h1 class="ylf-hero-shadow truncate text-xl font-bold sm:text-2xl">
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
                    :compact="narrowScreen"
                    :expire-at="membershipState?.expireAt ?? null"
                  />
                  <span v-else class="ylf-glass rounded-full px-2.5 py-1 font-medium text-white">
                    {{ joinDate }} 加入
                  </span>
                </div>
              </div>
            </div>
            <!-- 窄屏只留图标按钮，和头像同一行，省出首屏高度 -->
            <AppButton
              to="/settings?edit=profile"
              data-vt-link="avatar page-header"
              label="编辑资料"
              icon="i-lucide-pencil"
              class="ylf-glass-btn shrink-0 rounded-full max-sm:hidden"
            />
            <AppButton
              to="/settings?edit=profile"
              data-vt-link="avatar page-header"
              icon="i-lucide-pencil"
              aria-label="编辑资料"
              class="ylf-glass-btn size-10 shrink-0 rounded-full sm:hidden"
            />
          </div>

          <!-- 数据条（点击直达） -->
          <div class="ylf-glass-deep ylf-hero-shadow mt-5 flex items-stretch rounded-2xl p-1.5 sm:mt-6">
            <component
              :is="s.to ? 'NuxtLink' : 'button'"
              v-for="(s, i) in stats"
              :key="s.label"
              :to="s.to"
              :type="s.to ? undefined : 'button'"
              class="profile-stat ylf-press relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-white"
              :class="i > 0 ? 'profile-stat--divided' : ''"
              @click="s.onClick?.()"
            >
              <AppCountUp :value="s.value" class="text-lg font-semibold leading-none" />
              <span class="text-xs text-white/90">{{ s.label }}</span>
            </component>
          </div>
        </div>
      </SkyHero>

      <TestAccountNotice v-if="syncRestricted" feature="profile-sync" />

      <!-- 未开通会员引导 -->
      <NuxtLink
        v-if="!isMember"
        to="/pricing"
        class="ylf-join-cta ylf-shine ylf-rise group flex items-center justify-between gap-3 rounded-[var(--ylf-radius-lg)] px-4 py-3.5 text-primary-foreground sm:px-5"
        style="--i: 1"
      >
        <span class="flex items-center gap-3">
          <span class="ylf-pass-tile inline-flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Icon name="i-lucide-cloud" class="join-cloud size-5" />
          </span>
          <span class="min-w-0">
            <span class="block font-semibold">开通云乐坊会员 · 点亮晴空</span>
            <span class="block text-sm">跨应用通用 · 数据同步 · 免扣云币</span>
          </span>
        </span>
        <Icon name="i-lucide-arrow-right" class="size-5 shrink-0 transition-transform group-hover:translate-x-1" />
      </NuxtLink>

      <!-- 快捷入口 -->
      <AppSection title="快捷入口" :rise="2">
        <template #actions>
          <span class="ylf-caption">{{ entries.length }} 个服务</span>
        </template>
        <nav class="profile-launcher" aria-label="个人中心快捷入口">
          <NuxtLink
            v-for="(e, i) in entries"
            :key="e.to"
            :to="e.to"
            class="profile-app ylf-rise"
            :style="{ '--sky': e.sky, '--on': e.on, '--i': 3 + i * 0.5 }"
            :data-vt-link="e.to.startsWith('/settings') ? 'avatar page-header' : undefined"
          >
            <span class="profile-app__icon">
              <Icon :name="e.icon" class="size-[1.375rem]" aria-hidden="true" />
            </span>
            <span class="profile-app__label">{{ e.label }}</span>
          </NuxtLink>
        </nav>
      </AppSection>

      <!-- 主页应用 -->
      <AppSection title="主页应用" description="已发布并展示在你的云乐坊个人主页" :rise="4">
        <template #actions>
          <AppButton
            :to="appsProfileUrl"
            label="打开主页"
            icon="i-lucide-external-link"
            color="neutral"
            variant="ghost"
            size="xs"
            trailing
          />
        </template>

        <div v-if="appsLoading" class="space-y-2.5" aria-busy="true" aria-label="正在加载主页应用">
          <div v-for="n in 2" :key="n" class="flex items-center gap-3">
            <div class="ylf-shimmer size-11 shrink-0 rounded-xl" />
            <div class="flex-1 space-y-2">
              <div class="ylf-shimmer h-3.5 w-2/5 rounded-full" />
              <div class="ylf-shimmer h-3 w-3/4 rounded-full" />
            </div>
          </div>
        </div>
        <div v-else-if="homeApps.length === 0" class="ylf-empty-state rounded-2xl px-4 py-8 text-center">
          <span class="ylf-empty-cloud ylf-bob" aria-hidden="true">
            <Icon name="i-lucide-cloud" class="size-6" />
          </span>
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
      </AppSection>

      <!-- 私人工坊 -->
      <AppSection
        title="私人工坊"
        icon="i-lucide-key-round"
        description="这里只展示你作为坊主或坊客有权查看的作品"
        :rise="5"
      >
        <template #actions>
          <AppButton
            to="https://apps.yunle.fun/user/workshop"
            :label="myWorkshops.owned ? '管理' : '开启'"
            icon="i-lucide-external-link"
            color="neutral"
            variant="ghost"
            size="xs"
          />
        </template>

        <div v-if="appsLoading" class="ylf-shimmer h-28 rounded-[1.1rem]" aria-busy="true" aria-label="正在加载私人工坊" />
        <div v-else-if="workshopSurfaces.length === 0" class="ylf-empty-state rounded-2xl px-4 py-8 text-center">
          <span class="ylf-empty-cloud ylf-bob" aria-hidden="true">
            <Icon name="i-lucide-door-open" class="size-6" />
          </span>
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
            v-for="(surface, i) in workshopSurfaces"
            :key="surface.workshop._id"
            class="private-workshop ylf-rise"
            :style="{ '--i': i }"
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
                class="workshop-open inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-elevated hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
      </AppSection>

      <FollowListModal v-if="user" v-model:open="showList" :user-id="user.id" :type="listType" />
    </div>
  </AppContainer>
</template>

<style scoped>
.ylf-hero-shadow {
  text-shadow: 0 1px 10px rgba(0, 40, 90, 0.35);
}

/* 头像光环：一圈缓慢旋转的晴空光晕，会员换成落日暖色。 */
.profile-avatar {
  position: relative;
  display: inline-flex;
  border-radius: 9999px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.profile-avatar__halo {
  position: absolute;
  inset: -6px;
  border-radius: inherit;
  background: conic-gradient(
    from 0deg,
    rgba(255, 255, 255, 0.85),
    rgba(147, 214, 255, 0.2),
    rgba(255, 255, 255, 0.75),
    rgba(147, 214, 255, 0.2),
    rgba(255, 255, 255, 0.85)
  );
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
  filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.55));
  /* 光环平时静止，只在悬停或被戳时转半圈，头图里不再有常驻的旋转 */
  transition: rotate 1200ms var(--ylf-ease-standard);
}

.profile-avatar:hover .profile-avatar__halo,
.profile-avatar.ylf-squish .profile-avatar__halo {
  rotate: 0.5turn;
}

.profile-avatar--member .profile-avatar__halo {
  background: conic-gradient(from 0deg, #ffd29a, #f4516a, #ffb38a, #ff7a9a, #ffd29a);
  filter: drop-shadow(0 0 8px rgba(244, 81, 106, 0.45));
}

/* 手机上头像缩到 64px，给昵称和会员徽章留出宽度 */
@media (max-width: 639px) {
  .profile-avatar :deep([data-slot='avatar']) {
    width: 4rem;
    height: 4rem;
  }
}

.profile-greeting {
  animation: profile-greeting-in 900ms var(--ylf-ease-spring) 320ms backwards;
}

@keyframes profile-greeting-in {
  from {
    opacity: 0;
    translate: -6px 0;
  }
}

/* 数据条：每项是一块可按的玻璃，悬停时微微亮起并上浮。 */
.profile-stat {
  transition:
    background-color var(--ylf-duration-fast) var(--ylf-ease-standard),
    translate var(--ylf-duration-slow) var(--ylf-ease-spring),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.profile-stat--divided::before {
  position: absolute;
  inset-block: 0.75rem;
  inset-inline-start: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.25);
  content: '';
}

.profile-stat:hover {
  background: rgba(255, 255, 255, 0.12);
  translate: 0 -2px;
}

.profile-stat:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.85);
  outline-offset: -2px;
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
  transition:
    border-color var(--ylf-duration-fast) var(--ylf-ease-standard),
    box-shadow var(--ylf-duration-normal) var(--ylf-ease-standard);
}

.private-workshop:hover {
  border-color: color-mix(in srgb, var(--ylf-dopa-violet) 36%, var(--ui-border));
  box-shadow: 0 14px 30px -24px color-mix(in srgb, var(--ylf-dopa-violet) 70%, transparent);
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

.workshop-open :deep(svg),
.workshop-open :deep(.iconify) {
  transition: translate var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.workshop-open:hover :deep(svg),
.workshop-open:hover :deep(.iconify) {
  translate: 2px -2px;
}

.ylf-join-cta {
  background: var(--ylf-gradient-brand);
  box-shadow: 0 16px 36px -20px color-mix(in srgb, #0b82c4 70%, transparent);
  transition:
    translate var(--ylf-duration-slow) var(--ylf-ease-spring),
    box-shadow var(--ylf-duration-normal) var(--ylf-ease-standard);
}

.ylf-join-cta:hover {
  translate: 0 -2px;
  box-shadow: 0 22px 44px -22px color-mix(in srgb, #0b82c4 75%, transparent);
}

.ylf-join-cta:hover .join-cloud {
  animation: ylf-squish 640ms var(--ylf-ease-standard);
}

.ylf-pass-tile {
  background: rgba(255, 255, 255, 0.25);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
}

/* 应用桌面：手机 4 列、桌面 7 列；图标像真正的 App 一样有高光和投影，悬停 Q 弹、按下回缩 */
.profile-launcher {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem 0.5rem;
}

@media (min-width: 640px) {
  .profile-launcher {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
}

.profile-app {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  border-radius: var(--ylf-radius);
  padding-block: 0.25rem;
  outline: none;
}

.profile-app__icon {
  display: grid;
  width: 3rem;
  aspect-ratio: 1;
  place-items: center;
  border-radius: 30%;
  color: var(--on);
  background: linear-gradient(160deg, rgb(255 255 255 / 28%), transparent 55%), var(--sky);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 45%),
    inset 0 -3px 0 rgb(0 0 0 / 10%),
    0 8px 16px -10px var(--sky);
  transition:
    translate var(--ylf-duration-slow) var(--ylf-ease-spring),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.profile-app:hover .profile-app__icon {
  translate: 0 -3px;
  animation: ylf-squish 640ms var(--ylf-ease-standard);
}

.profile-app:active .profile-app__icon {
  scale: 0.9;
  transition-duration: var(--ylf-duration-press);
}

.profile-app:focus-visible .profile-app__icon {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

.profile-app__label {
  max-width: 100%;
  overflow: hidden;
  color: var(--ui-text);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .profile-greeting,
  .ylf-join-cta:hover .join-cloud {
    animation: none;
  }

  .profile-stat:hover,
  .ylf-join-cta:hover,
  .profile-app:hover .profile-app__icon,
  .workshop-open:hover :deep(svg),
  .workshop-open:hover :deep(.iconify) {
    translate: none;
    rotate: none;
    scale: none;
  }
}
</style>
