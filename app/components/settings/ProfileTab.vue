<script setup lang="ts">
import type { UpdateUserReq } from '@cloudbase/auth'

const { user, fetchUser, setUsername } = useTcbAuth()
const toast = useToast()

const editing = ref(false)
const saving = ref(false)
const form = reactive({
  nickname: '',
  avatar: '',
})

// 头像上传相关
const avatarInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadProgress = ref(0)

const AVATAR_MAX_SIZE = 2 * 1024 * 1024 // 2MB
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp'

function triggerAvatarUpload() {
  avatarInput.value?.click()
}

async function handleAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file)
    return

  // 校验文件大小
  if (file.size > AVATAR_MAX_SIZE) {
    toast.add({ title: '文件过大', description: '头像图片不能超过 2MB', color: 'error' })
    input.value = ''
    return
  }

  // 校验文件类型
  if (!file.type.startsWith('image/')) {
    toast.add({ title: '格式错误', description: '请选择图片文件', color: 'error' })
    input.value = ''
    return
  }

  try {
    uploading.value = true
    uploadProgress.value = 0

    const { app } = useCloudbase()
    const ext = file.name.split('.').pop() || 'jpg'
    const cloudPath = `avatars/${user.value!.id}_${Date.now()}.${ext}`

    // 上传到云存储
    const { fileID } = await app.uploadFile({
      cloudPath,
      filePath: file as any,
      onUploadProgress: (event: { loaded: number, total: number }) => {
        uploadProgress.value = Math.round((event.loaded / event.total) * 100)
      },
    })

    // 获取临时访问 URL
    const urlResult = await app.getTempFileURL({ fileList: [fileID] })
    const tempUrl = urlResult.fileList?.[0]?.tempFileURL
    if (!tempUrl)
      throw new Error('获取头像地址失败')

    form.avatar = tempUrl
    toast.add({ title: '上传成功', description: '头像已上传，点击保存生效', color: 'success' })
  }
  catch (err: unknown) {
    console.error('上传头像失败:', err)
    toast.add({
      title: '上传失败',
      description: err instanceof Error ? err.message : '请稍后重试',
      color: 'error',
    })
  }
  finally {
    uploading.value = false
    uploadProgress.value = 0
    input.value = ''
  }
}

// 用户名设置相关
const showUsernameModal = ref(false)
const usernameInput = ref('')
const settingUsername = ref(false)
const usernameError = ref('')

// 用户名是否已设置（不可修改）
const hasUsername = computed(() => !!user.value?.login)

// 用户名格式校验
const usernameRules = {
  pattern: /^[a-z][\w-]{2,19}$/i,
  minLength: 3,
  maxLength: 20,
}

function validateUsername(value: string): string {
  if (!value)
    return '请输入用户名'
  if (value.length < usernameRules.minLength)
    return `用户名至少 ${usernameRules.minLength} 个字符`
  if (value.length > usernameRules.maxLength)
    return `用户名不能超过 ${usernameRules.maxLength} 个字符`
  if (!/^[a-z]/i.test(value))
    return '用户名必须以字母开头'
  if (!usernameRules.pattern.test(value))
    return '只允许字母、数字、下划线和连字符'
  return ''
}

function onUsernameInputChange() {
  usernameError.value = validateUsername(usernameInput.value)
}

function openUsernameModal() {
  usernameInput.value = ''
  usernameError.value = ''
  showUsernameModal.value = true
}

async function confirmSetUsername() {
  const err = validateUsername(usernameInput.value)
  if (err) {
    usernameError.value = err
    return
  }

  try {
    settingUsername.value = true
    await setUsername(usernameInput.value)
    showUsernameModal.value = false
  }
  catch {
    // setUsername 内部已处理 toast 提示
  }
  finally {
    settingUsername.value = false
  }
}

watch(user, (u) => {
  if (u) {
    form.nickname = u.nickname || ''
    form.avatar = u.avatar || ''
  }
}, { immediate: true })

function startEdit() {
  form.nickname = user.value?.nickname || ''
  form.avatar = user.value?.avatar || ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

async function save() {
  try {
    saving.value = true
    const { auth } = useCloudbase()
    const updateData: UpdateUserReq = {}

    if (form.nickname !== (user.value?.nickname || '')) {
      updateData.nickname = form.nickname
    }
    if (form.avatar !== (user.value?.avatar || '')) {
      updateData.avatar_url = form.avatar
    }

    if (!updateData.nickname && !updateData.avatar_url) {
      editing.value = false
      return
    }

    await auth.updateUser(updateData)
    await fetchUser()
    editing.value = false

    toast.add({
      title: '保存成功',
      description: '个人资料已更新',
      color: 'success',
    })
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('保存资料失败:', err)
    toast.add({
      title: '保存失败',
      description: message || '请稍后重试',
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <UPageCard class="p-6">
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-lg font-semibold">
          个人资料
        </h3>
        <UButton
          v-if="!editing"
          label="编辑"
          icon="i-lucide-pencil"
          color="primary"
          variant="subtle"
          size="sm"
          @click="startEdit"
        />
      </div>

      <!-- 头像 -->
      <div class="flex items-center gap-6 mb-6">
        <div class="relative group">
          <UAvatar
            :src="editing ? form.avatar || undefined : user?.avatar || undefined"
            :alt="user?.nickname || user?.login || 'User'"
            size="3xl"
          />
          <!-- 编辑态：上传遮罩 -->
          <button
            v-if="editing"
            type="button"
            class="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            :class="{ 'opacity-100': uploading }"
            :disabled="uploading"
            @click="triggerAvatarUpload"
          >
            <UIcon
              v-if="!uploading"
              name="i-lucide-camera"
              class="text-white text-xl"
            />
            <span v-else class="text-white text-xs font-medium">{{ uploadProgress }}%</span>
          </button>
          <input
            ref="avatarInput"
            type="file"
            :accept="AVATAR_ACCEPT"
            class="hidden"
            @change="handleAvatarChange"
          >
        </div>
        <div v-if="editing" class="flex-1 space-y-2">
          <p class="text-sm text-muted">
            点击头像上传图片，支持 JPG/PNG/GIF/WebP，最大 2MB
          </p>
          <UButton
            label="选择图片"
            icon="i-lucide-upload"
            color="neutral"
            variant="outline"
            size="xs"
            :loading="uploading"
            @click="triggerAvatarUpload"
          />
        </div>
      </div>

      <!-- 表单 -->
      <div class="space-y-4">
        <UFormField label="昵称">
          <UInput
            v-if="editing"
            v-model="form.nickname"
            placeholder="输入您的昵称"
            icon="i-lucide-user"
            class="w-full"
          />
          <p v-else class="text-sm py-2">
            {{ user?.nickname || '未设置' }}
          </p>
        </UFormField>

        <UFormField label="用户名">
          <div class="flex items-center gap-2 py-2">
            <p v-if="hasUsername" class="text-sm text-muted">
              @{{ user?.login }}
              <UBadge label="不可修改" color="neutral" variant="subtle" size="xs" class="ml-1" />
            </p>
            <template v-else>
              <p class="text-sm text-muted">
                未设置
              </p>
              <UButton
                label="设置用户名"
                icon="i-lucide-at-sign"
                color="primary"
                variant="subtle"
                size="xs"
                @click="openUsernameModal"
              />
            </template>
          </div>
          <p v-if="!hasUsername" class="text-xs text-dimmed">
            用户名设置后不可更改，请谨慎选择
          </p>
        </UFormField>

        <UFormField label="手机号">
          <p class="text-sm py-2">
            {{ user?.phone || '未绑定' }}
          </p>
        </UFormField>

        <UFormField label="邮箱">
          <p class="text-sm py-2">
            {{ user?.email || '未绑定' }}
          </p>
        </UFormField>
      </div>

      <!-- 编辑操作按钮 -->
      <div v-if="editing" class="flex justify-end gap-3 mt-6 pt-4 border-t border-default">
        <UButton
          label="取消"
          color="neutral"
          variant="outline"
          @click="cancelEdit"
        />
        <UButton
          label="保存"
          color="primary"
          icon="i-lucide-check"
          :loading="saving"
          @click="save"
        />
      </div>
    </UPageCard>

    <!-- 设置用户名弹窗 -->
    <UModal v-model:open="showUsernameModal">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">
                设置用户名
              </h3>
            </div>
          </template>

          <div class="space-y-4">
            <UAlert
              icon="i-lucide-info"
              color="warning"
              title="用户名设置后不可更改"
              description="请仔细确认您的用户名，一旦设置将无法修改。"
            />

            <UFormField label="用户名" :error="usernameError">
              <UInput
                v-model="usernameInput"
                placeholder="请输入用户名"
                icon="i-lucide-at-sign"
                class="w-full"
                @input="onUsernameInputChange"
              >
                <template #leading>
                  <span class="text-dimmed text-sm">@</span>
                </template>
              </UInput>
            </UFormField>

            <div class="text-xs text-dimmed space-y-1">
              <p>· 3-20 个字符</p>
              <p>· 必须以字母开头</p>
              <p>· 只允许字母、数字、下划线（_）和连字符（-）</p>
            </div>
          </div>

          <template #footer>
            <div class="flex justify-end gap-3">
              <UButton
                label="取消"
                color="neutral"
                variant="outline"
                @click="showUsernameModal = false"
              />
              <UButton
                label="确认设置"
                color="primary"
                icon="i-lucide-check"
                :loading="settingUsername"
                :disabled="!!usernameError || !usernameInput"
                @click="confirmSetUsername"
              />
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
