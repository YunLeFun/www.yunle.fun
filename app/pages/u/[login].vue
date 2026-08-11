<script setup lang="ts">
/**
 * 公开用户主页 /u/[login]。
 *
 * 展示用户公开资料（user_profiles）+ 关注按钮 + 粉丝 / 关注数 + ta 的公开应用。
 * 参数优先按 login 查；查不到再按 uid 兜底（便于无用户名的用户也能通过 /u/<uid> 访问）。
 */
import type { AppRecord } from '~/types/app'
import type { FollowRelation, UserProfile } from '~/types/social'
import { Button } from '@/components/ui/button'
import AppSurfaceList from '~/components/apps/AppSurfaceList.vue'
import { displayUserName } from '~/utils/mask'

definePageMeta({ layout: 'default' })

const route = useRoute()
const { user } = useTcbAuth()
const { getRelation } = useFollow()
const { getUserApps } = useApps()

const loginParam = computed(() => String(route.params.login || ''))

// 公开资料统一经同源 server route 读取：SSR、访客刷新与 SPA 跳转共用同一条无登录态依赖的链路。
// identifier 在服务端按 login → uid 解析；只有明确的 404 才表示用户不存在。
const {
  data: profileData,
  status: profileStatus,
  error: profileError,
  refresh: refreshProfile,
} = await useFetch<UserProfile>('/api/profile', {
  query: { identifier: loginParam },
})

const profile = computed(() => profileData.value ?? null)
const relation = ref<FollowRelation | null>(null)
const userApps = ref<AppRecord[]>([])
const appsLoading = ref(false)
/** 粉丝数随 FollowButton 乐观变化 */
const followersCount = ref(profile.value?.followersCount ?? 0)

const loading = computed(() => profileStatus.value === 'pending')
const profileNotFound = computed(() =>
  profileError.value?.statusCode === 404 || profileError.value?.status === 404,
)
const profileUnavailable = computed(() =>
  (!profileNotFound.value && profileStatus.value === 'error')
  || (profileStatus.value === 'success' && !profile.value),
)

async function retryProfile() {
  await refreshProfile()
}

const isSelf = computed(() => !!user.value && !!profile.value && user.value.id === profile.value.userId)
const displayName = computed(() => displayUserName(profile.value?.nickname, profile.value?.login || '云乐坊用户'))

useSeoMeta({
  title: computed(() => (profile.value ? `${displayName.value} - YunLeFun` : '用户 - YunLeFun')),
  description: computed(() => profile.value?.description || '云乐坊用户主页'),
})

let appsRequestId = 0
async function loadApps(login: string | null) {
  const requestId = ++appsRequestId
  if (!login) {
    userApps.value = []
    appsLoading.value = false
    return
  }

  appsLoading.value = true
  try {
    const apps = await getUserApps(login)
    if (requestId === appsRequestId)
      userApps.value = apps
  }
  catch {
    if (requestId === appsRequestId)
      userApps.value = []
  }
  finally {
    if (requestId === appsRequestId)
      appsLoading.value = false
  }
}

watch(profile, (nextProfile) => {
  followersCount.value = nextProfile?.followersCount ?? 0
  void loadApps(nextProfile?.login ?? null)
}, { immediate: true })

// 关系接口需要登录态。公开路由刷新时 user 会在 cookie → CloudBase session 恢复完成后置位，
// 监听 user 而不是 onMounted 立即请求，避免 memory-only token 启动窗口内的 403。
let relationRequestId = 0
watch([() => profile.value?.userId, () => user.value?.id], async ([targetId, viewerId]) => {
  const requestId = ++relationRequestId
  relation.value = null
  if (!targetId || !viewerId || targetId === viewerId)
    return

  try {
    const nextRelation = await getRelation(targetId)
    if (requestId === relationRequestId)
      relation.value = nextRelation
  }
  catch {
    if (requestId === relationRequestId)
      relation.value = null
  }
}, { immediate: true })

function onFollowChange(following: boolean) {
  followersCount.value = Math.max(0, followersCount.value + (following ? 1 : -1))
}

// 粉丝 / 关注列表弹窗
const showList = ref(false)
const listType = ref<'following' | 'followers'>('followers')
function openList(type: 'following' | 'followers') {
  listType.value = type
  showList.value = true
}
</script>

<template>
  <AppContainer class="py-8 sm:py-10">
    <div v-if="loading" class="flex justify-center py-20">
      <Icon name="i-lucide-loader-2" class="animate-spin text-3xl text-muted" />
    </div>

    <div v-else-if="profileUnavailable" class="ylf-empty-state rounded-3xl px-4 py-20 text-center">
      <Icon name="i-lucide-cloud-off" class="mb-4 text-5xl text-muted" />
      <p class="mb-2 text-lg text-muted">
        暂时无法加载用户资料
      </p>
      <p class="mb-5 text-sm text-dimmed">
        请检查网络后重试
      </p>
      <AppButton label="重新加载" icon="i-lucide-refresh-cw" color="neutral" variant="outline" @click="retryProfile" />
    </div>

    <div v-else-if="profileNotFound" class="ylf-empty-state rounded-3xl px-4 py-20 text-center">
      <Icon name="i-lucide-user-x" class="mb-4 text-5xl text-muted" />
      <p class="mb-4 text-lg text-muted">
        用户不存在
      </p>
      <AppButton to="/" label="返回首页" icon="i-lucide-arrow-left" color="neutral" variant="outline" />
    </div>

    <div v-else-if="profile" class="mx-auto max-w-3xl space-y-6">
      <!-- 晴空 hero -->
      <SkyHero>
        <div class="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div class="flex items-center gap-4 sm:gap-5">
            <MemberAvatar
              :src="profile.avatar"
              :alt="displayName"
              size="3xl"
              :is-member="profile.isMember"
              ring-class="ring-white/60"
            />
            <div class="min-w-0 text-white">
              <h1 class="ylf-hero-shadow truncate text-2xl font-bold sm:text-3xl">
                {{ displayName }}
              </h1>
              <p v-if="profile.login" class="ylf-hero-shadow mt-0.5 text-sm text-white/85">
                @{{ profile.login }}
              </p>
              <div class="ylf-hero-shadow mt-2.5 flex items-center gap-4 text-sm text-white/90">
                <Button type="button" variant="ghost" size="xs" class="h-auto px-0 text-white hover:bg-transparent hover:text-white/80" @click="openList('followers')">
                  <strong class="font-bold">{{ followersCount }}</strong> 粉丝
                </Button>
                <Button type="button" variant="ghost" size="xs" class="h-auto px-0 text-white hover:bg-transparent hover:text-white/80" @click="openList('following')">
                  <strong class="font-bold">{{ profile.followingCount }}</strong> 关注
                </Button>
              </div>
            </div>
          </div>
          <div class="shrink-0 self-start sm:self-auto">
            <AppButton
              v-if="isSelf"
              to="/settings"
              label="编辑资料"
              icon="i-lucide-pencil"
              size="lg"
              class="ylf-glass-btn rounded-full"
            />
            <FollowButton
              v-else
              :target-id="profile.userId"
              :relation="relation"
              size="lg"
              @change="onFollowChange"
            />
          </div>
        </div>
      </SkyHero>

      <!-- 简介 -->
      <section v-if="profile.description" class="ylf-card rounded-3xl p-6">
        <h2 class="ylf-dreamy-display mb-3 text-xl text-highlighted">
          简介
        </h2>
        <p class="whitespace-pre-wrap text-sm leading-relaxed text-default">
          {{ profile.description }}
        </p>
      </section>

      <!-- ta 的主页应用 -->
      <section class="ylf-card rounded-3xl p-6">
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 class="ylf-dreamy-display text-xl text-highlighted">
              {{ isSelf ? '我' : 'Ta' }}的主页应用
            </h2>
            <p class="mt-1 text-xs text-muted">
              已发布到个人主页的公开作品
            </p>
          </div>
          <AppButton
            v-if="profile.login"
            :to="`https://apps.yunle.fun/developer/${encodeURIComponent(profile.login)}`"
            label="云乐坊主页"
            icon="i-lucide-external-link"
            color="neutral"
            variant="ghost"
            size="xs"
          />
        </div>

        <div v-if="appsLoading" class="flex justify-center py-6">
          <Icon name="i-lucide-loader-2" class="animate-spin text-xl text-muted" />
        </div>
        <div v-else-if="userApps.length === 0" class="ylf-empty-state rounded-2xl py-8 text-center">
          <p class="text-sm text-muted">
            还没有在主页展示应用
          </p>
        </div>
        <template v-else>
          <AppSurfaceList :apps="userApps.slice(0, 6)" />
          <AppButton
            v-if="userApps.length > 6 && profile.login"
            :to="`https://apps.yunle.fun/developer/${encodeURIComponent(profile.login)}`"
            :label="`还有 ${userApps.length - 6} 个应用`"
            icon="i-lucide-arrow-right"
            color="neutral"
            variant="link"
            size="xs"
            trailing
            class="mt-3"
          />
        </template>
      </section>

      <FollowListModal v-model:open="showList" :user-id="profile.userId" :type="listType" />
    </div>
  </AppContainer>
</template>

<style scoped>
.ylf-hero-shadow {
  text-shadow: 0 1px 10px rgba(0, 40, 90, 0.35);
}
</style>
