<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
/**
 * 新用户首次引导弹层。
 *
 * 手机 OTP 注册的用户默认昵称是手机号，登录时已在 useAuthCore 换成品牌默认名并写回 auth，
 * 同时置位 needsOnboarding。这里接住该信号弹一次，预填默认名引导用户改昵称 / 传头像，
 * 也可「以后再说」。按 uid 写 localStorage 防重复打扰；保留脱敏层兜历史用户。
 */
const { user, fetchUser, needsOnboarding } = useTcbAuth()
const { uploadAvatar } = useAvatarUpload()
const { upsertMyProfile } = useUserProfile()
const toast = useAppToast()

const STORAGE_PREFIX = 'ylf_onboarded_'
const storageKey = computed(() => (user.value?.id ? `${STORAGE_PREFIX}${user.value.id}` : ''))

const open = shallowRef(false)
const saving = shallowRef(false)
const form = reactive({ nickname: '', avatar: '' })

// 头像上传（复用裁剪组件，与 ProfileTab 一致）
const avatarInput = useTemplateRef<HTMLInputElement>('avatarInput')
const uploading = shallowRef(false)
const showCropper = shallowRef(false)
const cropFile = shallowRef<File | null>(null)
const avatarActionLabel = computed(() =>
  form.avatar || user.value?.avatar ? '更换头像' : '上传头像',
)
const AVATAR_MAX_SIZE = 10 * 1024 * 1024
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp'

const NICKNAME_MAX = 20
const nicknameError = computed(() => {
  const v = form.nickname.trim()
  if (!v)
    return '昵称不能为空'
  if (v.length > NICKNAME_MAX)
    return `昵称不能超过 ${NICKNAME_MAX} 个字符`
  if (looksLikePhone(v))
    return '昵称不能是手机号'
  return ''
})

// needsOnboarding 置位且该 uid 未引导过 → 弹一次
watch([() => needsOnboarding.value, () => user.value?.id], ([need, id]) => {
  if (!need || !id || open.value)
    return
  if (import.meta.client && localStorage.getItem(`${STORAGE_PREFIX}${id}`))
    return
  form.nickname = user.value?.nickname || ''
  form.avatar = user.value?.avatar || ''
  open.value = true
}, { immediate: true })

function markDone() {
  if (import.meta.client && storageKey.value)
    localStorage.setItem(storageKey.value, String(Date.now()))
  needsOnboarding.value = false
  open.value = false
}

function skip() {
  markDone()
}

function triggerAvatarUpload() {
  avatarInput.value?.click()
}

function handleAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file)
    return
  if (file.size > AVATAR_MAX_SIZE) {
    toast.add({ title: '文件过大', description: '图片不能超过 10MB', color: 'error' })
    input.value = ''
    return
  }
  if (!file.type.startsWith('image/')) {
    toast.add({ title: '格式错误', description: '请选择图片文件', color: 'error' })
    input.value = ''
    return
  }
  cropFile.value = file
  showCropper.value = true
  input.value = ''
}

async function handleCropConfirm(croppedFile: File) {
  try {
    uploading.value = true
    const { fileID } = await uploadAvatar(croppedFile)
    form.avatar = fileID
  }
  catch (err: unknown) {
    toast.add({
      title: '上传失败',
      description: err instanceof Error ? err.message : '请稍后重试',
      color: 'error',
    })
  }
  finally {
    uploading.value = false
    cropFile.value = null
  }
}

async function save() {
  if (nicknameError.value)
    return
  try {
    saving.value = true
    const { auth } = useCloudbase()
    const nickname = form.nickname.trim()
    const updateData: Record<string, unknown> = {}
    if (nickname !== (user.value?.nickname || ''))
      updateData.nickname = nickname
    if (form.avatar && form.avatar !== (user.value?.avatar || ''))
      updateData.avatar_url = form.avatar

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await auth.updateUser(updateData)
      if (updateError)
        throw updateError

      await fetchUser()
      // 同步到公开资料表（关注 / 粉丝等展示）
      await upsertMyProfile({ nickname, avatar: form.avatar || user.value?.avatar || null }).catch(() => {})
    }
    toast.add({ title: '欢迎来到云乐坊 ☁️', description: '资料已设置，开始探索吧', color: 'success' })
    markDone()
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
  <AppModal v-model:open="open" title="欢迎来到云乐坊" :dismissible="false" :close="false">
    <template #content>
      <Card class="border-0 ring-0">
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <Icon name="i-lucide-cloud-sun" class="size-5 text-primary" />
            欢迎来到云乐坊
          </CardTitle>
        </CardHeader>

        <CardContent class="flex flex-col gap-5">
          <p class="text-sm text-muted">
            给自己起个好记的名字吧，让其他人更容易认识你。
          </p>

          <!-- 头像 -->
          <div class="flex items-center gap-4">
            <div class="relative">
              <MemberAvatar
                :src="form.avatar || user?.avatar || undefined"
                :alt="form.nickname || 'User'"
                size="2xl"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                :aria-label="avatarActionLabel"
                :title="avatarActionLabel"
                class="absolute inset-0 size-full rounded-full"
                :disabled="uploading"
                @click="triggerAvatarUpload"
              >
                <span class="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-primary text-white shadow-md ring-2 ring-(color:--ui-bg)">
                  <Icon v-if="!uploading" name="i-lucide-camera" class="size-3.5" />
                  <Icon v-else name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
                </span>
              </Button>
              <input
                ref="avatarInput"
                type="file"
                :accept="AVATAR_ACCEPT"
                class="hidden"
                @change="handleAvatarChange"
              >
            </div>
            <div class="text-xs text-dimmed">
              {{ avatarActionLabel }}（可选）<br>
              支持裁剪为正方形并自动压缩
            </div>
          </div>

          <!-- 昵称 -->
          <AppFormField label="昵称" :error="nicknameError">
            <AppInput
              v-model="form.nickname"
              placeholder="输入你的昵称"
              icon="i-lucide-user"
              :maxlength="NICKNAME_MAX"
              class="w-full"
              autofocus
            />
          </AppFormField>
          <p class="text-xs text-dimmed">
            我们为你预填了一个名字，喜欢就直接用，也可以随时在「设置」里修改。
          </p>
        </CardContent>

        <CardFooter class="justify-end gap-3">
          <AppButton
            label="以后再说"
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="skip"
          />
          <AppButton
            label="完成"
            color="primary"
            icon="i-lucide-check"
            :loading="saving"
            :disabled="!!nicknameError"
            @click="save"
          />
        </CardFooter>
      </Card>
    </template>
  </AppModal>

  <!-- 头像裁剪弹窗 -->
  <AvatarCropper
    v-model:open="showCropper"
    :file="cropFile"
    :max-size="512"
    :quality="0.85"
    @confirm="handleCropConfirm"
    @cancel="cropFile = null"
  />
</template>
