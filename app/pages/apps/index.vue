<script setup lang="ts">
import type { AppRecord } from '~/types/app'
import { isOfficialUser } from '~/config'

definePageMeta({ layout: 'default' })
useSeoMeta({ title: '我的应用 - YunLeFun', description: '管理您发布的应用' })

const { user, loading: authLoading } = useTcbAuth()
const { getMyApps } = useApps()

// 登录守卫：会话就绪后仍未登录才跳登录（双层会话 cookie 恢复窗口内不误跳）
useRequireAuth('/apps')

// 开发者平台未上线，仅官方账号可自助发布应用
const canCreate = computed(() => isOfficialUser(user.value))

const apps = ref<AppRecord[]>([])
const loading = ref(true)

// 会话就绪后再拉「我的应用」（公开路由不经中间件恢复登录态，需自行等待）
onUserSession(async () => {
  try {
    apps.value = await getMyApps()
  }
  catch (err) {
    console.error('加载应用列表失败:', err)
  }
  finally {
    loading.value = false
  }
})

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function audienceLabel(item: AppRecord) {
  if (item.audience === 'workshop')
    return '坊客专属'
  if (item.audience === 'owner')
    return '仅自己'
  return '主页公开'
}

function appManagementHref(item: AppRecord) {
  return `https://apps.yunle.fun/workshop/${encodeURIComponent(item.slug)}`
}
</script>

<template>
  <AppContainer class="py-10 sm:py-12">
    <div v-if="authLoading || loading" class="flex justify-center py-20">
      <Icon name="i-lucide-loader-2" class="text-3xl text-muted animate-spin" />
    </div>

    <div v-else class="max-w-4xl mx-auto space-y-6">
      <!-- 页面标题 -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-2xl font-bold">
            我的应用
          </h1>
          <p class="mt-1 text-sm text-muted">
            管理发布到云乐坊的应用入口和链接信息
          </p>
        </div>
        <AppButton
          v-if="canCreate"
          to="https://apps.yunle.fun/workshop/new"
          label="创建应用"
          icon="i-lucide-plus"
          color="primary"
          class="self-start sm:self-auto"
        />
      </div>

      <!-- 空状态 -->
      <div v-if="apps.length === 0" class="ylf-empty-state rounded-lg px-4 py-16 text-center">
        <Icon name="i-lucide-package" class="text-5xl text-muted mb-4" />
        <template v-if="canCreate">
          <p class="text-lg text-muted mb-2">
            还没有发布任何应用
          </p>
          <p class="text-sm text-muted mb-6">
            创建你的第一个应用，像管理 GitHub 仓库一样管理它们
          </p>
          <AppButton
            to="https://apps.yunle.fun/workshop/new"
            label="创建第一个应用"
            icon="i-lucide-plus"
            color="primary"
            variant="subtle"
          />
        </template>
        <template v-else>
          <p class="text-lg text-muted mb-2">
            开发者发布功能即将开放
          </p>
          <p class="text-sm text-muted">
            目前仅上架官方开发的应用，自助发布敬请期待 🚧
          </p>
        </template>
      </div>

      <!-- 应用列表 -->
      <div v-else class="space-y-3">
        <NuxtLink
          v-for="item in apps"
          :key="item._id"
          :to="appManagementHref(item)"
          class="block rounded-lg"
        >
          <div class="ylf-interactive-card group flex items-start gap-4 rounded-lg p-4">
            <!-- 图标 -->
            <div class="ylf-icon-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-md">
              <img
                v-if="item.icon || item.logo"
                :src="item.icon || item.logo"
                :alt="item.name"
                class="h-8 w-8 rounded"
              >
              <span v-else-if="item.emoji" class="text-2xl leading-none">{{ item.emoji }}</span>
              <Icon v-else name="i-lucide-box" class="text-xl text-muted" />
            </div>

            <!-- 信息 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-semibold text-default group-hover:text-primary transition-colors truncate">
                  {{ item.name }}
                </span>
                <AppBadge
                  :label="audienceLabel(item)"
                  :color="item.audience === 'public' || (!item.audience && item.isPublic) ? 'success' : 'neutral'"
                  variant="subtle"
                  size="xs"
                />
              </div>
              <p v-if="item.description" class="text-sm text-muted truncate mb-2">
                {{ item.description }}
              </p>
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span class="font-mono">{{ item.slug }}</span>
                <span v-if="item.githubRepo" class="flex items-center gap-1">
                  <Icon name="i-ri-github-fill" class="text-sm" />
                  {{ item.githubRepo }}
                </span>
                <span>更新于 {{ formatDate(item.updatedAt) }}</span>
              </div>
            </div>

            <!-- 箭头 -->
            <Icon
              name="i-lucide-chevron-right"
              class="text-lg text-muted group-hover:text-primary transition-colors shrink-0 mt-1"
            />
          </div>
        </NuxtLink>
      </div>
    </div>
  </AppContainer>
</template>
