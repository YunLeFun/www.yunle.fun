<script setup lang="ts">
/**
 * GitHub 仓库输入框（无 token 依赖）
 *
 * 设计取向见 docs/server-responsibilities.md：`githubRepo` 仅作展示性链接，
 * 不需要 GitHub 实时数据，因此不依赖任何 OAuth access token（CloudBase 也不会
 * 持久回传该 token）。这里只做三件事：
 * 1. 手动输入 `owner/repo`（始终可用）
 * 2. 粘贴各种 GitHub URL 时自动归一化为 `owner/repo`
 * 3. 用**匿名** GitHub API 校验公开仓库是否存在（60 req/h/IP，单用户表单足够）
 *
 * 若将来要展示 stars / 最近提交 / 校验私有仓库，再走服务端 GitHub App token 代理
 * （server/api/github/**），不要回退到“代理用户 token”。
 */
interface Props {
  /** 当前值（owner/repo） */
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

/** 合法 owner/repo（宽松校验，足够拦截明显笔误） */
const RE_REPO = /^[\w.-]+\/[\w.-]+$/
/** 看起来像 URL / git 地址时才做归一化，避免干扰正常逐字输入 */
const RE_URLISH = /github\.com|git@|:\/\//i

type Status = 'idle' | 'invalid' | 'checking' | 'valid' | 'notfound' | 'unverified'

interface RepoMeta {
  fullName: string
  description: string | null
  language: string | null
  stars: number
  private: boolean
}

const local = ref(props.modelValue ?? '')
const status = ref<Status>('idle')
const repoMeta = ref<RepoMeta | null>(null)

/** 从粘贴的 GitHub URL / git 地址中提取 owner/repo */
function extractRepo(raw: string): string {
  const s = raw
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '')
  const parts = s.split('/').filter(Boolean)
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : s
}

/** 竞态守卫：仅最后一次校验可写回结果 */
let validateToken = 0
async function runValidate(value: string) {
  const id = ++validateToken
  repoMeta.value = null

  if (!value) {
    status.value = 'idle'
    return
  }
  if (!RE_REPO.test(value)) {
    status.value = 'invalid'
    return
  }

  status.value = 'checking'
  try {
    const data = await $fetch<{
      full_name: string
      description: string | null
      language: string | null
      stargazers_count: number
      private: boolean
    }>(`https://api.github.com/repos/${value}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (id !== validateToken)
      return
    repoMeta.value = {
      fullName: data.full_name,
      description: data.description,
      language: data.language,
      stars: data.stargazers_count,
      private: data.private,
    }
    status.value = 'valid'
  }
  catch (err: any) {
    if (id !== validateToken)
      return
    const code = err?.status ?? err?.statusCode ?? err?.response?.status
    // 404 = 公开仓库不存在（或为私有）；其余（限流 403 / 网络错误）标记为暂时无法校验，不阻断保存
    status.value = code === 404 ? 'notfound' : 'unverified'
  }
}

const debouncedValidate = useDebounceFn(runValidate, 500)

function onInput(value: string | number | null | undefined) {
  const input = String(value ?? '')
  const next = (RE_URLISH.test(input) ? extractRepo(input) : input).trim()
  local.value = next
  // 清除上一次结果，等防抖后重新校验：避免编辑时残留旧的 ✓，也避免对本地格式错误闪现 spinner
  status.value = 'idle'
  repoMeta.value = null
  emit('update:modelValue', next)
  debouncedValidate(next)
}

// 外部（父级自动填充）改值时同步并校验，但不回传，避免覆盖父级的自动填充开关
watch(() => props.modelValue, (value) => {
  const next = value ?? ''
  if (next !== local.value) {
    local.value = next
    debouncedValidate(next.trim())
  }
})

onMounted(() => {
  if (local.value)
    runValidate(local.value.trim())
})
</script>

<template>
  <div class="space-y-1.5">
    <AppInput
      :model-value="local"
      :placeholder="placeholder"
      :disabled="disabled"
      icon="i-ri-github-fill"
      class="w-full font-mono"
      @update:model-value="onInput"
    >
      <template #trailing>
        <Icon
          v-if="status === 'checking'"
          name="i-lucide-loader-circle"
          class="animate-spin text-muted"
        />
        <Icon
          v-else-if="status === 'valid'"
          name="i-lucide-check"
          class="text-success"
        />
        <Icon
          v-else-if="status === 'invalid'"
          name="i-lucide-alert-triangle"
          class="text-warning"
        />
        <Icon
          v-else-if="status === 'notfound' || status === 'unverified'"
          name="i-lucide-info"
          class="text-muted"
        />
      </template>
    </AppInput>

    <!-- 校验反馈（aria-live 让读屏软件能播报状态变化），min-h 占位避免抖动 -->
    <div class="min-h-4 text-xs" aria-live="polite">
      <!-- 格式错误 -->
      <p v-if="status === 'invalid'" class="text-warning">
        格式应为 <code class="font-mono">owner/repo</code>
      </p>

      <!-- 公开仓库未找到：可能是拼写错误，也可能是私有仓库（匿名无法校验，可直接保存） -->
      <p v-else-if="status === 'notfound'" class="text-muted">
        未找到公开仓库——若为私有仓库可忽略此提示（但访客将无法打开该链接）
      </p>

      <!-- 限流 / 网络问题：无法校验，但不阻断保存 -->
      <p v-else-if="status === 'unverified'" class="text-muted">
        暂时无法校验（GitHub 接口限流或网络问题），可直接保存
      </p>

      <!-- 校验通过：展示仓库信息 + 跳转链接 -->
      <a
        v-else-if="status === 'valid' && repoMeta"
        :href="`https://github.com/${repoMeta.fullName}`"
        target="_blank"
        rel="noopener noreferrer"
        class="group inline-flex max-w-full items-center gap-1.5 text-muted transition-colors hover:text-primary"
      >
        <Icon name="i-lucide-circle-check" class="shrink-0 text-success" />
        <span class="truncate">
          {{ repoMeta.fullName }}
          <template v-if="repoMeta.private"> · 私有</template>
          <template v-if="repoMeta.language"> · {{ repoMeta.language }}</template>
          <template v-if="repoMeta.stars"> · ★ {{ repoMeta.stars }}</template>
        </span>
        <Icon name="i-lucide-external-link" class="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </a>
    </div>
  </div>
</template>
