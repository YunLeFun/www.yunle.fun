<script setup lang="ts">
import type { AppRecord } from '~/types/app'

definePageMeta({ layout: 'default' })
useSeoMeta({ title: '我的应用 - YunLeFun', description: '管理您发布的应用' })

const { user, isAuthenticated, loading: authLoading } = useTcbAuth()
const { getMyApps } = useApps()
const router = useRouter()

const apps = ref<AppRecord[]>([])
const loading = ref(true)

watch(isAuthenticated, (value) => {
  if (!value && !authLoading.value) {
    router.push('/login?redirect=/apps')
  }
}, { immediate: true })

onMounted(async () => {
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
</script>

<template>
  <UContainer class="py-12">
    <div v-if="authLoading || loading" class="flex justify-center py-20">
      <UIcon name="i-lucide-loader-2" class="text-3xl text-muted animate-spin" />
    </div>

    <div v-else class="max-w-4xl mx-auto space-y-6">
      <!-- 页面标题 -->
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">
          我的应用
        </h1>
        <UButton
          to="/apps/new"
          label="创建应用"
          icon="i-lucide-plus"
          color="primary"
        />
      </div>

      <!-- 空状态 -->
      <div v-if="apps.length === 0" class="text-center py-16">
        <UIcon name="i-lucide-package" class="text-5xl text-muted mb-4" />
        <p class="text-lg text-muted mb-2">
          还没有发布任何应用
        </p>
        <p class="text-sm text-muted mb-6">
          创建你的第一个应用，像管理 GitHub 仓库一样管理它们
        </p>
        <UButton
          to="/apps/new"
          label="创建第一个应用"
          icon="i-lucide-plus"
          color="primary"
          variant="subtle"
        />
      </div>

      <!-- 应用列表 -->
      <div v-else class="space-y-3">
        <NuxtLink
          v-for="item in apps"
          :key="item._id"
          :to="`/apps/${item.slug}`"
          class="block"
        >
          <div class="group flex items-start gap-4 p-4 rounded-xl border border-default hover:border-primary/40 bg-default hover:bg-elevated/50 transition-all">
            <!-- 图标 -->
            <div class="shrink-0 w-10 h-10 rounded-lg bg-elevated flex items-center justify-center">
              <img
                v-if="item.icon"
                :src="item.icon"
                :alt="item.name"
                class="w-8 h-8 rounded"
              >
              <UIcon v-else name="i-lucide-box" class="text-xl text-muted" />
            </div>

            <!-- 信息 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-semibold text-default group-hover:text-primary transition-colors truncate">
                  {{ item.name }}
                </span>
                <UBadge
                  :label="item.isPublic ? '公开' : '私有'"
                  :color="item.isPublic ? 'success' : 'neutral'"
                  variant="subtle"
                  size="xs"
                />
              </div>
              <p v-if="item.description" class="text-sm text-muted truncate mb-2">
                {{ item.description }}
              </p>
              <div class="flex items-center gap-4 text-xs text-muted">
                <span class="font-mono">{{ item.slug }}</span>
                <span v-if="item.githubRepo" class="flex items-center gap-1">
                  <UIcon name="i-simple-icons-github" class="text-sm" />
                  {{ item.githubRepo }}
                </span>
                <span>更新于 {{ formatDate(item.updatedAt) }}</span>
              </div>
            </div>

            <!-- 箭头 -->
            <UIcon
              name="i-lucide-chevron-right"
              class="text-lg text-muted group-hover:text-primary transition-colors shrink-0 mt-1"
            />
          </div>
        </NuxtLink>
      </div>
    </div>
  </UContainer>
</template>
