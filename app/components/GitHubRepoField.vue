<script setup lang="ts">
import type { GitHubAppRepo } from '~/composables/useGitHubApp'
import { ChevronsUpDownIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'

/**
 * 应用「GitHub 仓库」字段：连接 GitHub App 后可下拉选择（含私有仓库），
 * 未连接则回退到 GitHubRepoInput 的匿名公开仓库校验 + 一个「连接」入口。
 */
interface Props {
  modelValue?: string
  placeholder?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'owner/repo',
  disabled: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const toast = useAppToast()
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
const repos = ref<GitHubAppRepo[]>([])
const repoPickerOpen = shallowRef(false)
const selectedValue = computed({
  get: () => props.modelValue || '',
  set: value => emit('update:modelValue', String(value || '')),
})

const repoItems = computed<RepoItem[]>(() =>
  repos.value.map(r => ({
    label: r.fullName,
    value: r.fullName,
    private: r.private,
    language: r.language,
    stargazers: r.stargazers,
  })),
)

onMounted(async () => {
  await refreshConnection()
  if (isConnected.value)
    loadRepos() // 已连接则预拉一次，打开下拉即有数据
})

// 每次都重新拉取（不做一次性缓存），避免在 GitHub 改了授权范围后列表陈旧
async function loadRepos() {
  if (reposLoading.value)
    return
  reposLoading.value = true
  try {
    const { repos: list } = await listRepos()
    repos.value = list
  }
  catch (err: any) {
    toast.add({ title: '获取仓库失败', description: err?.message, color: 'error' })
    // 后端可能已自愈清理失效映射 → 同步连接态（失效则回到「连接」入口）
    await refreshConnection()
  }
  finally {
    reposLoading.value = false
  }
}

function handleRepoPickerOpen(open: boolean) {
  repoPickerOpen.value = open
  if (open)
    void loadRepos()
}

function onPick(item: RepoItem) {
  selectedValue.value = item.value
  repoPickerOpen.value = false
}

async function onConnect() {
  try {
    connecting.value = true
    await connect()
    manual.value = false
    await loadRepos()
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
      <Popover :open="repoPickerOpen" @update:open="handleRepoPickerOpen">
        <PopoverTrigger as-child>
          <Button variant="outline" class="w-full justify-between font-normal" :disabled="disabled">
            <span v-if="modelValue" class="truncate font-mono">{{ modelValue }}</span>
            <span v-else class="text-muted-foreground">{{ placeholder }}</span>
            <Spinner v-if="reposLoading" />
            <ChevronsUpDownIcon v-else class="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" class="w-(--reka-popover-trigger-width) p-0">
          <Command v-model="selectedValue">
            <CommandInput placeholder="搜索仓库..." />
            <CommandList>
              <CommandEmpty>
                没有可选仓库（检查 App 的仓库授权范围）
              </CommandEmpty>
              <CommandGroup>
                <CommandItem
                  v-for="item in repoItems"
                  :key="item.value"
                  :value="item.value"
                  @select="onPick(item)"
                >
                  <Icon name="i-lucide-book-marked" class="shrink-0 text-muted" />
                  <span class="flex-1 truncate font-mono text-sm">{{ item.label }}</span>
                  <AppBadge v-if="item.private" color="warning" variant="subtle">
                    私有
                  </AppBadge>
                  <span v-if="item.language" class="shrink-0 text-xs text-muted">{{ item.language }}</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div class="flex items-center gap-3 text-xs text-muted">
        <span class="flex items-center gap-1">
          <Icon name="i-ri-github-fill" />
          已连接 {{ githubLogin }}
        </span>
        <AppButton type="button" variant="link" size="xs" @click="manual = true">
          手动输入
        </AppButton>
        <AppButton type="button" color="error" variant="link" size="xs" @click="onDisconnect">
          断开
        </AppButton>
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
        <AppButton
          v-if="!isConnected"
          size="xs"
          color="neutral"
          variant="subtle"
          icon="i-ri-github-fill"
          :loading="connecting"
          label="连接 GitHub 选择私有仓库"
          @click="onConnect"
        />
        <AppButton v-else type="button" variant="link" size="xs" @click="manual = false">
          返回仓库列表
        </AppButton>
      </div>
    </template>
  </div>
</template>
