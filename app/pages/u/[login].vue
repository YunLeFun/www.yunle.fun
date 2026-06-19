<script setup lang="ts">
/**
 * 公开用户主页 /u/[login]。
 *
 * 展示用户公开资料（user_profiles）+ 关注按钮 + 粉丝 / 关注数 + ta 的公开应用。
 * 参数优先按 login 查；查不到再按 uid 兜底（便于无用户名的用户也能通过 /u/<uid> 访问）。
 */
import type { AppRecord } from '~/types/app'
import type { FollowRelation, UserProfile } from '~/types/social'

definePageMeta({ layout: 'default' })

const route = useRoute()
const { user } = useTcbAuth()
const { getProfile } = useUserProfile()
const { getRelation } = useFollow()
const { getUserApps } = useApps()

const loginParam = computed(() => String(route.params.login || ''))

// SSR：经 server route 代理取公开资料（用于 SEO / 分享 OG 与首屏 HTML）。
// 未配置 CloudBase HTTP 访问时返回 null，由客户端用 SDK 兜底拉取（功能不受影响，仅无 SSR SEO）。
const { data: ssrProfile, refresh: refreshSsr } = await useFetch<UserProfile | null>('/api/profile', {
  query: { login: loginParam },
  watch: false,
})

const profile = ref<UserProfile | null>(ssrProfile.value ?? null)
const relation = ref<FollowRelation | null>(null)
const userApps = ref<AppRecord[]>([])
const loading = ref(!ssrProfile.value)
const appsLoading = ref(true)
/** 粉丝数随 FollowButton 乐观变化 */
const followersCount = ref(ssrProfile.value?.followersCount ?? 0)

const isSelf = computed(() => !!user.value && !!profile.value && user.value.id === profile.value.userId)
const displayName = computed(() => profile.value?.nickname || profile.value?.login || '云乐坊用户')

useSeoMeta({
  title: computed(() => (profile.value ? `${displayName.value} - YunLeFun` : '用户 - YunLeFun')),
  description: computed(() => profile.value?.description || '云乐坊用户主页'),
})

async function loadApps(login: string | null) {
  appsLoading.value = true
  try {
    userApps.value = login ? await getUserApps(login) : []
  }
  catch {
    userApps.value = []
  }
  finally {
    appsLoading.value = false
  }
}

/** 解析资料（优先 SSR 结果，缺失则客户端 SDK 兜底）并加载关系 / 应用 */
async function resolve() {
  loading.value = true
  relation.value = null
  try {
    let p = ssrProfile.value
    if (!p)
      p = (await getProfile({ login: loginParam.value })) || (await getProfile({ userId: loginParam.value }))
    profile.value = p
    if (!p)
      return
    followersCount.value = p.followersCount
    loadApps(p.login)
    if (user.value && user.value.id !== p.userId)
      relation.value = await getRelation(p.userId)
  }
  finally {
    loading.value = false
  }
}

onMounted(resolve)
watch(loginParam, async () => {
  await refreshSsr()
  await resolve()
})

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
  <UContainer class="py-8 sm:py-10">
    <div v-if="loading" class="flex justify-center py-20">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-muted" />
    </div>

    <div v-else-if="!profile" class="ylf-empty-state rounded-3xl px-4 py-20 text-center">
      <UIcon name="i-lucide-user-x" class="mb-4 text-5xl text-muted" />
      <p class="mb-4 text-lg text-muted">
        用户不存在
      </p>
      <UButton to="/" label="返回首页" icon="i-lucide-arrow-left" color="neutral" variant="outline" />
    </div>

    <div v-else class="mx-auto max-w-3xl space-y-6">
      <!-- 晴空 hero -->
      <SkyHero>
        <div class="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div class="flex items-center gap-4 sm:gap-5">
            <MemberAvatar
              :src="profile.avatar"
              :alt="displayName"
              size="3xl"
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
                <button type="button" class="transition-opacity hover:opacity-80" @click="openList('followers')">
                  <strong class="font-bold">{{ followersCount }}</strong> 粉丝
                </button>
                <button type="button" class="transition-opacity hover:opacity-80" @click="openList('following')">
                  <strong class="font-bold">{{ profile.followingCount }}</strong> 关注
                </button>
              </div>
            </div>
          </div>
          <div class="shrink-0 self-start sm:self-auto">
            <UButton
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

      <!-- ta 的应用 -->
      <section class="ylf-card rounded-3xl p-6">
        <h2 class="ylf-dreamy-display mb-4 text-xl text-highlighted">
          {{ isSelf ? '我' : 'Ta' }}的应用
        </h2>

        <div v-if="appsLoading" class="flex justify-center py-6">
          <UIcon name="i-lucide-loader-2" class="animate-spin text-xl text-muted" />
        </div>
        <div v-else-if="userApps.length === 0" class="ylf-empty-state rounded-2xl py-8 text-center">
          <p class="text-sm text-muted">
            还没有公开的应用
          </p>
        </div>
        <div v-else class="space-y-1.5">
          <NuxtLink
            v-for="item in userApps"
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
          </NuxtLink>
        </div>
      </section>

      <FollowListModal v-model:open="showList" :user-id="profile.userId" :type="listType" />
    </div>
  </UContainer>
</template>

<style scoped>
.ylf-hero-shadow {
  text-shadow: 0 1px 10px rgba(0, 40, 90, 0.35);
}
</style>
