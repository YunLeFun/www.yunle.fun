<script setup lang="ts">
import type { AppRecord } from '~/types/app'
import { getAppDetailPath } from '~/utils/appRoutes'

const route = useRoute()
const { user } = useTcbAuth()
const { getAppBySlug, deleteApp: removeApp } = useApps()
const toast = useAppToast()
const router = useRouter()

const slug = computed(() => route.params.slug as string)
const appData = ref<AppRecord | null>(null)
const loading = ref(true)
const deleting = ref(false)
const showDeleteConfirm = ref(false)

const isOwner = computed(() => {
  if (!user.value || !appData.value)
    return false
  return user.value.id === (appData.value.ownerUid || appData.value.ownerId)
})
const ownerId = computed(() => appData.value?.ownerUid || appData.value?.ownerId)

useSeoMeta({
  title: computed(() => appData.value ? `${appData.value.name} - YunLeFun` : '应用 - YunLeFun'),
  description: computed(() => appData.value?.description || ''),
})

let loadSequence = 0
async function loadApp() {
  const sequence = ++loadSequence
  loading.value = true
  try {
    const isNew = route.query.new === '1'
    // 新创建的应用可能存在索引延迟，使用更长的重试
    const maxRetries = isNew ? 6 : 3
    const baseDelay = isNew ? 600 : 500

    for (let i = 0; i < maxRetries; i++) {
      const found = await getAppBySlug(slug.value, route.params.owner as string | undefined)
      if (sequence !== loadSequence)
        return
      appData.value = found
      if (appData.value)
        break
      if (i < maxRetries - 1)
        await new Promise(r => setTimeout(r, baseDelay * (i + 1)))
    }
    if (appData.value) {
      const canonicalPath = getAppDetailPath(appData.value)
      if (!route.params.owner && route.path !== canonicalPath)
        await router.replace({ path: canonicalPath, query: route.query, hash: route.hash })
    }
  }
  catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err)
      throw err
    console.error('加载应用失败:', err)
  }
  finally {
    if (sequence === loadSequence)
      loading.value = false
  }
}
onMounted(loadApp)
onUserSession(() => {
  if (route.params.owner)
    void loadApp()
})

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

async function handleDelete() {
  if (!appData.value)
    return
  try {
    deleting.value = true
    await removeApp(appData.value._id)
    toast.add({ title: '下架成功', description: '应用已下架，短名仍保留', color: 'success' })
    router.push('/apps')
  }
  catch (err: unknown) {
    toast.add({
      title: '下架失败',
      description: err instanceof Error ? err.message : '请稍后重试',
      color: 'error',
    })
  }
  finally {
    deleting.value = false
    showDeleteConfirm.value = false
  }
}
</script>

<template>
  <AppContainer class="py-10 sm:py-12">
    <div v-if="loading" class="flex justify-center py-20">
      <Icon name="i-lucide-loader-2" class="text-3xl text-muted animate-spin" />
    </div>

    <div v-else-if="!appData" class="ylf-empty-state rounded-lg px-4 py-20 text-center">
      <Icon name="i-lucide-package-x" class="text-5xl text-muted mb-4" />
      <p class="text-lg text-muted mb-4">
        应用不存在
      </p>
      <AppButton to="/apps" label="返回应用列表" icon="i-lucide-arrow-left" color="neutral" variant="outline" />
    </div>

    <div v-else class="max-w-3xl mx-auto space-y-6">
      <!-- 导航 -->
      <div class="flex items-center gap-2 text-sm text-muted">
        <NuxtLink to="/apps" class="hover:text-default transition-colors">
          应用
        </NuxtLink>
        <Icon name="i-lucide-chevron-right" class="text-xs" />
        <span class="text-default font-medium">{{ appData.name }}</span>
      </div>

      <!-- 头部 -->
      <div class="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div class="ylf-icon-tile flex h-16 w-16 shrink-0 items-center justify-center rounded-lg">
          <img
            v-if="appData.icon || appData.logo"
            :src="appData.icon || appData.logo"
            :alt="appData.name"
            class="h-12 w-12 rounded-md"
          >
          <span v-else-if="appData.emoji" class="text-4xl leading-none">{{ appData.emoji }}</span>
          <Icon v-else name="i-lucide-box" class="text-3xl text-muted" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="mb-1 flex flex-wrap items-center gap-3">
            <h1 class="text-2xl font-bold truncate">
              {{ appData.name }}
            </h1>
            <AppBadge
              :label="appData.isPublic ? '公开' : '私有'"
              :color="appData.isPublic ? 'success' : 'neutral'"
              variant="subtle"
              size="sm"
            />
          </div>
          <p class="text-sm text-muted font-mono">
            {{ appData.slug }}
          </p>
        </div>
        <!-- 操作按钮 -->
        <div v-if="isOwner" class="flex shrink-0 items-center gap-2">
          <AppButton
            :to="`/u/${encodeURIComponent(appData.ownerLogin.toLowerCase())}/apps/${encodeURIComponent(appData.slug)}/edit`"
            label="编辑"
            icon="i-lucide-pencil"
            color="primary"
            variant="subtle"
            size="sm"
          />
          <AppButton
            label="下架"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="sm"
            @click="showDeleteConfirm = true"
          />
        </div>
      </div>

      <!-- 投币支持 -->
      <AppPageCard class="ylf-surface p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="space-y-1">
            <p class="font-semibold">
              支持这个应用
            </p>
            <p class="text-sm text-muted">
              投币只花云币、不花真金，为你喜欢的应用打 call
            </p>
          </div>
          <AppTipButton :app="appData" />
        </div>
      </AppPageCard>

      <!-- 描述 -->
      <AppPageCard v-if="appData.description" class="ylf-surface p-5">
        <p class="text-sm leading-relaxed">
          {{ appData.description }}
        </p>
      </AppPageCard>

      <!-- 详细信息 -->
      <AppPageCard class="ylf-surface p-5">
        <h3 class="text-base font-semibold mb-4">
          应用信息
        </h3>
        <div class="divide-y divide-default">
          <div class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-3">
              <Icon name="i-lucide-tag" class="text-lg text-muted" />
              <span class="text-sm text-muted">标识符</span>
            </div>
            <span class="text-sm font-mono">{{ appData.slug }}</span>
          </div>

          <div class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-3">
              <Icon name="i-lucide-user" class="text-lg text-muted" />
              <span class="text-sm text-muted">所有者</span>
            </div>
            <div class="flex items-center gap-2">
              <NuxtLink
                :to="`/u/${appData.ownerLogin}`"
                class="text-sm font-medium text-primary hover:underline"
              >
                @{{ appData.ownerLogin }}
              </NuxtLink>
              <FollowButton v-if="!isOwner && ownerId" :target-id="ownerId" size="xs" />
            </div>
          </div>

          <div v-if="appData.githubRepo" class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-3">
              <Icon name="i-ri-github-fill" class="text-lg text-muted" />
              <span class="text-sm text-muted">GitHub 仓库</span>
            </div>
            <a
              :href="`https://github.com/${appData.githubRepo}`"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              {{ appData.githubRepo }}
              <Icon name="i-lucide-external-link" class="text-xs" />
            </a>
          </div>

          <div v-if="appData.websiteUrl" class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-3">
              <Icon name="i-lucide-globe" class="text-lg text-muted" />
              <span class="text-sm text-muted">网页链接</span>
            </div>
            <a
              :href="appData.websiteUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="flex max-w-full items-center gap-1 truncate text-sm font-medium text-primary hover:underline sm:max-w-xs"
            >
              {{ appData.websiteUrl }}
              <Icon name="i-lucide-external-link" class="text-xs shrink-0" />
            </a>
          </div>

          <div v-if="appData.backupUrl" class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-3">
              <Icon name="i-lucide-link" class="text-lg text-muted" />
              <span class="text-sm text-muted">备用链接</span>
            </div>
            <a
              :href="appData.backupUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="flex max-w-full items-center gap-1 truncate text-sm font-medium text-primary hover:underline sm:max-w-xs"
            >
              {{ appData.backupUrl }}
              <Icon name="i-lucide-external-link" class="text-xs shrink-0" />
            </a>
          </div>

          <div class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-3">
              <Icon name="i-lucide-calendar" class="text-lg text-muted" />
              <span class="text-sm text-muted">创建时间</span>
            </div>
            <span class="text-sm">{{ formatDate(appData.createdAt) }}</span>
          </div>

          <div class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-3">
              <Icon name="i-lucide-clock" class="text-lg text-muted" />
              <span class="text-sm text-muted">最近更新</span>
            </div>
            <span class="text-sm">{{ formatDate(appData.updatedAt) }}</span>
          </div>
        </div>
      </AppPageCard>

      <!-- 删除确认弹窗 -->
      <AppModal v-model:open="showDeleteConfirm" title="确认下架应用">
        <template #content>
          <div class="p-6 space-y-4">
            <h3 class="text-lg font-semibold text-error">
              确认下架应用
            </h3>
            <p class="text-sm text-muted">
              确定要下架应用 <strong>{{ appData.name }}</strong> 吗？应用短名仍会保留。
            </p>
            <div class="flex justify-end gap-3">
              <AppButton
                label="取消"
                color="neutral"
                variant="outline"
                @click="showDeleteConfirm = false"
              />
              <AppButton
                label="确认下架"
                color="error"
                :loading="deleting"
                @click="handleDelete"
              />
            </div>
          </div>
        </template>
      </AppModal>
    </div>
  </AppContainer>
</template>
