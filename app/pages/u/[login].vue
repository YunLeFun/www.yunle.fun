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
const developerProfileUrl = computed(() => {
  const login = profile.value?.login
  return login ? `https://apps.yunle.fun/developer/${encodeURIComponent(login)}` : undefined
})

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
    <div v-if="loading" class="mx-auto max-w-3xl space-y-6" aria-busy="true" aria-label="正在加载用户主页">
      <div class="ylf-shimmer h-48 rounded-[var(--ylf-radius-xl)] sm:h-44" />
      <div class="ylf-shimmer h-28 rounded-[var(--ylf-radius-lg)]" />
      <div class="ylf-shimmer h-44 rounded-[var(--ylf-radius-lg)]" />
    </div>

    <div v-else-if="profileUnavailable" class="ylf-empty-state ylf-rise rounded-[var(--ylf-radius-lg)] px-4 py-20 text-center">
      <span class="ylf-empty-cloud ylf-bob size-16!" aria-hidden="true">
        <Icon name="i-lucide-cloud-off" class="size-8" />
      </span>
      <p class="mb-2 text-lg text-muted">
        暂时无法加载用户资料
      </p>
      <p class="mb-5 text-sm text-dimmed">
        请检查网络后重试
      </p>
      <AppButton label="重新加载" icon="i-lucide-refresh-cw" color="neutral" variant="outline" @click="retryProfile" />
    </div>

    <div v-else-if="profileNotFound" class="ylf-empty-state ylf-rise rounded-[var(--ylf-radius-lg)] px-4 py-20 text-center">
      <span class="ylf-empty-cloud ylf-bob size-16!" aria-hidden="true">
        <Icon name="i-lucide-user-x" class="size-8" />
      </span>
      <p class="mb-4 text-lg text-muted">
        用户不存在
      </p>
      <AppButton to="/" label="返回首页" icon="i-lucide-arrow-left" color="neutral" variant="outline" />
    </div>

    <div v-else-if="profile" class="mx-auto max-w-3xl space-y-6">
      <!-- 晴空 hero -->
      <SkyHero class="ylf-rise">
        <div class="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div class="flex items-center gap-4 sm:gap-5">
            <MemberAvatar
              :src="profile.avatar"
              :alt="displayName"
              size="3xl"
              :is-member="profile.isMember"
              ring-class="ring-white/60"
            />
            <div class="min-w-0 text-white">
              <h1 class="ylf-hero-shadow truncate text-xl font-bold sm:text-2xl">
                {{ displayName }}
              </h1>
              <p v-if="profile.login" class="ylf-hero-shadow mt-0.5 text-sm text-white/85">
                @{{ profile.login }}
              </p>
              <div class="ylf-hero-shadow mt-2.5 flex items-center gap-4 text-sm text-white/90">
                <Button type="button" variant="ghost" size="xs" class="h-auto px-0 text-white hover:bg-transparent hover:text-white/80" @click="openList('followers')">
                  <AppCountUp :value="followersCount" class="font-bold" /> 粉丝
                </Button>
                <Button type="button" variant="ghost" size="xs" class="h-auto px-0 text-white hover:bg-transparent hover:text-white/80" @click="openList('following')">
                  <AppCountUp :value="profile.followingCount" class="font-bold" /> 关注
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
      <AppSection v-if="profile.description" title="简介" :rise="1">
        <p class="whitespace-pre-wrap text-sm leading-relaxed text-default">
          {{ profile.description }}
        </p>
      </AppSection>

      <!-- ta 的主页应用 -->
      <AppSection :title="`${isSelf ? '我' : 'Ta'}的主页应用`" description="已发布到个人主页的公开作品" :rise="2">
        <template #actions>
          <AppButton
            v-if="developerProfileUrl"
            :to="developerProfileUrl"
            label="云乐坊主页"
            icon="i-lucide-external-link"
            color="neutral"
            variant="ghost"
            size="xs"
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
        <div v-else-if="userApps.length === 0" class="ylf-empty-state rounded-2xl px-4 py-8 text-center">
          <span class="ylf-empty-cloud ylf-bob" aria-hidden="true">
            <Icon name="i-lucide-cloud" class="size-6" />
          </span>
          <p class="text-sm text-muted">
            还没有在主页展示应用
          </p>
        </div>
        <template v-else>
          <AppSurfaceList :apps="userApps.slice(0, 6)" />
          <AppButton
            v-if="userApps.length > 6 && developerProfileUrl"
            :to="developerProfileUrl"
            :label="`还有 ${userApps.length - 6} 个应用`"
            icon="i-lucide-arrow-right"
            color="neutral"
            variant="link"
            size="xs"
            trailing
            class="mt-3"
          />
        </template>
      </AppSection>

      <FollowListModal v-if="profile" v-model:open="showList" :user-id="profile.userId" :type="listType" />
    </div>
  </AppContainer>
</template>

<style scoped>
.ylf-hero-shadow {
  text-shadow: 0 1px 10px rgba(0, 40, 90, 0.35);
}
</style>
