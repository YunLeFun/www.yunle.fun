<script setup lang="ts">
import type { AppRecord } from '~/types/app'

definePageMeta({ layout: 'default' })

const route = useRoute()
const { user, loading: authLoading } = useTcbAuth()
const { getMyAppBySlug, updateApp, isSlugTaken } = useApps()
const toast = useAppToast()
const router = useRouter()

const slug = computed(() => route.params.slug as string)
const appData = ref<AppRecord | null>(null)
const loading = ref(true)
const saving = ref(false)
const slugError = ref('')

const form = reactive({
  name: '',
  slug: '',
  description: '',
  githubRepo: '',
  websiteUrl: '',
  backupUrl: '',
  isPublic: true,
})

// 登录守卫：会话就绪后仍未登录才跳登录（双层会话 cookie 恢复窗口内不误跳）
useRequireAuth()

onMounted(async () => {
  try {
    const data = await getMyAppBySlug(slug.value)
    if (!data) {
      toast.add({ title: '应用不存在', color: 'error' })
      router.push('/apps')
      return
    }
    // 验证所有权
    if (user.value?.id !== data.ownerId) {
      toast.add({ title: '无权编辑此应用', color: 'error' })
      router.push(`/apps/${slug.value}`)
      return
    }
    appData.value = data
    form.name = data.name
    form.slug = data.slug
    form.description = data.description || ''
    form.githubRepo = data.githubRepo || ''
    form.websiteUrl = data.websiteUrl || ''
    form.backupUrl = data.backupUrl || ''
    form.isPublic = data.isPublic
  }
  catch (err) {
    console.error('加载应用失败:', err)
  }
  finally {
    loading.value = false
  }
})

useSeoMeta({
  title: computed(() => appData.value ? `编辑 ${appData.value.name} - YunLeFun` : '编辑应用 - YunLeFun'),
})

const SLUG_REGEX = /^[a-z][a-z0-9-]{1,49}$/

async function handleSubmit() {
  if (!appData.value)
    return

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

    // 如果 slug 变化了，检查唯一性
    if (form.slug !== appData.value.slug) {
      const taken = await isSlugTaken(form.slug)
      if (taken) {
        slugError.value = '此标识符已被使用'
        return
      }
    }

    await updateApp(appData.value._id, {
      name: form.name.trim(),
      slug: form.slug,
      description: form.description.trim(),
      githubRepo: form.githubRepo.trim(),
      websiteUrl: form.websiteUrl.trim(),
      backupUrl: form.backupUrl.trim(),
      isPublic: form.isPublic,
    })

    toast.add({ title: '保存成功', description: '应用信息已更新', color: 'success' })
    router.push(`/apps/${form.slug}`)
  }
  catch (err: unknown) {
    toast.add({
      title: '保存失败',
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
    <div v-if="authLoading || loading" class="flex justify-center py-20">
      <UIcon name="i-lucide-loader-2" class="text-3xl text-muted animate-spin" />
    </div>

    <div v-else-if="appData" class="max-w-xl mx-auto space-y-6">
      <!-- 导航 -->
      <div class="flex items-center gap-3">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          :to="`/apps/${slug}`"
        />
        <h1 class="text-2xl font-bold">
          编辑应用
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
              @input="slugError = ''"
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
            <GitHubRepoField v-model="form.githubRepo" />
          </UFormField>

          <!-- 网页链接 -->
          <UFormField label="网页链接" hint="应用的官方网站地址">
            <UInput
              v-model="form.websiteUrl"
              placeholder="https://example.com"
              icon="i-lucide-globe"
              class="w-full"
            />
          </UFormField>

          <!-- 备用链接 -->
          <UFormField label="备用链接" hint="可选">
            <UInput
              v-model="form.backupUrl"
              placeholder="https://mirror.example.com"
              icon="i-lucide-link"
              class="w-full"
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
              :to="`/apps/${slug}`"
              label="取消"
              color="neutral"
              variant="outline"
            />
            <UButton
              type="submit"
              label="保存修改"
              icon="i-lucide-check"
              color="primary"
              :loading="saving"
            />
          </div>
        </form>
      </UPageCard>
    </div>
  </UContainer>
</template>
