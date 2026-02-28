<script setup lang="ts">
import type { RepoOwner, RepoSelectorOption } from '~/types/github'

interface Props {
  /** 当前选中的仓库 */
  modelValue?: string
  /** 占位符文本 */
  placeholder?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 是否显示手动输入选项 */
  showManualInput?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: string): void
  (e: 'select', repo: RepoSelectorOption | null): void
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '选择或搜索仓库...',
  disabled: false,
  showManualInput: true,
})

const emit = defineEmits<Emits>()

const {
  loading,
  error,
  isGitHubConnected,
  currentOwner,
  currentRepos,
  ownerOptions,
  switchOwner,
  searchRepos,
  reposToOptions,
  initialize,
} = useGitHubRepos()

// 本地状态
const isOpen = ref(false)
const searchQuery = ref('')
const selectedRepo = ref<RepoSelectorOption | undefined>(undefined)
const showManualMode = ref(false)
const manualInput = ref('')

// 搜索结果
const filteredRepos = computed(() => {
  const repos = searchQuery.value ? searchRepos(searchQuery.value) : currentRepos.value
  return reposToOptions(repos).slice(0, 50) // 限制显示数量以提升性能
})

// 是否显示未连接状态
const showNotConnected = computed(() => {
  return !isGitHubConnected.value
})

// 监听外部值变化
watch(() => props.modelValue, (newValue) => {
  if (newValue && newValue !== selectedRepo.value?.value) {
    // 尝试从当前仓库列表中找到匹配项
    const found = filteredRepos.value.find(repo => repo.value === newValue)
    if (found) {
      selectedRepo.value = found
      showManualMode.value = false
    }
    else {
      // 如果没找到，可能是手动输入的值
      manualInput.value = newValue
      selectedRepo.value = undefined
      showManualMode.value = true
    }
  }
  else if (!newValue) {
    selectedRepo.value = undefined
    manualInput.value = ''
    showManualMode.value = false
  }
}, { immediate: true })

// 监听手动输入值变化
watch(manualInput, (newValue) => {
  if (showManualMode.value) {
    emit('update:modelValue', newValue)
  }
})

/**
 * 处理仓库选择
 */
function handleRepoSelect(repo: any) {
  if (!repo)
    return
  selectedRepo.value = repo as RepoSelectorOption
  showManualMode.value = false
  manualInput.value = ''
  searchQuery.value = ''
  isOpen.value = false

  emit('update:modelValue', repo.value)
  emit('select', repo)
}

/**
 * 处理拥有者切换
 */
async function handleOwnerSwitch(owner: RepoOwner) {
  try {
    await switchOwner(owner)
    searchQuery.value = '' // 清空搜索
  }
  catch (err) {
    console.error('切换拥有者失败:', err)
  }
}

/**
 * 切换到手动输入模式
 */
function switchToManualMode() {
  showManualMode.value = true
  selectedRepo.value = undefined
  manualInput.value = props.modelValue || ''
  isOpen.value = false
}

/**
 * 切换到选择模式
 */
function switchToSelectMode() {
  showManualMode.value = false
  manualInput.value = ''

  // 如果当前值在仓库列表中，自动选中
  if (props.modelValue) {
    const found = filteredRepos.value.find(repo => repo.value === props.modelValue)
    if (found) {
      selectedRepo.value = found
    }
  }
}

/**
 * 处理下拉框打开
 */
async function handleOpen() {
  if (!isGitHubConnected.value)
    return

  isOpen.value = true

  // 如果还没有初始化数据，则初始化
  if (ownerOptions.value.length === 0) {
    await initialize()
  }
}

/**
 * 清除选择
 */
function clearSelection() {
  selectedRepo.value = undefined
  manualInput.value = ''
  showManualMode.value = false
  searchQuery.value = ''

  emit('update:modelValue', '')
  emit('select', null)
}

/**
 * 格式化仓库描述
 */
function formatRepoDescription(repo: RepoSelectorOption): string {
  const parts: string[] = []

  if (repo.language) {
    parts.push(repo.language)
  }

  if (repo.private) {
    parts.push('私有')
  }

  if (repo.description) {
    parts.push(repo.description)
  }

  return parts.join(' • ')
}
</script>

<template>
  <div class="github-repo-selector">
    <!-- GitHub 未连接状态 -->
    <div v-if="showNotConnected" class="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
      <UIcon name="i-lucide-alert-triangle" class="text-amber-600 dark:text-amber-400 text-lg shrink-0" />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
          未绑定 GitHub 账号
        </p>
        <p class="text-xs text-amber-600 dark:text-amber-400 mt-1">
          绑定 GitHub 账号后可以直接选择已有仓库
        </p>
      </div>
      <UButton
        to="/settings"
        size="xs"
        color="warning"
        variant="outline"
        label="去绑定"
        icon="i-lucide-external-link"
      />
    </div>

    <!-- 主选择器 -->
    <div v-else class="space-y-3">
      <!-- 模式切换 -->
      <div v-if="showManualInput" class="flex items-center gap-2">
        <UButton
          :variant="!showManualMode ? 'solid' : 'outline'"
          :color="!showManualMode ? 'primary' : 'neutral'"
          size="xs"
          icon="i-lucide-search"
          label="选择仓库"
          @click="switchToSelectMode"
        />
        <UButton
          :variant="showManualMode ? 'solid' : 'outline'"
          :color="showManualMode ? 'primary' : 'neutral'"
          size="xs"
          icon="i-lucide-edit"
          label="手动输入"
          @click="switchToManualMode"
        />
      </div>

      <!-- 手动输入模式 -->
      <UInput
        v-if="showManualMode"
        v-model="manualInput"
        :placeholder="placeholder"
        :disabled="disabled"
        icon="i-simple-icons-github"
        class="font-mono"
      />

      <!-- 选择模式 -->
      <div v-else class="space-y-2">
        <!-- 拥有者切换 -->
        <div v-if="ownerOptions.length > 1" class="flex items-center gap-2">
          <span class="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            切换拥有者:
          </span>
          <div class="flex items-center gap-1 flex-wrap">
            <UButton
              v-for="owner in ownerOptions"
              :key="`${owner.type}-${owner.login}`"
              :variant="currentOwner?.login === owner.login ? 'solid' : 'outline'"
              :color="currentOwner?.login === owner.login ? 'primary' : 'neutral'"
              size="xs"
              @click="handleOwnerSwitch(owner)"
            >
              <template #leading>
                <img
                  :src="owner.avatarUrl"
                  :alt="owner.name"
                  class="w-3 h-3 rounded-full"
                >
              </template>
              {{ owner.login }}
              <UBadge
                v-if="owner.type === 'organization'"
                size="xs"
                color="info"
                variant="subtle"
                class="ml-1"
              >
                组织
              </UBadge>
            </UButton>
          </div>
        </div>

        <!-- 仓库选择器 -->
        <USelectMenu
          v-model="selectedRepo"
          :items="filteredRepos"
          :loading="loading"
          :disabled="disabled"
          :placeholder="placeholder"
          :search-input="{ placeholder: '搜索仓库...' }"
          label-key="label"
          @update:open="(v: boolean) => { if (v) handleOpen() }"
          @update:model-value="handleRepoSelect"
        >
          <template #default="{ modelValue: selectedValue }">
            <div v-if="selectedValue" class="flex items-center gap-2">
              <UIcon :name="selectedRepo?.icon || 'i-lucide-book-open'" class="text-sm" />
              <span class="font-mono">{{ selectedRepo?.value }}</span>
            </div>
            <span v-else class="text-gray-500 dark:text-gray-400">
              {{ placeholder }}
            </span>
          </template>

          <template #item="{ item }">
            <div class="flex items-center gap-3 w-full">
              <UIcon :name="(item as any).icon || 'i-lucide-book-open'" class="text-sm shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium font-mono text-sm">{{ (item as any).label }}</span>
                  <UBadge
                    v-if="(item as any).private"
                    size="xs"
                    color="warning"
                    variant="subtle"
                  >
                    私有
                  </UBadge>
                </div>
                <p
                  v-if="formatRepoDescription(item as any)"
                  class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5"
                >
                  {{ formatRepoDescription(item as any) }}
                </p>
              </div>
            </div>
          </template>

          <template #empty="{ searchTerm }">
            <div class="flex flex-col items-center gap-2 py-6 text-center">
              <UIcon name="i-lucide-search-x" class="text-2xl text-gray-400" />
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                  未找到仓库
                </p>
                <p v-if="searchTerm" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  没有找到包含 "{{ searchTerm }}" 的仓库
                </p>
              </div>
            </div>
          </template>
        </USelectMenu>

        <!-- 清除按钮 -->
        <div v-if="selectedRepo" class="flex justify-end">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            label="清除选择"
            @click="clearSelection"
          />
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <UIcon name="i-lucide-alert-circle" class="text-red-600 dark:text-red-400 text-sm shrink-0" />
        <p class="text-xs text-red-700 dark:text-red-300">
          {{ error }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.github-repo-selector {
  @apply w-full;
}
</style>
