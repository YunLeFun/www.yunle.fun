<script setup lang="ts">
import type { AppRecord } from '~/types/app'
import { isOfficialUser } from '~/config'

const RE_PHONE_MASK = /(\d{3})\d{4}(\d{4})/

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
const displayContact = computed(() => {
  if (user.value?.phone) {
    return user.value.phone.replace(RE_PHONE_MASK, '$1****$2')
  }
  return user.value?.email || '未绑定'
})
const displayGender = computed(() => {
  const map: Record<string, string> = { MALE: '♂ 男', FEMALE: '♀ 女' }
  return map[user.value?.gender || ''] || '保密'
})

// 开发者平台未上线，仅官方账号可自助发布应用
const canCreate = computed(() => isOfficialUser(user.value))

// 我的应用
const myApps = ref<AppRecord[]>([])
const appsLoading = ref(true)

onMounted(async () => {
  // profile 挂载时 user 通常已登录，useMembership 的 watch（immediate:false）不会自动触发，需手动刷新
  refreshMembership()
  try {
    myApps.value = await getMyApps()
  }
  catch (err) {
    console.error('加载应用列表失败:', err)
  }
  finally {
    appsLoading.value = false
  }
})

function formatAppDate(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function formatExpire(ts: number | null | undefined) {
  if (!ts)
    return ''
  return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

// 基本信息行（图标走多彩点缀）
const infoRows = computed(() => {
  const u = user.value
  if (!u)
    return []
  const rows = [
    { icon: 'i-lucide-user', label: '昵称', value: displayName.value, color: 'var(--ylf-dopa-cyan)' },
    u.description
      ? { icon: 'i-lucide-file-text', label: '简介', value: u.description, color: 'var(--ylf-dopa-violet)', multiline: true }
      : null,
    { icon: 'i-lucide-person-standing', label: '性别', value: displayGender.value, color: 'var(--ylf-dopa-pink)' },
    { icon: 'i-lucide-smartphone', label: '手机号', value: u.phone ? displayContact.value : '未绑定', color: 'var(--ylf-dopa-green)' },
    { icon: 'i-lucide-mail', label: '邮箱', value: u.email || '未绑定', color: 'var(--ylf-dopa-amber)' },
    { icon: 'i-lucide-calendar', label: '注册时间', value: joinDate.value || '未知', color: 'var(--ylf-dopa-blue)' },
  ].filter(Boolean) as { icon: string, label: string, value: string, color: string, multiline?: boolean }[]
  return rows
})
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
      <!-- 晴空 hero -->
      <SkyHero>
        <div class="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
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
              <p v-if="user.login" class="ylf-hero-shadow mt-0.5 text-sm text-white/85">
                @{{ user.login }}
              </p>
              <div class="ylf-hero-shadow mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                <span class="ylf-glass rounded-full px-2.5 py-1 font-medium text-white">
                  {{ user.role === 'ADMIN' ? '管理员' : '普通用户' }}
                </span>
                <span
                  v-if="isMember"
                  class="ylf-glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-white"
                >
                  <UIcon name="i-lucide-cloud" class="size-3" />
                  会员 · 至 {{ formatExpire(membershipState?.expireAt) }}
                </span>
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
            class="ylf-glass-btn shrink-0 self-start rounded-full sm:self-auto"
          />
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

      <!-- 基本信息 -->
      <section class="ylf-card rounded-3xl p-6">
        <h2 class="ylf-dreamy-display mb-4 text-xl text-highlighted">
          基本信息
        </h2>
        <div class="divide-y divide-default">
          <div
            v-for="row in infoRows"
            :key="row.label"
            class="flex items-start justify-between gap-3 py-3"
          >
            <div class="flex shrink-0 items-center gap-3">
              <span
                class="ylf-dopa-tile inline-flex size-8 items-center justify-center rounded-lg"
                :style="{ '--tile': row.color }"
              >
                <UIcon :name="row.icon" class="size-4" />
              </span>
              <span class="text-sm text-muted">{{ row.label }}</span>
            </div>
            <span
              class="text-right text-sm font-medium text-highlighted"
              :class="row.multiline ? 'max-w-xs whitespace-pre-wrap' : ''"
            >{{ row.value }}</span>
          </div>

          <!-- 用户 ID -->
          <div class="flex items-center justify-between gap-3 py-3">
            <div class="flex items-center gap-3">
              <span class="ylf-dopa-tile inline-flex size-8 items-center justify-center rounded-lg" :style="{ '--tile': 'var(--ylf-dopa-blue)' }">
                <UIcon name="i-lucide-shield" class="size-4" />
              </span>
              <span class="text-sm text-muted">用户 ID</span>
            </div>
            <span class="truncate font-mono text-sm text-dimmed">{{ user.id }}</span>
          </div>
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

      <!-- 快捷操作 -->
      <section class="ylf-card rounded-3xl p-6">
        <h2 class="ylf-dreamy-display mb-4 text-xl text-highlighted">
          快捷操作
        </h2>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UButton to="/wallet" label="我的钱包" icon="i-lucide-wallet" color="neutral" variant="outline" block />
          <UButton to="/apps" label="我的应用" icon="i-lucide-box" color="neutral" variant="outline" block />
          <UButton to="/settings" label="账户设置" icon="i-lucide-settings" color="neutral" variant="outline" block />
          <UButton to="/settings?tab=security" label="安全设置" icon="i-lucide-lock" color="neutral" variant="outline" block />
        </div>
      </section>
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
</style>
