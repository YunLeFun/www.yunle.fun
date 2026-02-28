<script setup lang="ts">
definePageMeta({ layout: 'default' })
useSeoMeta({ title: '创建应用 - YunLeFun', description: '创建一个新应用' })

const { user, isAuthenticated, loading: authLoading } = useTcbAuth()
const { createApp, isSlugTaken } = useApps()
const toast = useToast()
const router = useRouter()

watch(isAuthenticated, (value) => {
  if (!value && !authLoading.value) {
    router.push('/login?redirect=/apps/new')
  }
}, { immediate: true })

const saving = ref(false)
const slugError = ref('')
const form = reactive({
  name: '',
  slug: '',
  description: '',
  githubRepo: '',
  isPublic: true,
})

// 从绑定的 GitHub 身份中提取 login
const githubLogin = computed(() => {
  const ghIdentity = user.value?.identities?.find(i => user.value?.providers?.includes('github') && i.name)
  return ghIdentity?.name || ''
})

// 根据名称自动生成 slug
const autoSlug = ref(true)
const autoRepo = ref(true)

watch(() => form.name, (name) => {
  if (autoSlug.value) {
    form.slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\u4E00-\u9FFF-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)
  }
})

// slug 变化时自动更新 githubRepo 默认值
watch(() => form.slug, (slug) => {
  if (autoRepo.value && githubLogin.value && slug) {
    form.githubRepo = `${githubLogin.value}/${slug}`
  }
})

function onSlugInput() {
  autoSlug.value = false
  slugError.value = ''
}

function onRepoInput() {
  autoRepo.value = false
}

const SLUG_REGEX = /^[a-z][a-z0-9-]{1,49}$/

async function handleSubmit() {
  // 校验
  if (!form.name.trim()) {
    toast.add({ title: '请输入应用名称', color: 'error' })
    return
  }
  if (!SLUG_REGEX.test(form.slug)) {
    slugError.value = '标识符必须以小写字母开头，只能包含小写字母、数字和连字符，长度 2-50'
    return
  }

  try {
    saving.value = true

    // 检查 slug 唯一性
    const taken = await isSlugTaken(form.slug)
    if (taken) {
      slugError.value = '此标识符已被使用'
      return
    }

    await createApp({
      name: form.name.trim(),
      slug: form.slug,
      description: form.description.trim(),
      githubRepo: form.githubRepo.trim(),
      isPublic: form.isPublic,
    })

    toast.add({ title: '创建成功', description: '应用已创建', color: 'success' })
    router.push(`/apps/${form.slug}`)
  }
  catch (err: unknown) {
    toast.add({
      title: '创建失败',
      description: err instanceof Error ? err.message : '请稍后重试',
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UContainer class="py-12">
    <div v-if="authLoading" class="flex justify-center py-20">
      <UIcon name="i-lucide-loader-2" class="text-3xl text-muted animate-spin" />
    </div>

    <div v-else class="max-w-xl mx-auto space-y-6">
      <!-- 导航 -->
      <div class="flex items-center gap-3">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/apps"
        />
        <h1 class="text-2xl font-bold">
          创建新应用
        </h1>
      </div>

      <UPageCard class="p-6">
        <form class="space-y-5" @submit.prevent="handleSubmit">
          <!-- 名称 -->
          <UFormField label="应用名称" required>
            <UInput
              v-model="form.name"
              placeholder="我的应用"
              icon="i-lucide-box"
              class="w-full"
            />
          </UFormField>

          <!-- 标识符 -->
          <UFormField label="标识符" :error="slugError" required hint="唯一标识，用于 URL">
            <UInput
              v-model="form.slug"
              placeholder="my-app"
              icon="i-lucide-tag"
              class="w-full font-mono"
              @input="onSlugInput"
            />
          </UFormField>

          <!-- 描述 -->
          <UFormField label="描述">
            <UTextarea
              v-model="form.description"
              placeholder="简短描述你的应用..."
              :rows="3"
              class="w-full"
            />
          </UFormField>

          <!-- GitHub 仓库 -->
          <UFormField label="GitHub 仓库" hint="可选">
            <UInput
              v-model="form.githubRepo"
              :placeholder="githubLogin ? `${githubLogin}/repo-name` : 'owner/repo'"
              icon="i-simple-icons-github"
              class="w-full font-mono"
              @input="onRepoInput"
            />
          </UFormField>

          <!-- 是否公开 -->
          <div class="flex items-center justify-between py-2">
            <div>
              <p class="text-sm font-medium">
                公开应用
              </p>
              <p class="text-xs text-muted">
                公开后其他用户可以查看此应用
              </p>
            </div>
            <USwitch v-model="form.isPublic" />
          </div>

          <!-- 提交 -->
          <div class="flex justify-end gap-3 pt-2">
            <UButton
              to="/apps"
              label="取消"
              color="neutral"
              variant="outline"
            />
            <UButton
              type="submit"
              label="创建应用"
              icon="i-lucide-plus"
              color="primary"
              :loading="saving"
            />
          </div>
        </form>
      </UPageCard>
    </div>
  </UContainer>
</template>
