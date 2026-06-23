<script setup lang="ts">
import type { GitHubAppRepo } from '~/composables/useGitHubApp'

/**
 * 应用「GitHub 仓库」字段：连接 GitHub App 后可下拉选择（含私有仓库），
 * 未连接则回退到 GitHubRepoInput 的匿名公开仓库校验 + 一个「连接」入口。
 */
interface Props {
  modelValue?: string
  placeholder?: string
  disabled?: boolean
}

withDefaults(defineProps<Props>(), {
  placeholder: 'owner/repo',
  disabled: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const toast = useToast()
const { isConnected, githubLogin, refreshConnection, listRepos, connect, disconnect } = useGitHubApp()

interface RepoItem {
  label: string
  value: string
  private: boolean
  language: string | null
  stargazers: number
}

const manual = ref(false) // 已连接时也允许切回手动输入
const connecting = ref(false)
const reposLoading = ref(false)
const reposLoaded = ref(false)
const repos = ref<GitHubAppRepo[]>([])
const selected = ref<RepoItem | undefined>(undefined)

const repoItems = computed<RepoItem[]>(() =>
  repos.value.map(r => ({
    label: r.fullName,
    value: r.fullName,
    private: r.private,
    language: r.language,
    stargazers: r.stargazers,
  })),
)

onMounted(() => {
  refreshConnection()
})

async function ensureRepos() {
  if (reposLoaded.value || reposLoading.value)
    return
  reposLoading.value = true
  try {
    const { repos: list } = await listRepos()
    repos.value = list
    reposLoaded.value = true
  }
  catch (err: any) {
    toast.add({ title: '获取仓库失败', description: err?.message, color: 'error' })
  }
  finally {
    reposLoading.value = false
  }
}

function onPick(item: RepoItem | undefined) {
  if (!item)
    return
  emit('update:modelValue', item.value)
}

async function onConnect() {
  try {
    connecting.value = true
    await connect()
    manual.value = false
    reposLoaded.value = false
    await ensureRepos()
    toast.add({ title: '已连接 GitHub', color: 'success' })
  }
  catch (err: any) {
    if (err?.message !== '连接窗口已关闭')
      toast.add({ title: '连接失败', description: err?.message, color: 'error' })
  }
  finally {
    connecting.value = false
  }
}

async function onDisconnect() {
  try {
    await disconnect()
    repos.value = []
    reposLoaded.value = false
    toast.add({ title: '已断开 GitHub 连接', color: 'success' })
  }
  catch (err: any) {
    toast.add({ title: '断开失败', description: err?.message, color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-2">
    <!-- 已连接：仓库下拉选择（含私有仓库） -->
    <template v-if="isConnected && !manual">
      <USelectMenu
        v-model="selected"
        :items="repoItems"
        :loading="reposLoading"
        :disabled="disabled"
        :placeholder="placeholder"
        :search-input="{ placeholder: '搜索仓库...' }"
        label-key="label"
        class="w-full"
        @update:open="(open: boolean) => { if (open) ensureRepos() }"
        @update:model-value="onPick"
      >
        <template #default>
          <span v-if="modelValue" class="font-mono">{{ modelValue }}</span>
          <span v-else class="text-muted">{{ placeholder }}</span>
        </template>
        <template #item="{ item }">
          <div class="flex w-full items-center gap-2">
            <UIcon name="i-lucide-book-marked" class="shrink-0 text-muted" />
            <span class="flex-1 truncate font-mono text-sm">{{ (item as any).label }}</span>
            <UBadge v-if="(item as any).private" size="xs" color="warning" variant="subtle">
              私有
            </UBadge>
            <span v-if="(item as any).language" class="shrink-0 text-xs text-muted">{{ (item as any).language }}</span>
          </div>
        </template>
        <template #empty>
          <p class="py-2 text-center text-xs text-muted">
            没有可选仓库（检查 App 的仓库授权范围）
          </p>
        </template>
      </USelectMenu>

      <div class="flex items-center gap-3 text-xs text-muted">
        <span class="flex items-center gap-1">
          <UIcon name="i-simple-icons-github" />
          已连接 {{ githubLogin }}
        </span>
        <button type="button" class="hover:text-primary" @click="manual = true">
          手动输入
        </button>
        <button type="button" class="hover:text-error" @click="onDisconnect">
          断开
        </button>
      </div>
    </template>

    <!-- 未连接 / 手动：匿名校验输入 + 连接入口 -->
    <template v-else>
      <GitHubRepoInput
        :model-value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        @update:model-value="(v: string) => emit('update:modelValue', v)"
      />
      <div class="flex items-center gap-3 text-xs">
        <UButton
          v-if="!isConnected"
          size="xs"
          color="neutral"
          variant="subtle"
          icon="i-simple-icons-github"
          :loading="connecting"
          label="连接 GitHub 选择私有仓库"
          @click="onConnect"
        />
        <button v-else type="button" class="text-muted hover:text-primary" @click="manual = false">
          返回仓库列表
        </button>
      </div>
    </template>
  </div>
</template>
