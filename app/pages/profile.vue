<script setup lang="ts">
import type { AppRecord } from '~/types/app'

definePageMeta({
  layout: 'default',
})

useSeoMeta({
  title: '个人中心 - YunLeFun',
  description: '管理您的个人信息',
})

const { user, isAuthenticated, loading } = useTcbAuth()
const { getMyApps } = useApps()
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
    return user.value.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
  }
  return user.value?.email || '未绑定'
})

// 我的应用
const myApps = ref<AppRecord[]>([])
const appsLoading = ref(true)

onMounted(async () => {
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
</script>

<template>
  <UContainer class="py-12">
    <div v-if="loading" class="flex justify-center py-20">
      <UIcon
        name="i-lucide-loader-2"
        class="text-3xl text-muted animate-spin"
      />
    </div>

    <div v-else-if="user" class="max-w-2xl mx-auto space-y-8">
      <!-- 页面标题 -->
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">
          个人中心
        </h1>
        <UButton
          to="/settings"
          label="编辑资料"
          icon="i-lucide-pencil"
          color="primary"
          variant="subtle"
        />
      </div>

      <!-- 用户卡片 -->
      <UPageCard class="p-6">
        <div class="flex items-center gap-6">
          <UAvatar
            :src="user.avatar || undefined"
            :alt="displayName"
            size="3xl"
          />
          <div class="flex-1 min-w-0 space-y-1">
            <h2 class="text-xl font-semibold truncate">
              {{ displayName }}
            </h2>
            <p
              v-if="user.login"
              class="text-sm text-muted"
            >
              @{{ user.login }}
            </p>
            <UBadge
              :label="user.role === 'ADMIN' ? '管理员' : '普通用户'"
              :color="user.role === 'ADMIN' ? 'error' : 'neutral'"
              variant="subtle"
              size="sm"
            />
          </div>
        </div>
      </UPageCard>

      <!-- 基本信息 -->
      <UPageCard class="p-6">
        <h3 class="text-lg font-semibold mb-4">
          基本信息
        </h3>

        <div class="divide-y divide-default">
          <div class="flex items-center justify-between py-3">
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-user" class="text-lg text-muted" />
              <span class="text-sm text-muted">昵称</span>
            </div>
            <span class="text-sm font-medium">{{ displayName }}</span>
          </div>

          <div class="flex items-center justify-between py-3">
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-smartphone" class="text-lg text-muted" />
              <span class="text-sm text-muted">手机号</span>
            </div>
            <span class="text-sm font-medium">
              {{ user.phone ? displayContact : '未绑定' }}
            </span>
          </div>

          <div class="flex items-center justify-between py-3">
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-mail" class="text-lg text-muted" />
              <span class="text-sm text-muted">邮箱</span>
            </div>
            <span class="text-sm font-medium">
              {{ user.email || '未绑定' }}
            </span>
          </div>

          <div class="flex items-center justify-between py-3">
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-calendar" class="text-lg text-muted" />
              <span class="text-sm text-muted">注册时间</span>
            </div>
            <span class="text-sm font-medium">
              {{ joinDate || '未知' }}
            </span>
          </div>

          <div class="flex items-center justify-between py-3">
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-shield" class="text-lg text-muted" />
              <span class="text-sm text-muted">用户 ID</span>
            </div>
            <span class="text-sm font-mono text-muted">
              {{ user.id }}
            </span>
          </div>
        </div>
      </UPageCard>

      <!-- 我的应用 -->
      <UPageCard class="p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">
            我的应用
          </h3>
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
          <UIcon name="i-lucide-loader-2" class="text-xl text-muted animate-spin" />
        </div>
        <div v-else-if="myApps.length === 0" class="text-center py-6">
          <p class="text-sm text-muted mb-3">
            还没有发布任何应用
          </p>
          <UButton
            to="/apps/new"
            label="创建应用"
            icon="i-lucide-plus"
            color="primary"
            variant="subtle"
            size="xs"
          />
        </div>
        <div v-else class="space-y-2">
          <NuxtLink
            v-for="item in myApps.slice(0, 5)"
            :key="item._id"
            :to="`/apps/${item.slug}`"
            class="flex items-center gap-3 p-3 rounded-lg hover:bg-elevated/50 transition-colors group"
          >
            <div class="shrink-0 w-8 h-8 rounded-md bg-elevated flex items-center justify-center">
              <img v-if="item.icon" :src="item.icon" :alt="item.name" class="w-6 h-6 rounded">
              <UIcon v-else name="i-lucide-box" class="text-base text-muted" />
            </div>
            <div class="flex-1 min-w-0">
              <span class="text-sm font-medium group-hover:text-primary transition-colors truncate block">{{ item.name }}</span>
              <span class="text-xs text-muted font-mono">{{ item.slug }}</span>
            </div>
            <span class="text-xs text-muted shrink-0">{{ formatAppDate(item.updatedAt) }}</span>
          </NuxtLink>
        </div>
      </UPageCard>

      <!-- 快捷操作 -->
      <UPageCard class="p-6">
        <h3 class="text-lg font-semibold mb-4">
          快捷操作
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UButton
            to="/apps"
            label="我的应用"
            icon="i-lucide-box"
            color="neutral"
            variant="outline"
            block
          />
          <UButton
            to="/settings"
            label="账户设置"
            icon="i-lucide-settings"
            color="neutral"
            variant="outline"
            block
          />
          <UButton
            to="/settings?tab=security"
            label="安全设置"
            icon="i-lucide-lock"
            color="neutral"
            variant="outline"
            block
          />
          <UButton
            to="/apps/new"
            label="创建应用"
            icon="i-lucide-plus"
            color="primary"
            variant="outline"
            block
          />
        </div>
      </UPageCard>
    </div>
  </UContainer>
</template>
